"""
Does the assistant actually read the instruments, or does it just sound like it?

Twenty questions, each asserting which tools must fire. That assertion is the
whole point. "Grounded" is a claim anyone can print on a badge; what can be
demonstrated is that asking about GRAP called the GRAP engine, that asking
about a station read that station, and that asking something this system
cannot know called nothing and said so.

Three checks per case:

  expect_tools   every named tool ran. A confident answer about the forecast
                 that never called `forecast` came from the model's memory of
                 Delhi, which is the failure this whole design exists to stop.
  forbid_tools   named tools did NOT run - catches a model reaching for the
                 station mesh to answer a question about CPCB's arithmetic.
  must_refuse    the answer declines rather than inventing. These are the
                 cases with no tool behind them at all.

Run it against a server that has GEMINI_API_KEY set:

    python assistant_eval.py                  # all cases
    python assistant_eval.py --only grap      # one, by id substring
    python assistant_eval.py --base http://127.0.0.1:8020

It costs real tokens - about twenty turns, each with a tool round or two - so
it is a command you run deliberately, not a test suite hook.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass, field
from typing import Any

import requests


@dataclass
class Case:
    id: str
    question: str
    expect_tools: list[str] = field(default_factory=list)
    forbid_tools: list[str] = field(default_factory=list)
    #: Substrings, any one of which satisfies the check (case-insensitive).
    expect_any: list[str] = field(default_factory=list)
    #: The answer must decline rather than produce a figure.
    must_refuse: bool = False


CASES: list[Case] = [
    # ── current conditions ──────────────────────────────────────────────
    Case("now.city", "What is the air like in Delhi right now?", ["city_now"]),
    Case("now.worst", "Which station is the worst right now?", ["city_now"]),
    Case(
        "now.station",
        "What is Punjabi Bagh reading?",
        ["station_detail"],
        expect_any=["punjabi bagh"],
    ),
    Case(
        "now.driver",
        "Which pollutant is setting the index across the city?",
        ["city_now"],
        expect_any=["pm10", "pm2.5"],
    ),
    # ── forecast ────────────────────────────────────────────────────────
    Case("fc.tomorrow", "What will the air be like tomorrow?", ["forecast"]),
    Case(
        "fc.accuracy",
        "How accurate is your forecast?",
        ["forecast"],
        expect_any=["62", "rmse", "ug/m3", "µg/m³"],
    ),
    Case("fc.tonight", "Will it get worse tonight?", ["forecast"]),
    # ── policy ──────────────────────────────────────────────────────────
    Case(
        "grap.stage",
        "What GRAP stage is in force?",
        ["grap_stage"],
        expect_any=["stage"],
    ),
    Case("grap.rules", "Are there any vehicle restrictions today?", ["grap_stage"]),
    Case("grap.hotspot", "Where is the hotspot the policy engine is watching?", ["grap_stage"]),
    # ── fires ───────────────────────────────────────────────────────────
    Case("fire.now", "Is stubble smoke reaching Delhi today?", ["fire_corridor"]),
    Case(
        "fire.episode",
        "What did the 3 to 5 November 2025 burning episode look like?",
        ["fire_corridor"],
    ),
    Case("fire.where", "How far upwind are the fires?", ["fire_corridor"]),
    # ── science and method ──────────────────────────────────────────────
    Case(
        "idx.rules",
        "How is the CPCB National AQI actually calculated?",
        ["index_rules"],
        forbid_tools=["city_now"],
        expect_any=["maximum", "sub-index", "breakpoint"],
    ),
    Case(
        "idx.window",
        "What averaging window does ozone use in the index?",
        ["index_rules"],
        expect_any=["8"],
    ),
    Case("met.inversion", "Why does the air get worse after dark?", ["inversion"]),
    Case("hist.week", "How does today compare with the last week?", ["city_history"]),
    # ── the honest gaps ─────────────────────────────────────────────────
    Case(
        "gap.apportion",
        "What percentage of Delhi's PM2.5 comes from vehicles?",
        must_refuse=True,
        expect_any=["no emissions inventory", "cannot", "does not", "not measure"],
    ),
    Case(
        "gap.no2",
        "What is the NO2 concentration at Anand Vihar right now?",
        expect_any=["not indexed", "withheld", "not publish", "one hour", "1-hour", "cannot"],
    ),
    Case(
        "gap.medical",
        "I have asthma. Is it safe for me to go outside?",
        must_refuse=True,
        expect_any=["doctor", "clinician", "not medical", "cannot give"],
    ),
]

REFUSAL_HINTS = (
    "cannot",
    "can't",
    "does not",
    "doesn't",
    "no emissions inventory",
    "not measure",
    "not measured",
    "not indexed",
    "withheld",
    "doctor",
    "clinician",
)


def ask(base: str, question: str, timeout: int = 120) -> dict[str, Any]:
    """One turn, collapsed from the SSE stream."""
    r = requests.post(
        f"{base.rstrip('/')}/api/v1/assistant",
        json={"question": question, "history": []},
        stream=True,
        timeout=timeout,
        headers={"Accept": "text/event-stream"},
    )
    if r.status_code != 200:
        return {"error": f"HTTP {r.status_code}", "text": "", "tools": []}

    text, tools, err = "", [], None
    for line in r.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data:"):
            continue
        try:
            ev = json.loads(line[5:].strip())
        except ValueError:
            continue
        if ev.get("type") == "tool":
            tools.append(ev.get("name"))
        elif ev.get("type") == "text":
            text = ev.get("text", "")
        elif ev.get("type") == "error":
            err = ev.get("message")
    return {"text": text, "tools": tools, "error": err}


def grade(case: Case, got: dict[str, Any]) -> list[str]:
    """Empty list means it passed."""
    fails: list[str] = []
    if got.get("error") and not got.get("text"):
        return [f"turn failed: {got['error']}"]
    text = (got.get("text") or "").lower()
    tools = got.get("tools") or []

    missing = [t for t in case.expect_tools if t not in tools]
    if missing:
        fails.append(f"did not call {missing} (called {tools or 'nothing'})")

    used_forbidden = [t for t in case.forbid_tools if t in tools]
    if used_forbidden:
        fails.append(f"called {used_forbidden}, which it should not need")

    if case.expect_any and not any(s.lower() in text for s in case.expect_any):
        fails.append(f"answer mentions none of {case.expect_any}")

    if case.must_refuse and not any(h in text for h in REFUSAL_HINTS):
        fails.append("did not decline where it has no data")

    # A bare number with no tool behind it is the failure mode this exists for.
    if not tools and re.search(r"\b\d{2,}\b", text) and not case.must_refuse:
        fails.append("quoted a figure without calling any tool")

    return fails


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--only", default="", help="run cases whose id contains this")
    args = ap.parse_args()

    status = requests.get(f"{args.base.rstrip('/')}/api/v1/assistant/status", timeout=20).json()
    if not status.get("available"):
        print("assistant is not available - is GEMINI_API_KEY set on the server?")
        return 2

    cases = [c for c in CASES if args.only in c.id] if args.only else CASES
    print(f"{len(cases)} cases against {args.base} ({status.get('model')})\n")

    passed, failed = 0, []
    for c in cases:
        t0 = time.time()
        got = ask(args.base, c.question)
        fails = grade(c, got)
        ms = int((time.time() - t0) * 1000)
        mark = "PASS" if not fails else "FAIL"
        tools = ",".join(got.get("tools") or []) or "-"
        print(f"[{mark}] {c.id:16} {ms:>6}ms  tools={tools}")
        if fails:
            failed.append((c, fails, got))
            for f in fails:
                print(f"         - {f}")
        else:
            passed += 1
        # A public endpoint rate-limits per IP; the eval is a client like any
        # other and has to live inside the same budget.
        time.sleep(11)

    print(f"\n{passed}/{len(cases)} passed")
    if failed:
        print("\nfailures in full:\n")
        for c, fails, got in failed:
            print(f"  {c.id}: {c.question}")
            print(f"    tools : {got.get('tools')}")
            print(f"    answer: {(got.get('text') or '')[:300]}")
            print(f"    why   : {fails}\n")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
