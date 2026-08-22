#!/usr/bin/env python3
"""Cross-language JSONL parity: the REAL service WorldModel vs the JS port.

Builds one transition sequence, serializes it with the real
lib.cognitive.UnifiedMCTS.WorldModel.save() (and real _stable_hash), then runs
node world-model.parity.js over the same sequence and diffs the canonical
records line-for-line. Exits 0 on parity; non-zero on any mismatch.

This closes the one gap the unit test could not: the unit test proves hash
equality (vectors) and engine semantics (behavior) separately, but this proves
the FULL serialize()/save() output matches byte-for-byte across languages
(modulo the documented int-vs-hex-string representation, which is normalized
to the shared 64-bit decimal value on both sides).

Usage: python world-model.parity.py
"""
import os
import subprocess
import sys
import tempfile

from lib.cognitive.UnifiedMCTS import WorldModel  # noqa: E402 (host import path)
from lib.core.PillarWiring import _stable_hash  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def build_and_serialize():
    """Return canonical JSONL records produced by the REAL WorldModel.save()."""
    wm = WorldModel()
    sh = _stable_hash("s1")
    n1 = _stable_hash("n1")
    n2 = _stable_hash("n2")
    wm.record(sh, "A", n1, 0.5, False, "FAILURE")
    wm.record(sh, "A", n2, 1.0, True, "SUCCESS")
    wm.record(sh, "A", n2, 1.0, True, "SUCCESS")  # merges -> count 2
    wm.record(sh, "B", n2, 0.0, False, "SUCCESS")
    wm.record_state_value(sh, 0.25)

    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "wm.jsonl")
        wm.save(path)  # the real save(): field names + order must match the JS port
        lines = []
        with open(path, encoding="utf-8") as f:
            for raw in f:
                t = raw.strip()
                if not t:
                    continue
                # json.dumps default separators are ", " / ": "; the JS port
                # writes compact. Strip whitespace (safe for this fixed
                # sequence: no string value contains ", " or ": "). Hashes are
                # already decimal ints here; the JS side converts its hex to the
                # same decimal. Reward floats ("1.0") pass through untouched so
                # a type drift is caught.
                t = t.replace(": ", ":").replace(", ", ",")
                lines.append(t)
        return lines


def main():
    py_lines = build_and_serialize()

    js = subprocess.run(
        ["node", os.path.join(HERE, "world-model.parity.js")],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if js.returncode != 0:
        print("JS parity side failed:\n" + js.stderr, file=sys.stderr)
        return 2
    js_lines = [ln for ln in js.stdout.strip().splitlines() if ln.strip()]

    if py_lines != js_lines:
        msg = (
            f"PARITY MISMATCH: python {len(py_lines)} records, "
            f"js {len(js_lines)} records"
        )
        print(msg, file=sys.stderr)
        for i, (a, b) in enumerate(zip(py_lines, js_lines)):
            if a != b:
                print(f"  record {i}:\n    py  {a}\n    js  {b}", file=sys.stderr)
                break
        if len(py_lines) != len(js_lines):
            print(
                f"  (record counts differ: py={len(py_lines)} js={len(js_lines)})",
                file=sys.stderr,
            )
        return 1

    print(
        f"PARITY OK: {len(py_lines)} records — real WorldModel.save() and "
        "JS serialize() identical"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
