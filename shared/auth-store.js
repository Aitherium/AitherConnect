/**
 * One sign-in record for the whole extension, plus the "already signed in on
 * this machine" rung that fills it with no typing.
 *
 *   chrome.storage.local.aither_auth = {
 *     user_bearer,   // Identity session token, or null (signed in locally only)
 *     expires_at,    // epoch ms, or null
 *     source,        // 'awdk' | 'oidc'
 *     user: { id, username, display_name, tenant_slug },
 *     gateway_key?,  // a gateway key, kept apart: it is never a user bearer
 *     expired?,      // true when a silent re-auth failed: show "Sign in again"
 *   }
 *
 * The local rung: the awdk daemon on 127.0.0.1 answers /identity/whoami and
 * mints a single-use handoff ticket ONLY for this extension's pinned origin
 * (web pages cannot forge a chrome-extension Origin, and other extensions are
 * not on the daemon's list). The ticket is redeemed at the IdP for this
 * extension's own session. Tokens are never logged.
 */
(function (root) {
  const KEY = "aither_auth";
  const IDP_DEFAULT = "https://idp.aitherium.com/identity";

  function defaultStorage() {
    const c = root.chrome;
    return c && c.storage && c.storage.local ? c.storage.local : null;
  }

  async function get(storage) {
    const s = storage || defaultStorage();
    if (!s) return null;
    const got = await s.get(KEY);
    const rec = got && got[KEY];
    if (!rec || typeof rec !== "object") return null;
    if (rec.user_bearer && rec.expires_at && Date.now() >= rec.expires_at) {
      // An expired bearer is not a credential; keep the name.
      return { ...rec, user_bearer: null, expired: true };
    }
    return rec;
  }

  async function set(rec, storage) {
    const s = storage || defaultStorage();
    if (!s) return null;
    if (!rec) {
      await s.remove(KEY);
      return null;
    }
    const user = rec.user || {};
    const clean = {
      user_bearer: rec.user_bearer || null,
      expires_at: rec.expires_at || null,
      source: rec.source === "oidc" ? "oidc" : "awdk",
      user: {
        id: user.id || "",
        username: user.username || "",
        display_name: user.display_name || user.username || "",
        tenant_slug: user.tenant_slug || "",
      },
    };
    if (rec.gateway_key) clean.gateway_key = rec.gateway_key;
    // A session that could not be renewed silently: the UI says "Sign in again".
    if (rec.expired && !clean.user_bearer) clean.expired = true;
    await s.set({ [KEY]: clean });
    return clean;
  }

  async function getUserBearer(storage) {
    const rec = await get(storage);
    return (rec && rec.user_bearer) || null;
  }

  async function setUserBearer(token, storage) {
    const cur = (await get(storage)) || { source: "oidc", user: {} };
    if (!token) {
      if (!cur.user || !cur.user.username) return set(null, storage);
      return set({ ...cur, user_bearer: null, expires_at: null }, storage);
    }
    return set({ ...cur, user_bearer: token }, storage);
  }

  async function clear(storage) {
    return set(null, storage);
  }

  /**
   * Rung 0 of resolveIdentity: the awdk daemon's `adk login` session.
   * Returns {ok, source:'awdk', identity, token|null, cloud:boolean} or {ok:false}.
   */
  async function signInFromLocalAdk({ adkBase, audience, idpBase, fetchImpl, storage, timeoutMs }) {
    const f = fetchImpl || root.fetch;
    const t = timeoutMs || 4000;
    const sig = () => (root.AbortSignal && root.AbortSignal.timeout ? root.AbortSignal.timeout(t) : undefined);
    if (!adkBase || !audience) return { ok: false, error: "no local daemon" };
    const base = adkBase.replace(/\/+$/, "");
    let who;
    try {
      const r = await f(`${base}/identity/whoami`, { signal: sig() });
      if (!r.ok) return { ok: false, status: r.status, error: `whoami ${r.status}` };
      who = await r.json();
    } catch (e) {
      return { ok: false, error: "local daemon unreachable" };
    }
    if (!who || !who.logged_in) {
      return { ok: false, error: (who && who.hint) || "not signed in on this device" };
    }
    const user = {
      id: "",
      username: who.username || "",
      display_name: who.display_name || who.username || "",
      tenant_slug: who.tenant_slug || "",
    };
    // Ticket from the daemon, redeemed at the IdP for THIS extension's origin.
    try {
      const h = await f(`${base}/identity/handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: sig(),
      });
      if (h.ok) {
        const { ticket } = await h.json();
        if (ticket) {
          const idp = (idpBase || IDP_DEFAULT).replace(/\/+$/, "");
          const rr = await f(`${idp}/auth/handoff/redeem`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticket, audience }),
            signal: sig(),
          });
          if (rr.ok) {
            const body = await rr.json();
            if (body && body.access_token) {
              const u = body.user || {};
              const rec = await set({
                user_bearer: body.access_token,
                expires_at: body.expires_in ? Date.now() + body.expires_in * 1000 : null,
                source: "awdk",
                user: {
                  id: u.id || u.user_id || "",
                  username: u.username || user.username,
                  display_name: u.display_name || user.display_name,
                  tenant_slug: u.tenant_slug || user.tenant_slug,
                },
              }, storage);
              return { ok: true, source: "awdk", cloud: true, token: body.access_token,
                identity: { ...rec.user, tenant_slug: rec.user.tenant_slug } };
            }
          }
        }
      }
    } catch (_) {
      /* IdP or daemon refused: fall through to the name-only record */
    }
    // Signed in locally; the IdP did not (yet) accept this extension's audience.
    await set({ user_bearer: null, expires_at: null, source: "awdk", user }, storage);
    return { ok: true, source: "awdk", cloud: false, token: null, identity: user,
      note: `Signed in locally as ${user.display_name || user.username}; cloud features pending` };
  }

  root.AitherAuthStore = {
    KEY, IDP_DEFAULT, get, set, clear, getUserBearer, setUserBearer, signInFromLocalAdk,
  };
})(typeof self !== "undefined" ? self : globalThis);
