/**
 * The ONE place the extension's pinned id is written down.
 *
 * Both manifests carry the same "key" (the public half of the signing key), so
 * Chrome gives every install -- store build or unpacked folder -- this id. The
 * local awdk daemon trusts exactly this origin for sign-in handoff (its
 * AITHER_TRUSTED_EXTENSION_IDS default), and the IdP accepts it as a ticket
 * audience. The repository wiring check fails if the manifests' key and
 * this constant drift apart.
 */
const AWCONNECT_EXTENSION_ID = "hlmfknhcfhjjngckfpacgleffckpmphe";

(typeof self !== "undefined" ? self : globalThis).AWCONNECT_EXTENSION_ID = AWCONNECT_EXTENSION_ID;
