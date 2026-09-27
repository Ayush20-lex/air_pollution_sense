"""
The assistant: Gemini Flash, with this system's endpoints as its only source.

The design rule is one sentence: the model may not state a figure it did not
receive from a tool. Everything below exists to make that true and to make it
checkable - the system prompt forbids estimating, every tool payload carries
its own provenance, and the transcript records which tools ran so the UI can
show the receipts. An assistant that answers plausibly from memory would be
the only surface on this site that reports numbers nothing measured, which is
the exact failure this project has spent its time removing.

Raw HTTP rather than an SDK. The backend already talks to FIRMS and CPCB this
way, the box is small, and Gemini's REST surface for function calling is two
shapes - `functionCall` out, `functionResponse` in. A dependency would buy
nothing here and has to be installed on a 951 MB VM.

Guardrails are in this module rather than bolted on later, because a public
LLM endpoint is an open wallet: anyone who finds it can spend against the key
until it is empty. Nothing here is a substitute for a spend cap on the key
itself - set one in Google AI Studio too.
"""
from __future__ import annotations

import json
import logging
import os
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Iterator

import requests

import assistant_tools

log = logging.getLogger("assistant")

# ── configuration ───────────────────────────────────────────────────────────

#: Left unset on purpose. Put it in /etc/airsense.env beside WAQI_TOKEN and
#: never in the repository. Absent, the endpoint reports itself unavailable and
#: the widget does not render - the same rule the meteorology panel follows.
API_KEY_ENV = "GEMINI_API_KEY"

#: Flash: the cheap, fast tier, which is the right one for a public widget
#: answering from tool output rather than from its own reasoning.
# Overridable because model names expire faster than this codebase does. The
# original default was gemini-2.5-flash, which a newly issued key cannot call:
# "no longer available to new users". It still appears in ListModels, so only
# generateContent reveals it, and the refusal arrives as 404 model-not-found
# rather than a permission error - which reads exactly like a dead endpoint.
MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")

BASE = "https://generativelanguage.googleapis.com/v1beta"

#: Upstream capacity blips, retried with a widening gap. Kept small: the caller
#: is a person waiting on a stream, not a batch job.
RETRY_ON_503 = 2
RETRY_BACKOFF_S = 2.0

#: Hard ceilings. `MAX_TURNS` bounds one conversation; `MAX_TOOL_ROUNDS` bounds
#: one answer, so a model that loops on tools cannot bill forever.
MAX_OUTPUT_TOKENS = 900
MAX_TOOL_ROUNDS = 5
MAX_TURNS = 12
MAX_QUESTION_CHARS = 600

#: Per-IP budget. Generous for a reader, useless for a scraper.
RATE_PER_MIN = 6
RATE_PER_DAY = 120

#: Whole-deployment ceiling. The last line before the key gets drained.
DAILY_CALL_CEILING = 1500

REQUEST_TIMEOUT_S = 45


def api_key() -> str | None:
    key = os.environ.get(API_KEY_ENV, "").strip()
    return key or None


def available() -> bool:
    return api_key() is not None


SYSTEM_PROMPT = """\
You are the AirLytics assistant, embedded in a public air-quality dashboard for \
Delhi NCR built for SIH problem statement 26082 (MoES / NCMRWF).

THE RULE THAT OVERRIDES EVERYTHING ELSE
You may only state a number, a station name, an hour, a stage or a trend that \
came back from a tool in this conversation. You have general knowledge about \
air pollution and you may use it to explain mechanisms, but you must never use \
it to supply a value. If a tool did not give you the figure, say plainly that \
this system does not measure it. Never estimate, never interpolate, never fill \
a gap with a typical value, and never carry a number from your own memory of \
what Delhi is usually like.

CITE WHAT YOU USE
Every figure gets its source in the sentence that carries it: the station name \
and the hour for a reading, the run origin for a forecast, the window for a \
fire count. When a tool payload carries a `caveat` or an `assumptions` list, \
and the answer depends on it, say it in your own words. When a reading comes \
from the archive rather than the live feed, say so - those describe different \
hours.

WHAT THIS SYSTEM DOES NOT HAVE
There is no emissions inventory, so you cannot apportion pollution to traffic, \
industry, construction or dust. The only apportionment that exists is the \
measured smoke share from the fire tool. There is no wind field over Punjab or \
Haryana, so corridor transport uses Delhi's own wind and must be quoted with \
that assumption. NO2, SO2 and CO are not indexed by the live feed; explain why \
using index_rules and the withheld reasons rather than guessing values.

HEALTH
Give the CPCB or GRAP advisory for the current band and the practical steps in \
it. You are not a clinician: never diagnose, never give personal medical \
advice, never tell someone whether their own condition makes something safe. \
Point people with a condition to their doctor, and give them the reading and \
the official advisory so the conversation with that doctor is informed.

STYLE
Short. Two or three sentences for a simple question. Lead with the answer, then \
the number that supports it, then the caveat if one matters. Plain prose, no \
headings, no bullet lists unless comparing three or more things. Never invent \
enthusiasm about bad air.

TOOLS
Call a tool for anything factual - do not answer current conditions from the \
conversation history, because the readings move. Calling two tools in one turn \
is normal and expected when a question spans both.
"""


