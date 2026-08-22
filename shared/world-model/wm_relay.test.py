#!/usr/bin/env python3
"""wm_relay tests. Plain python: `python wm_relay.test.py`. Exit non-zero on
failure — a check that can fail. The real gateway is not reachable here (the
server token is by design server-side and none exists on this host), so the
submit() contract is locked with a fake contributor: counting, fail-soft, and
the offline (no-token) path.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wm_relay import submit  # noqa: E402

FAILURES = []


def check(name, ok, detail=""):
    if ok:
        print("PASS " + name)
    else:
        FAILURES.append(name)
        print(f"FAIL {name} :: {detail}")


class FakeContributor:
    """Mimics WorldModelContributor: .ok, .observe returns quarantined or None."""

    ok = True

    def __init__(self, accept=True):
        self.accept = accept
        self.calls = []

    def observe(self, state, action, next_state, game=None, client_ts=None):
        self.calls.append({"action": action, "game": game, "client_ts": client_ts})
        if self.accept:
            return {"quarantined": True, "accepted": 1}
        return None


class OfflineContributor:
    ok = False


def test_offline_no_token():
    r = submit([{"state": 1, "action": "A", "next_state": 2}], contributor=OfflineContributor())
    rejected = r["rejected"] == 1 and r["quarantined"] == 0
    no_token = any("no gateway token" in e for e in r["errors"])
    check("offline (no server token) rejects all and reports it", rejected and no_token, str(r))


def test_accepted_batch():
    c = FakeContributor()
    trans = [
        {"state": [[0]], "action": "ACTION6(2,3)", "next_state": [[1]], "game": "ls20"},
        {"state": [[1]], "action": "ACTION3", "next_state": [[0]]},
    ]
    r = submit(trans, contributor=c, client_ts=123.0)
    check("accepted batch quarantined", r["quarantined"] == 2 and r["rejected"] == 0, str(r))
    ts_ok = c.calls and all(call["client_ts"] == 123.0 for call in c.calls)
    check("client_ts passed through", ts_ok, str(c.calls))
    game_ok = c.calls and c.calls[0]["game"] == "ls20"
    check("game passed through on the first", game_ok, str(c.calls))


def test_failed_submit_counts_rejected():
    c = FakeContributor(accept=False)
    trans = [{"state": 1, "action": "A", "next_state": 2}]
    r = submit(trans, contributor=c)
    rejected = r["rejected"] == 1 and len(r["errors"]) == 1
    check("failed observe counts rejected with error",
          rejected and "observe failed" in r["errors"][0], str(r))


def test_mixed_batch():
    class Mixed(FakeContributor):
        def __init__(self):
            super().__init__(accept=True)
            self.n = 0

        def observe(self, state, action, next_state, game=None, client_ts=None):
            self.n += 1
            return {"quarantined": True} if self.n == 1 else None

    c = Mixed()
    r = submit([{"state": 1, "action": "A", "next_state": 2},
                {"state": 2, "action": "B", "next_state": 3}], contributor=c)
    check("mixed batch: one quarantined, one rejected",
          r["quarantined"] == 1 and r["rejected"] == 1, str(r))


def test_empty_batch():
    c = FakeContributor()
    r = submit([], contributor=c)
    check("empty batch -> zeros", r["quarantined"] == 0 and r["rejected"] == 0, str(r))


test_offline_no_token()
test_accepted_batch()
test_failed_submit_counts_rejected()
test_mixed_batch()
test_empty_batch()

print("")
print(f"{5 - len(FAILURES)} passed, {len(FAILURES)} failed")
if FAILURES:
    print("Failures: " + ", ".join(FAILURES))
    sys.exit(1)
