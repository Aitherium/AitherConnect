#!/usr/bin/env python3
"""ArcContribute server relay — the token boundary for in-browser contribution.

The browser bridge (contribute-bridge.js) never holds a contributor token. It
POSTs raw (state, action, next_state) transitions to THIS relay; the relay holds
the server's contributor token (WM_CONTRIB_TOKEN / the vault) and submits each
transition through the EXISTING WorldModelContributor.observe() — the same
/contribute/v1/observe quarantine/trust/rate-limit plane the fleet already
rides. No new trust decisions (BYO-COGNITION-PROGRAM.md ground rule #1).

submit() is pure and testable: pass a fake contributor in tests; the default
builds the real WorldModelContributor from the ARC-AGI-3-Agents tree (via
ARC_AGENTS_DIR, mirroring arc_brainpack tools.py's loader). Never raises —
every failure counts as rejected and is reported.
"""
import os
import sys
import time
from typing import Any, Dict, List, Optional


def _build_contributor() -> Any:
    agents_dir = os.environ.get("ARC_AGENTS_DIR", "D:/arc-agi-3/ARC-AGI-3-Agents")
    if agents_dir not in sys.path:
        sys.path.insert(0, agents_dir)
    from agents.wm_contributor import WorldModelContributor

    return WorldModelContributor()


def submit(
    transitions: List[Dict[str, Any]],
    contributor: Optional[Any] = None,
    client_ts: Optional[float] = None,
) -> Dict[str, Any]:
    """Submit a browser transition batch to the gateway quarantine.

    Each transition: {"state", "action", "next_state", "game"?}. The gateway
    filters syntactically (64x64 int grids; parseable non-RESET action) — a 422
    counts as rejected. Returns {quarantined, accepted, rejected, errors} and
    never raises.
    """
    c = contributor if contributor is not None else _build_contributor()
    if not getattr(c, "ok", False):
        return {
            "quarantined": 0,
            "accepted": 0,
            "rejected": len(transitions or []),
            "errors": ["no gateway token (server-side) — relay offline"],
        }

    stats: Dict[str, Any] = {"quarantined": 0, "accepted": 0, "rejected": 0, "errors": []}
    ts = client_ts or time.time()
    for t in transitions or []:
        res = c.observe(
            t.get("state"), t.get("action"), t.get("next_state"),
            game=t.get("game"), client_ts=ts,
        )
        if res is None:
            stats["rejected"] += 1
            stats["errors"].append(f"observe failed for action={t.get('action')!r}")
        elif res.get("quarantined"):
            stats["quarantined"] += 1
        else:
            stats["rejected"] += 1
    return stats


if __name__ == "__main__":
    # CLI: python wm_relay.py <batch.json> — submit and print the result.
    import json
    import pathlib

    batch_path = sys.argv[1] if len(sys.argv) > 1 else ""
    if not batch_path:
        print(
            "usage: python wm_relay.py <batch.json>  "
            "(transitions: [{state, action, next_state}])"
        )
        raise SystemExit(2)
    payload = json.loads(pathlib.Path(batch_path).read_text(encoding="utf-8"))
    transitions = payload.get("transitions", payload if isinstance(payload, list) else [])
    print(json.dumps(submit(transitions), indent=2))
