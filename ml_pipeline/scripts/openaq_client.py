"""
Rate-limited OpenAQ v3 client.

The OpenAQ free tier allows 60 requests/minute. The original 01_fetch_openaq.py
exhausted its retries on 429 and then silently `break`-ed out of the pagination
loop, so a rate-limited sensor looked identical to a sensor with no data. That is
why the pilot dataset ended up with a single station. This client instead paces
requests against the server's own X-Ratelimit-* headers and raises on persistent
failure so a caller can never mistake throttling for absence of data.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Iterator

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://api.openaq.org"

# Free tier: 60 req/min. Stay just under it — the reset window is coarse and
# bursting to the exact limit reliably trips a 429 on the following request.
DEFAULT_RPM = 55


class OpenAQError(RuntimeError):
    """Raised when a request cannot be completed after exhausting retries."""


class OpenAQClient:
    """Paced, retrying wrapper over the OpenAQ v3 REST API."""

    def __init__(
        self,
        api_key: str | None = None,
        rpm: int = DEFAULT_RPM,
        max_retries: int = 6,
        timeout: float = 60.0,
    ) -> None:
        self.api_key = api_key or os.getenv("OPENAQ_API_KEY", "")
        if not self.api_key:
            raise OpenAQError(
                "OPENAQ_API_KEY is not set. Add it to external_data_pipeline/.env "
                "or export it before running."
            )
        self.min_interval = 60.0 / max(rpm, 1)
        self.max_retries = max_retries
        self.timeout = timeout
        self._last_request_at = 0.0
        self._session = requests.Session()
        self._session.headers.update({"X-API-Key": self.api_key})

        self.request_count = 0

    # ── pacing ────────────────────────────────────────────────────────────────

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < self.min_interval:
            time.sleep(self.min_interval - elapsed)

    def _observe_headers(self, resp: requests.Response) -> None:
        """If the server says we are nearly out of budget, wait for its reset."""
        try:
            remaining = int(resp.headers.get("X-Ratelimit-Remaining", "99"))
            reset = int(resp.headers.get("X-Ratelimit-Reset", "0"))
        except ValueError:
            return
        if remaining <= 2 and reset > 0:
            logger.info("Rate budget nearly spent; sleeping %ss for reset.", reset)
            time.sleep(reset + 1)

    # ── core request ──────────────────────────────────────────────────────────

    def get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        url = BASE_URL + path
        last_error = ""

        for attempt in range(self.max_retries):
            self._throttle()
            try:
                resp = self._session.get(url, params=params, timeout=self.timeout)
            except requests.RequestException as exc:
                last_error = f"network error: {exc}"
                time.sleep(min(2**attempt, 60))
                continue
            finally:
                self._last_request_at = time.monotonic()

            self.request_count += 1

            if resp.status_code == 200:
                self._observe_headers(resp)
                return resp.json()

            if resp.status_code == 429:
                # Prefer the server's Retry-After / reset hint over blind backoff.
                wait = resp.headers.get("Retry-After") or resp.headers.get("X-Ratelimit-Reset")
                delay = int(wait) + 1 if wait and str(wait).isdigit() else min(2**attempt, 60)
                logger.warning("429 on %s; waiting %ss (attempt %d/%d).",
                               path, delay, attempt + 1, self.max_retries)
                time.sleep(delay)
                last_error = "rate limited (429)"
                continue

            if 500 <= resp.status_code < 600:
                delay = min(2**attempt, 60)
                logger.warning("HTTP %d on %s; retrying in %ss.", resp.status_code, path, delay)
                time.sleep(delay)
                last_error = f"server error {resp.status_code}"
                continue

            # 4xx other than 429 will not fix themselves.
            raise OpenAQError(f"HTTP {resp.status_code} on {path}: {resp.text[:300]}")

        raise OpenAQError(f"Gave up on {path} after {self.max_retries} attempts: {last_error}")

    # ── pagination ────────────────────────────────────────────────────────────

    def paginate(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        page_size: int = 1000,
        max_pages: int = 200,
    ) -> Iterator[dict[str, Any]]:
        """Yield every result row across pages.

        OpenAQ reports `meta.found` as either an int or a string like ">1000",
        so page count cannot be computed up front. We advance until a short or
        empty page arrives.
        """
        params = dict(params or {})
        params["limit"] = page_size

        for page in range(1, max_pages + 1):
            params["page"] = page
            payload = self.get(path, params)
            results = payload.get("results", []) or []
            for row in results:
                yield row
            if len(results) < page_size:
                return

        logger.warning("Hit max_pages=%d on %s; results may be truncated.", max_pages, path)
