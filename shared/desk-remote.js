/**
 * desk-remote — mute, volume and captions for your desktop avatars, from the
 * browser toolbar.
 *
 * The desktop app syncs its settings to the `awdesk` namespace of the portal's
 * preferences store. This module is the extension's half: read that namespace,
 * and write ONE field back. It never talks to the desktop directly -- the change
 * is waiting in the store when the desk next syncs, so it works while the desk is
 * asleep or on another machine.
 *
 * Two rules, shared with the other clients of that store:
 *
 *   ONE FIELD PER WRITE. The store deep-merges objects, so {voice:{volume:0.4}}
 *   moves a fader and nothing else. Writing the whole blob back would stamp this
 *   popup's copy -- read whenever it was last opened -- over a change made since.
 *
 *   A 200 IS NOT "STORED". The store drops keys whose NAME looks like a
 *   credential and still answers ok, so the echo is read back. A field that did
 *   not survive is a failure, never a silent success.
 *
 * Bounds mirror the desk's own validator: it DROPS an out-of-range value on load
 * instead of clamping it, so a number let through here would be stored, synced,
 * and then ignored -- a slider that moves and does nothing.
 *
 * No chrome.* and no DOM in here on purpose: the portal calls are injected, so the
 * whole module runs under plain Node in a test.
 */

const DESK_NAMESPACE = "awdesk";

const DESK_NUMBER_BOUNDS = Object.freeze({
  "voice.volume": { min: 0, max: 1 },
});
const DESK_BOOLEAN_FIELDS = Object.freeze(["voice.muted", "stage.bubbles"]);

function deskObj(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** Defensive by construction: this is a synced blob other programs write. */
function parseDeskRemote(preferences) {
  const prefs = deskObj(preferences);
  const ns = deskObj(prefs[DESK_NAMESPACE]);
  const voice = deskObj(ns.voice);
  const stage = deskObj(ns.stage);
  const volume = typeof voice.volume === "number" && Number.isFinite(voice.volume) ? voice.volume : null;
  return {
    // No desk has ever synced to this account: the popup should SAY that rather
    // than show confident defaults for a desk that is not listening.
    stored: DESK_NAMESPACE in prefs,
    volume: volume === null ? 1 : Math.min(1, Math.max(0, volume)),
    volumeSet: volume !== null,
    muted: voice.muted === true,
    bubbles: stage.bubbles !== false, // unset reads ON, as the desk's built-in does
  };
}

/** @returns {{ok:true, value:number|boolean}|{ok:false, reason:string}} */
function checkDeskField(section, field, value) {
  const key = `${section}.${field}`;
  if (DESK_BOOLEAN_FIELDS.includes(key)) {
    return typeof value === "boolean" ? { ok: true, value } : { ok: false, reason: "expected true or false" };
  }
  const bounds = DESK_NUMBER_BOUNDS[key];
  if (!bounds) return { ok: false, reason: `unknown setting ${key}` };
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return { ok: false, reason: "not a number" };
  if (n < bounds.min || n > bounds.max) return { ok: false, reason: `must be between ${bounds.min} and ${bounds.max}` };
  return { ok: true, value: n };
}

/** The patch for ONE field. `version: 1` rides along so a machine whose file does
 *  not exist yet still receives a blob its reader accepts. */
function buildDeskPatch(section, field, value) {
  return { [DESK_NAMESPACE]: { version: 1, [section]: { [field]: value } } };
}

/**
 * @param {{get: Function, put: Function}} portal  getProfileSettings / putProfileSettings
 *
 * The injected calls REJECT on a network failure (fetch throws when the portal is
 * unreachable), so both are awaited through portalCall: a thrown call is a
 * failed result like any other, never an unhandled rejection that leaves the
 * popup on "Saving..." with a control showing a value nothing stored.
 */
async function portalCall(fn, arg) {
  try {
    return await fn(arg);
  } catch (_) {
    return { ok: false, reason: "could not reach the portal" };
  }
}

async function readDeskRemote(portal) {
  const r = await portalCall(portal.get);
  if (!r || r.ok !== true) return { ok: false, reason: (r && r.reason) || "could not reach the portal" };
  return { ok: true, desk: parseDeskRemote(r.preferences) };
}

async function writeDeskField(portal, section, field, value) {
  const checked = checkDeskField(section, field, value);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  const r = await portalCall(portal.put, buildDeskPatch(section, field, checked.value));
  if (!r || r.ok !== true) return { ok: false, reason: (r && r.reason) || "could not reach the portal" };
  const echoed = deskObj(deskObj(deskObj(r.preferences)[DESK_NAMESPACE])[section]);
  if (!(field in echoed)) return { ok: false, reason: "the portal accepted the change and did not keep it" };
  return { ok: true, desk: parseDeskRemote(r.preferences) };
}

self.AitherDeskRemote = {
  DESK_NAMESPACE,
  parseDeskRemote,
  checkDeskField,
  buildDeskPatch,
  readDeskRemote,
  writeDeskField,
};
