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

import copy
import json
import logging
import os
import re
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Iterator

import requests

import assistant_tools

log = logging.getLogger("assistant")

# ── configuration ───────────────────────────────────────────────────────────

#: The two upstreams this can answer from. Keys are left unset in the
#: repository and live in /etc/airsense.env beside WAQI_TOKEN; with neither
#: key the endpoint reports itself unavailable and the widget does not render,
#: the same rule the meteorology panel follows.
#:
#: Model names are overridable because they expire faster than this codebase
#: does. The Gemini default was once gemini-2.5-flash, which a newly issued key
#: cannot call: "no longer available to new users". It still appears in
#: ListModels, so only generateContent reveals it, and the refusal arrives as
#: 404 model-not-found rather than a permission error - which reads exactly
#: like a dead endpoint.
PROVIDERS: dict[str, dict[str, str]] = {
    # Flash: the cheap, fast tier, which is the right one for a public widget
    # answering from tool output rather than from its own reasoning.
    "gemini": {
        "key_env": "GEMINI_API_KEY",
        "model": os.environ.get("GEMINI_MODEL", "gemini-3.8-flash"),
        "base": "https://generativelanguage.googleapis.com/v1beta",
    },
    # gpt-oss-120b over the 20b and the Llamas: this assistant lives or dies on
    # following one instruction - never state a figure a tool did not return -
    # and that is a reasoning job, not a throughput one.
    "groq": {
        "key_env": "GROQ_API_KEY",
        "model": os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b"),
        "base": "https://api.groq.com/openai/v1",
    },
}

#: How long a provider sits out after it says its quota is gone.
#:
#: This is what makes the switch automatic in both directions. A daily quota
#: has no published reset this code can read - Google says "midnight Pacific",
#: Groq says nothing - so rather than model a calendar, the exhausted provider
#: is benched and re-tried later. If it is still out it goes back on the bench;
#: when its window has rolled over it simply works again and the preferred
#: provider resumes. Nobody restarts anything.
COLD_AFTER_QUOTA_S = 30 * 60

#: Set a provider name to pin it and disable failover; "auto" (the default)
#: prefers Groq when its key is present and falls back to whichever other
#: provider is configured and not benched.
PREFERRED = os.environ.get("ASSISTANT_PROVIDER", "auto").strip().lower()

#: provider -> the monotonic time it may be tried again.
_benched: dict[str, float] = {}


def configured() -> list[str]:
    """Providers with a key, preferred first."""
    order = (
        [PREFERRED] + [p for p in PROVIDERS if p != PREFERRED]
        if PREFERRED in PROVIDERS
        else ["groq", "gemini"]
    )
    return [p for p in order if os.environ.get(PROVIDERS[p]["key_env"], "").strip()]


def provider() -> str:
    """
    The provider to use for the next call: the first configured one that is not
    benched, or the first configured one if they are all benched - a turn
    against an exhausted upstream reports a real quota message, which beats
    reporting nothing.
    """
    ready = [p for p in configured() if _benched.get(p, 0.0) <= time.monotonic()]
    return (ready or configured() or ["gemini"])[0]


def bench(name: str, seconds: float = COLD_AFTER_QUOTA_S) -> None:
    _benched[name] = time.monotonic() + seconds
    log.warning("provider %s benched for %.0fs", name, seconds)


def model(name: str | None = None) -> str:
    return PROVIDERS[name or provider()]["model"]

#: Upstream capacity blips, retried with a widening gap. Kept small: the caller
#: is a person waiting on a stream, not a batch job.
RETRY_ON_503 = 2
RETRY_BACKOFF_S = 2.0

#: Total attempts per upstream call, covering 503s and short 429s together.
MAX_UPSTREAM_ATTEMPTS = RETRY_ON_503 + 1

#: A 429 is worth waiting out when the upstream says the wait is short.
#:
#: Groq meters tokens per minute - 8000 on the free tier - and one turn here
#: costs 1300 to 1700 tokens, mostly the system prompt and eight tool
#: declarations. So a sliding window runs out mid-conversation and refills
#: seconds later, and Groq says exactly when: "try again in 52.5ms", "in
#: 7.67s". Refusing to retry that turns a 50 ms pause into a dead panel.
#:
#: A daily quota is the opposite and is still never retried. The difference is
#: the stated wait, not the status code: anything past this ceiling is a budget
#: to respect rather than a blip to ride out.
RETRY_AFTER_MAX_S = 10.0

