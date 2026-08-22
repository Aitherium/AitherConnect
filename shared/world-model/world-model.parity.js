/**
 * JS side of the cross-language JSONL parity check (run by world-model.parity.py).
 * Builds the SAME transition sequence as the Python side and prints each RAW
 * journal record with only the one representation difference normalized: the
 * 16-hex-char hash -> its 64-bit decimal value (Python writes ints). Everything
 * else — including the float form of rewards ("1.0", not "1") — is preserved so
 * the Python side can diff it byte-for-byte.
 *
 * Usage: node world-model.parity.js   (writes canonical records to stdout)
 */
"use strict";
const { stableHash, WorldModel } = require("./world-model.js");

function canonical(rawLine) {
  return rawLine
    .replace(/"state_hash":"([0-9a-f]{16})"/g, (_, h) => '"state_hash":' + BigInt("0x" + h))
    .replace(/"next_state_hash":"([0-9a-f]{16})"/g, (_, h) => '"next_state_hash":' + BigInt("0x" + h));
}

const wm = new WorldModel();
const sh = stableHash("s1");
const n1 = stableHash("n1");
const n2 = stableHash("n2");
wm.record(sh, "A", n1, 0.5, false, "FAILURE");
wm.record(sh, "A", n2, 1.0, true, "SUCCESS");
wm.record(sh, "A", n2, 1.0, true, "SUCCESS"); // merges -> count 2
wm.record(sh, "B", n2, 0.0, false, "SUCCESS");
wm.recordStateValue(sh, 0.25);

for (const line of wm.serialize().split("\n")) {
  if (line.trim()) console.log(canonical(line));
}