# ── guardrails ──────────────────────────────────────────────────────────────


@dataclass
class _Budget:
    """Per-IP and whole-deployment call accounting, in memory."""

    minute: dict[str, deque] = field(default_factory=lambda: defaultdict(deque))
    day: dict[str, deque] = field(default_factory=lambda: defaultdict(deque))
    total_day: deque = field(default_factory=deque)

    def check(self, ip: str) -> str | None:
        """None when the call may proceed, else why it may not."""
        now = time.time()
        for q, span, cap, msg in (
            (self.minute[ip], 60, RATE_PER_MIN, "Too many questions in a minute"),
            (self.day[ip], 86400, RATE_PER_DAY, "Daily question limit reached"),
            (self.total_day, 86400, DAILY_CALL_CEILING, "The assistant is over its daily budget"),
        ):
            while q and now - q[0] > span:
                q.popleft()
            if len(q) >= cap:
                return msg
        return None

    def spend(self, ip: str) -> None:
        now = time.time()
        self.minute[ip].append(now)
        self.day[ip].append(now)
        self.total_day.append(now)
        # Unbounded dicts are a slow leak on a long-lived process. Keys whose
        # windows have emptied are dropped once the map gets large.
        if len(self.day) > 4000:
            for key in [k for k, q in self.day.items() if not q]:
                self.day.pop(key, None)
                self.minute.pop(key, None)


BUDGET = _Budget()


def kill_switch_on() -> bool:
    """A file on disk, so the assistant can be stopped without a deploy."""
    return os.path.exists(os.environ.get("ASSISTANT_KILL_FILE", "/etc/airsense.assistant.off"))


# ── the turn ────────────────────────────────────────────────────────────────


def _post(payload: dict[str, Any]) -> dict[str, Any]:
    key = api_key()
    if key is None:
        raise RuntimeError("no API key")
    # 503 from this API means the model is momentarily out of capacity, not
    # that anything is wrong with the request - the same payload succeeds
    # seconds later. Retrying briefly is the difference between a widget that
    # looks broken and one that is a beat slow. 429 is not retried: that one is
    # a budget, and hammering it makes it worse.
    r = None
    for attempt in range(RETRY_ON_503 + 1):
        r = requests.post(
            f"{BASE}/models/{MODEL}:generateContent",
            params={"key": key},
            json=payload,
            timeout=REQUEST_TIMEOUT_S,
            headers={"Content-Type": "application/json"},
        )
        if r.status_code != 503 or attempt == RETRY_ON_503:
            break
        time.sleep(RETRY_BACKOFF_S * (attempt + 1))

    if r.ok:
        return r.json()

    # Google's error envelope carries the reason - a 404 here means the model
    # name is not served to this key, which is indistinguishable from a dead
    # endpoint unless you read it, and a 429 names which quota ran out. Read it
    # before branching: the first version of this logged every status except
    # 429, which was the one worth seeing. The key travels as a query
    # parameter, so scrub it out of anything echoed back.
    reason, quota_ids = "", []
    try:
        err = r.json().get("error", {})
        reason = f'{err.get("status", "")}: {err.get("message", "")}'[:300]
        # The prose message for a 429 says only "you exceeded your current
        # quota" - which quota is in the QuotaFailure detail, as an id like
        # GenerateRequestsPerDayPerProjectPerModel. Without reading this there
        # is no way to tell a minute's pause from a lockout until tomorrow.
        for d in err.get("details", []) or []:
            for v in (d.get("violations") or []) if isinstance(d, dict) else []:
                qid = str(v.get("quotaId", ""))
                if qid:
                    quota_ids.append(qid)
    except ValueError:
        reason = r.text[:300]
    if quota_ids:
        reason = f"{reason} [quota: {','.join(quota_ids)}]"[:400]
    reason = reason.replace(key, "<key>")
    log.warning("gemini HTTP %s %s (model=%s)", r.status_code, reason, MODEL)

    if r.status_code == 429:
        # Whose limit this is matters to whoever is reading the panel: ours is
        # a pause of seconds, Google's daily free-tier quota is a pause until
        # midnight Pacific, and the two deserve different expectations.
        blob = " ".join(quota_ids).lower() or reason.lower()
        daily = "perday" in blob.replace(" ", "")
        raise RuntimeError(
            "the daily free quota for this model is spent; it resets at "
            "midnight US Pacific"
            if daily
            else "too many questions in the last minute, give it a moment"
        )
    raise RuntimeError(f"upstream returned HTTP {r.status_code}")