#: Hard ceilings. `MAX_TURNS` bounds one conversation; `MAX_TOOL_ROUNDS` bounds
#: one answer, so a model that loops on tools cannot bill forever.
MAX_OUTPUT_TOKENS = 900
MAX_TOOL_ROUNDS = 5
MAX_TURNS = 12
MAX_QUESTION_CHARS = 600

#: Per-IP budget. Generous for a reader, useless for a scraper.
#:
#: Tighter on Groq, and the arithmetic is why. Its free tier meters 8000 tokens
#: per minute, one turn here costs 1300 to 1700 of them, and a turn that calls
#: a tool spends that two or three times - so roughly 4000 tokens a question,
#: or two questions a minute. Six would have every reader bouncing off the
#: upstream's limit instead of this one, which is the wrong message from the
#: wrong place: ours names a wait, theirs reads as the assistant being broken.
#: Read per call, because the active provider can change under us when one
#: is benched - and the limit has to follow the provider actually answering.
def rate_per_min() -> int:
    return 2 if provider() == "groq" else 6


RATE_PER_DAY = 120

#: Whole-deployment ceiling. The last line before the key gets drained.
DAILY_CALL_CEILING = 1500

REQUEST_TIMEOUT_S = 45


def api_key(name: str | None = None) -> str | None:
    key = os.environ.get(PROVIDERS[name or provider()]["key_env"], "").strip()
    return key or None


def available() -> bool:
    return bool(configured())


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
            (self.minute[ip], 60, rate_per_min(), "Too many questions in a minute"),
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


def _retry_after(r: "requests.Response") -> float | None:
    """
    How long the upstream asked us to wait, in seconds, or None if it did not.

    The `Retry-After` header first, since it is the standard. Groq also states
    it in prose - "Please try again in 7.672499999s", or in milliseconds under
    a second - and that sentence is sometimes the only place it appears, so it
    is read as a fallback rather than trusted as the primary.
    """
    header = (r.headers.get("Retry-After") or "").strip()
    if header:
        try:
            return max(0.0, float(header))
        except ValueError:
            pass  # HTTP-date form; not worth parsing for a sub-minute window
    m = re.search(r"try again in\s*([\d.]+)\s*(ms|s)\b", r.text or "", re.I)
    if not m:
        return None
    try:
        value = float(m.group(1))
    except ValueError:
        return None
    return value / 1000.0 if m.group(2).lower() == "ms" else value


