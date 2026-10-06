# Awconnect: Chrome Web Store readiness

The Chrome Web Store is the only real one-click install for Awconnect. Load
unpacked (what `adk awconnect install` guides) needs Developer mode and two
clicks. Stable Chrome ignores `--load-extension`. Force-install policy only
works on managed machines. Nothing was published while writing this report. It
records what is missing and the exact steps an owner takes to publish.

Measured 2026-09-27 against `develop` (`awconnect/manifest.json` 3.8.0);
store zip rebuilt + verified at current develop 2026-10-06 (`aither-connect-public-v3.9.0.zip`).

## 1. What the release workflow needs

`.github/workflows/build-connect.yml` runs on tags matching `connect-v*`. It
builds `aither-connect-public-v<ver>.zip`, which is `manifest.public.json`
swapped in with the capture scripts stripped, and uploads it with
`chrome-webstore-upload-cli`. When `CWS_EXTENSION_ID` is empty the step exits 0
and prints "skipping", so a green run does **not** mean the extension was
published.

| Secret (names only) | Store | Set today? |
|---|---|---|
| `CWS_EXTENSION_ID` | Chrome Web Store | **no** (absent from `gh secret list`) |
| `CWS_CLIENT_ID` | Chrome Web Store | **no** |
| `CWS_CLIENT_SECRET` | Chrome Web Store | **no** |
| `CWS_REFRESH_TOKEN` | Chrome Web Store | **no** |
| `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_CLIENT_SECRET`, `EDGE_ACCESS_TOKEN_URL` | Edge Add-ons | **no** |
| `AMO_API_JWT_ISSUER`, `AMO_API_JWT_SECRET` | Firefox AMO | **no** |

So no `connect-v*` tag has ever reached a store. The latest release is
`connect-v3.6.4` (2026-07-30), which is older than the 3.8.0 tree.

Workflow gaps to fix before the first automated publish:

- The upload step uploads a draft. It does **not** submit for review
  (`chrome-webstore-upload-cli upload` with no `publish`). That is safe for the
  first listing. Once the listing exists, add `--auto-publish`, or run a
  `publish` step, so tags actually ship.
- `continue-on-error: true` on the store steps means a rejected upload never
  turns the run red. Keep that for the first release, then drop it so a failed
  publish is visible.

## 2. Is `manifest.public.json` store-compliant?

| Check | Verdict | Detail |
|---|---|---|
| MV3, no remote code | pass | `script-src 'self' 'wasm-unsafe-eval'` (WASM is allowed). No `eval`/`new Function` in `background.js`. |
| Broad host access | pass | Host permissions cover loopback, `*.aitherium.com` and `regulations.gov` only. Provider hosts are **optional** and are requested at use time. `Build-Distributions.ps1` refuses a public build that keeps `*://*/*`. |
| Capture code | pass | `discovery*`, `value-capture`, `api-capture*`, `har-recorder`, `har-relay` are stripped and the build asserts they are gone. (`shared/har-crypto.js` ships by design — it seals HARs for the user-initiated "Send to Aitherium" path, called from `background.js` `harUpload`.) |
| `version` | ok | The file says 3.6.4, but the builder stamps the manifest.json version into the staged copy, so the zip carries 3.8.0. Keep the two in sync anyway to avoid confusion. |
| **`cookies` permission** | **risk** | Used to read the `aither_auth_token` cookie on `*.aitherium.com`, which is justifiable. Its other use, `xSessionSync` reading x.com/twitter.com cookies, cannot work in the public build because those hosts are not granted, and a reviewer will ask about it. Justify it as "read the Aitherium sign-in cookie on aitherium.com only", or drop it from the public manifest now that sign-in uses the device-flow token. |
| `tabs`, `scripting` | needs justification | These are used for side-panel page context and the command bar. Say "reads the active page only when the user asks". |
| `unlimitedStorage` | needs justification | Local knowledge base (IndexedDB). No `chrome.unlimitedStorage` API call is expected; the permission lifts the quota. |
| `offscreen` | needs justification | On-device model / audio work in an offscreen document. |
| `omnibox`, `contextMenus`, `notifications`, `alarms`, `sidePanel` | low risk | Each maps to a visible feature. |
| **Privacy policy URL** | **missing in listing** | `docs/PRIVACY_POLICY.md` exists, but the repo is **private**, so the GitHub link in `docs/CWS_REVIEW_GUIDE.md` would 404 for a reviewer. `https://aitherium.com/privacy` answers 200. Use it after confirming it covers the extension (local KB, BYOK keys stay in `chrome.storage.local`, no sale or analytics), or publish `PRIVACY_POLICY.md` at a public URL. |
| Single purpose | needs a sentence | Suggested: "An AI assistant in the side panel that chats about and saves the pages you read, using your own API key or your AitherOS account." |
| Data-use disclosures | needs the form | Declare: authentication info (the Aitherium sign-in token) and website content (pages you choose to save). Nothing is sold, nothing is used for ads, nothing unrelated is transferred. |

## 3. Exact owner steps to publish (one time, about 30 minutes plus review)

1. **Developer account.** Sign in at <https://chrome.google.com/webstore/devconsole>
   with the Aitherium Google account and pay the one-time US$5 fee. This spends
   money, so it is an owner click.
2. **Build the zip.** Either push a tag `connect-v3.8.0` (the manifest guard
   requires the tag to match) and download `aither-connect-public-v3.8.0.zip`
   from the run's artifact or release, or run
   `pwsh -File scripts/Build-Distributions.ps1 -Target Connect -Version 3.8.0`.
3. **New item, then upload the zip.** Fill in the listing: name, description
   (from the manifest), category Productivity, the 128px icon from `icons/`, at
   least one 1280x800 screenshot of the side panel, the **single purpose**
   sentence above, a **justification for each permission** (table above), the
   **data-use** form, and the **privacy policy URL**.
4. **Visibility.** Choose "Unlisted" first. Only people with the link can
   install it, which is enough for owner and pilot machines and still gives a
   one-click install. Switch to Public later.
5. **Submit for review.** Copy the extension ID from the item URL.
6. **Wire CI.** Create the OAuth client (Google Cloud project, enable the
   *Chrome Web Store API*, create an OAuth client of type Desktop, and get a
   refresh token with `chrome-webstore-upload-cli` or the OAuth playground).
   Then add the four secrets `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`,
   `CWS_CLIENT_SECRET` and `CWS_REFRESH_TOKEN` in the repository's Actions
   secrets.
7. **After the listing is approved,** add auto-publish to the upload step
   (see section 1). Every `connect-v*` tag then reaches users with no clicks.
8. **Point the installers at the store.** `adk awconnect install` and the
   onboarding page can then open the store listing instead of
   `chrome://extensions`. That is a one-line change once the ID exists.

The Edge Add-ons listing follows the same steps
(<https://partner.microsoft.com/dashboard/microsoftedge>) with the four
`EDGE_*` secrets. The Edge upload step already submits for publication.