def _parts_text(parts: list[dict[str, Any]]) -> str:
    return "".join(p.get("text", "") for p in parts if isinstance(p, dict))


def answer(question: str, history: list[dict[str, Any]] | None = None) -> Iterator[dict]:
    """
    Run one question to completion, yielding events as they happen.

    Events: {"type": "tool", ...} once per call so the UI can show a receipt,
    {"type": "text", ...} with the answer, {"type": "error", ...} when the turn
    cannot be completed, and {"type": "done", ...} last with the turn's record.

    Not streamed token by token. The interesting latency here is the tool
    round-trip, not the generation, and a turn that pauses on a visible "reading
    the station mesh" chip reads better than one that dribbles a sentence while
    it has nothing to say yet. It also keeps the transcript contract simple:
    one answer, one set of receipts.
    """
    q = (question or "").strip()
    if not q:
        yield {"type": "error", "message": "Ask me something about the air."}
        return
    if len(q) > MAX_QUESTION_CHARS:
        yield {"type": "error", "message": "That question is too long for me to take."}
        return

    contents: list[dict[str, Any]] = list(history or [])
    contents.append({"role": "user", "parts": [{"text": q}]})

    used: list[dict[str, Any]] = []

    for _ in range(MAX_TOOL_ROUNDS):
        payload = {
            "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": contents,
            "tools": [{"functionDeclarations": assistant_tools.DECLARATIONS}],
            "generationConfig": {
                "maxOutputTokens": MAX_OUTPUT_TOKENS,
                "temperature": 0.2,
            },
        }
        try:
            data = _post(payload)
        except Exception as exc:  # noqa: BLE001 - surfaced to the reader as text
            yield {"type": "error", "message": f"The assistant is unavailable ({exc})."}
            return

        candidates = data.get("candidates") or []
        if not candidates:
            yield {"type": "error", "message": "The assistant had nothing to say."}
            return
        parts = (candidates[0].get("content") or {}).get("parts") or []

        calls = [p["functionCall"] for p in parts if isinstance(p, dict) and "functionCall" in p]
        if not calls:
            text = _parts_text(parts).strip()
            if not text:
                yield {"type": "error", "message": "The assistant returned an empty answer."}
                return
            yield {"type": "text", "text": text}
            yield {"type": "done", "tools": used, "contents": contents}
            return

        # Echo the model's own turn back before the results, or the next
        # request has responses with nothing to respond to.
        contents.append({"role": "model", "parts": parts})

        responses = []
        for call in calls:
            name = call.get("name", "")
            args = call.get("args") or {}
            started = time.time()
            result = assistant_tools.run(name, args)
            record = {
                "name": name,
                "args": args,
                "ms": int((time.time() - started) * 1000),
                "ok": "error" not in result,
                "source": result.get("source"),
                "as_of": result.get("as_of"),
            }
            used.append(record)
            yield {"type": "tool", **record}
            responses.append(
                {"functionResponse": {"name": name, "response": {"result": result}}}
            )
        contents.append({"role": "user", "parts": responses})

    yield {
        "type": "error",
        "message": "I could not settle on an answer without going in circles.",
    }