def _post(payload: dict[str, Any], name: str) -> dict[str, Any]:
    key = api_key(name)
    if key is None:
        raise RuntimeError("no API key")
    # 503 from this API means the model is momentarily out of capacity, not
    # that anything is wrong with the request - the same payload succeeds
    # seconds later. Retrying briefly is the difference between a widget that
    # looks broken and one that is a beat slow. 429 is not retried: that one is
    # a budget, and hammering it makes it worse.
    # Groq is OpenAI-shaped, so the key rides in a header and the model is in
    # the body; Gemini puts the key in the query string and the model in the
    # path. Everything after this - the retry, the scrubbing, the quota
    # reading - is the same either way, which is the point of one transport.
    base, mdl = PROVIDERS[name]["base"], PROVIDERS[name]["model"]
    if name == "groq":
        url = f"{base}/chat/completions"
        params: dict[str, str] = {}
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
    else:
        url = f"{base}/models/{mdl}:generateContent"
        params = {"key": key}
        headers = {"Content-Type": "application/json"}

    r = None
    for attempt in range(MAX_UPSTREAM_ATTEMPTS):
        r = requests.post(
            url,
            params=params,
            json=payload,
            timeout=REQUEST_TIMEOUT_S,
            headers=headers,
        )
        if r.ok:
            return r.json()
        if attempt == MAX_UPSTREAM_ATTEMPTS - 1:
            break
        if r.status_code == 503:
            time.sleep(RETRY_BACKOFF_S * (attempt + 1))
            continue
        if r.status_code == 429:
            wait = _retry_after(r)
            if wait is not None and wait <= RETRY_AFTER_MAX_S:
                # A shade over what it asked for: the window is sliding, and
                # arriving on the exact boundary just earns another 429.
                time.sleep(wait + 0.3)
                continue
        break

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
    log.warning("%s HTTP %s %s (model=%s)", name, r.status_code, reason, mdl)

    if r.status_code == 429:
        # Whose limit this is matters to whoever is reading the panel: a pause
        # of seconds and a lockout until tomorrow deserve different
        # expectations. Google hides which in a quotaId; Groq says it in the
        # prose ("rate limit reached ... requests per day"), so check both.
        blob = (" ".join(quota_ids) + " " + reason).lower()
        daily = "perday" in blob.replace(" ", "") or "rpd" in blob
        raise RuntimeError(
            "the daily free quota for this model is spent; it resets tomorrow"
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

    order = [p for p in configured() if _benched.get(p, 0.0) <= time.monotonic()]
    order = order or configured()
    if not order:
        yield {"type": "error", "message": "The assistant is not switched on."}
        return

    # Try each configured provider in turn, but only while nothing has reached
    # the reader yet. A quota refusal arrives on the first upstream call, so
    # this covers it; once a tool receipt or an answer has been sent, switching
    # would duplicate chips or stitch two voices into one reply, and a plain
    # error is the honest outcome.
    held: dict[str, Any] | None = None
    for index, name in enumerate(order):
        emitted = False
        for event in _run_provider(name, q, history):
            if event["type"] == "error" and not emitted:
                held = event
                if index + 1 < len(order) and _worth_failing_over(event["message"]):
                    bench(name)
                    break
                yield event
                return
            emitted = True
            yield event
        else:
            return
    if held:
        yield held


def _run_provider(name: str, q: str, history: list[dict[str, Any]] | None) -> Iterator[dict]:
    fn = _answer_groq if name == "groq" else _answer_gemini
    return fn(q, _history_for(name, history))


#: Failures that another provider might not have. A spent quota, a minute's
#: rate limit, a model name a key cannot call, a rejected key: all of them mean
#: "this upstream will not answer", and the other one may. A 5xx is not here -
#: the transport already retried it, and a second provider is unlikely to be
#: down at the same moment for a different reason.
_FAILOVER_SIGNS = ("quota", "too many questions", "no api key", "http 4")


def _worth_failing_over(message: str) -> bool:
    low = (message or "").lower()
    return any(sign in low for sign in _FAILOVER_SIGNS)


def _history_for(name: str, history: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """
    The transcript in the shape this provider speaks.

    The two wire formats are not interchangeable - Gemini carries `parts`,
    Groq carries `content` and matches tool results to ids - so a transcript
    recorded against one provider cannot be replayed against the other. What
    converts cleanly is the conversation: who said what, in text.

    So a failover keeps the thread of the exchange and drops the tool payloads
    from earlier turns. The receipts the reader already saw stay on screen, and
    the current turn calls whatever tools it needs again, against live
    readings. The cost is that a follow-up cannot lean on a figure fetched two
    turns ago without fetching it again, which is the right way round for data
    that moves by the hour.
    """
    history = history or []
    if not history:
        return []
    looks_gemini = any(isinstance(h, dict) and "parts" in h for h in history)
    if looks_gemini == (name == "gemini"):
        return list(history)

    plain: list[tuple[str, str]] = []
    for turn in history:
        if not isinstance(turn, dict):
            continue
        role = turn.get("role")
        if looks_gemini:
            text = "".join(
                p.get("text", "")
                for p in (turn.get("parts") or [])
                if isinstance(p, dict) and "text" in p
            ).strip()
            if text and role in ("user", "model"):
                plain.append(("user" if role == "user" else "assistant", text))
        else:
            text = (turn.get("content") or "").strip() if isinstance(turn.get("content"), str) else ""
            if text and role in ("user", "assistant"):
                plain.append((role, text))

    if name == "gemini":
        return [
            {"role": "user" if who == "user" else "model", "parts": [{"text": said}]}
            for who, said in plain
        ]
    return [{"role": "system", "content": SYSTEM_PROMPT}] + [
        {"role": who, "content": said} for who, said in plain
    ]


def _record(name: str, args: dict[str, Any], result: dict[str, Any], started: float) -> dict:
    """One receipt. The UI prints these under the answer, so a reader can see
    which endpoint and which hour a figure came from."""
    return {
        "name": name,
        "args": args,
        "ms": int((time.time() - started) * 1000),
        "ok": "error" not in result,
        "source": result.get("source"),
        "as_of": result.get("as_of"),
    }


def _answer_gemini(q: str, history: list[dict[str, Any]] | None) -> Iterator[dict]:
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
            data = _post(payload, "gemini")
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
            record = _record(name, args, result, started)
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


def _groq_tools() -> list[dict[str, Any]]:
    """
    The same declarations, with optional parameters allowed to be null.

    Groq validates the model's tool call against the schema we send, server
    side, and rejects the whole turn with a 400 if it disagrees. gpt-oss-120b
    passes `pollutant: null` to mean "not specified", which a bare
    `"type": "string"` refuses - so asking how the CPCB index is calculated
    failed before any tool ran:

        parameters for tool index_rules did not match schema:
        [`/pollutant`: expected string, but got null]

    Widened here rather than in DECLARATIONS because Gemini's schema subset
    takes a single type string, not a list, and the declarations are shared.
    Nulls are then dropped before dispatch, since every tool reads a missing
    argument as "not specified" already.
    """
    out: list[dict[str, Any]] = []
    for decl in assistant_tools.DECLARATIONS:
        decl = copy.deepcopy(decl)
        params = decl.get("parameters") or {}
        required = set(params.get("required") or ())
        for name, spec in (params.get("properties") or {}).items():
            if name in required or not isinstance(spec, dict):
                continue
            kind = spec.get("type")
            if isinstance(kind, str):
                spec["type"] = [kind, "null"]
        out.append({"type": "function", "function": decl})
    return out


def _answer_groq(q: str, history: list[dict[str, Any]] | None) -> Iterator[dict]:
    """
    The same turn against an OpenAI-shaped API.

    Three things differ from Gemini and nothing else does. The system prompt is
    a message rather than its own field. The tool declarations are the same
    objects, wrapped one level deeper. And a tool result is its own `tool`
    message keyed by `tool_call_id`, rather than a response part inside a user
    turn - so the assistant's own turn, with its `tool_calls`, has to go back
    verbatim or the ids have nothing to match.

    `contents` keeps its name on the wire even though these are `messages`,
    because the frontend stores whatever it is handed and echoes it back
    untouched. Renaming the field would break a transcript mid-conversation
    for no gain.
    """
    messages: list[dict[str, Any]] = list(history or [])
    if not messages:
        messages.append({"role": "system", "content": SYSTEM_PROMPT})
    messages.append({"role": "user", "content": q})

    tools = _groq_tools()
    used: list[dict[str, Any]] = []

    for _ in range(MAX_TOOL_ROUNDS):
        payload = {
            "model": model("groq"),
            "messages": messages,
            "tools": tools,
            "tool_choice": "auto",
            "max_completion_tokens": MAX_OUTPUT_TOKENS,
            "temperature": 0.2,
        }
        try:
            data = _post(payload, "groq")
        except Exception as exc:  # noqa: BLE001 - surfaced to the reader as text
            yield {"type": "error", "message": f"The assistant is unavailable ({exc})."}
            return

        choices = data.get("choices") or []
        if not choices:
            yield {"type": "error", "message": "The assistant had nothing to say."}
            return
        msg = choices[0].get("message") or {}
        calls = msg.get("tool_calls") or []

        if not calls:
            text = (msg.get("content") or "").strip()
            if not text:
                yield {"type": "error", "message": "The assistant returned an empty answer."}
                return
            yield {"type": "text", "text": text}
            yield {"type": "done", "tools": used, "contents": messages}
            return

        messages.append(msg)

        for call in calls:
            fn = call.get("function") or {}
            name = fn.get("name", "")
            # Arguments arrive as a JSON string here, not an object. A model
            # that emits malformed JSON must not take the turn down with it:
            # an empty mapping reaches the tool, which validates its own input
            # and returns an error the model can read and retry from.
            raw = fn.get("arguments") or "{}"
            try:
                args = json.loads(raw) if isinstance(raw, str) else dict(raw)
            except ValueError:
                args = {}
            if not isinstance(args, dict):
                args = {}
            # A null argument means "not specified", which every tool already
            # reads as a missing key. Dropping it here keeps the tools from
            # having to know that one provider spells absence as null.
            args = {k: v for k, v in args.items() if v is not None}

            started = time.time()
            result = assistant_tools.run(name, args)
            record = _record(name, args, result, started)
            used.append(record)
            yield {"type": "tool", **record}
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.get("id", ""),
                    "name": name,
                    "content": json.dumps({"result": result}),
                }
            )

    yield {
        "type": "error",
        "message": "I could not settle on an answer without going in circles.",
    }
