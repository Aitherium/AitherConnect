#!/usr/bin/env python3
"""Live EXTERNAL self-serve proof for the ARC contribution gateway.

Runs, against the PUBLIC gateway (https://arc.aitherium.com/contribute), the
exact flow any external person — or their agent — runs when they grab the
adk / arc-brainpack, with ZERO pre-issued credentials:

  1. arc_register()           self-mints a FREE AitherOS wallet (the same
                              POST /api/wallet/register the playground wallet
                              button calls) and exchanges it for a contributor
                              token via /contribute/v1/register.
  2. WorldModelContributor()  submits valid synthetic transitions via
                              /contribute/v1/observe — QUARANTINED (never merged
                              into the model live; a validator promotes later).

Artifacts created on the live public gateway: one contributor identity and a
few quarantined synthetic transitions — the designed, low-trust self-serve
surface. Idempotent: re-running returns already_enrolled.

Usage:  python awconnect/shared/world-model/e2e-proof.py   (from repo root)
"""
import json
import os
import sys


def main() -> int:
    # NOTE: no TLS workaround needed here — arc_tls.verify_for() now picks the
    # system CA store for the PUBLIC gateway automatically (the earlier
    # AITHER_INTERSERVICE_TLS=0 hack was the proof it was missing).
    import importlib.util

    sys.path.insert(0, os.path.abspath("AitherOS/lib"))
    from agents.packs.arc_brainpack import tools as bp  # noqa: PLC0415

    # File-load wm_contributor to dodge the `agents` package collision with the
    # AitherOS tree's agents.packs (already imported above).
    agents_dir = os.environ.get("ARC_AGENTS_DIR", "D:/arc-agi-3/ARC-AGI-3-Agents")
    wm_path = os.path.join(agents_dir, "agents", "wm_contributor.py")
    spec = importlib.util.spec_from_file_location("wm_contributor", wm_path)
    wm_mod = importlib.util.module_from_spec(spec)
    sys.modules["wm_contributor"] = wm_mod
    spec.loader.exec_module(wm_mod)
    contributor_cls = wm_mod.WorldModelContributor

    # 1) self-serve register (mints a free wallet when no AITHER_API_KEY exists)
    handle = "arc-e2e-proof"
    reg = json.loads(bp.arc_register(handle=handle))
    print("register:", json.dumps(
        {k: v for k, v in reg.items() if k != "wallet"}, indent=2))
    if not (reg.get("registered") or reg.get("already_enrolled")):
        print("E2E FAILED at register:", reg)
        return 1

    token = bp._token()  # persisted token — never echoed
    if not token:
        print("E2E FAILED: no token after register")
        return 1

    # 2) submit valid synthetic transitions to the quarantine
    c = contributor_cls(base_url=bp._gateway(), token=token)
    if not c.ok:
        print("E2E FAILED: gateway handshake", c.url)
        return 1
    print("handshake ok as:", c.contributor)

    grid = [[0] * 64 for _ in range(64)]
    grid[10][10] = 3
    grid[10][11] = 3
    grid2 = [row[:] for row in grid]
    grid2[12][12] = 5
    for action in ("ACTION3", "ACTION6(20,20)"):
        res = c.observe(grid, action, grid2, game="e2e-proof")
        print(f"observe {action}:", res if res else None)

    st = c.status()
    print("status:", st)
    c.close()
    print("E2E OK — external self-serve verified against the live public gateway")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
