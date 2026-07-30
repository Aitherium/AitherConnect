# AitherConnect Chrome Web Store Submission

This document describes the one-time manual setup required to publish AitherConnect to the Chrome Web Store via CI/CD.

## Overview

The AitherConnect workflow (`.github/workflows/build-connect.yml`) includes automated Chrome Web Store publishing, triggered on tags matching `connect-v*`. The workflow builds the extension, computes checksums, and uploads the public variant via the Chrome Web Store API.

## One-Time Setup Steps

### 1. Create a Chrome Web Store Developer Account

1. Navigate to [Google Play Console](https://play.google.com/console/) (or the dedicated [Chrome Web Store Dashboard](https://chrome.google.com/webstore/devconsole/) if available)
2. Register as a developer (one-time fee: ~$5 USD)
3. Set up a publisher profile (name, email, branding)
4. Keep your developer email and account active for OAuth credential generation

### 2. First Manual Upload & Store Listing

Before automation can work, you must manually upload the extension and create its store listing:

1. In the Chrome Web Store Console, click **New item** → select "Extension"
2. Upload the public package: `dist/aither-connect-public-v3.0.0.zip` (build locally via `scripts/Build-Distributions.ps1 -Target Connect` or grab from a workflow artifact)
3. Fill in the store listing:
   - **Name:** AitherConnect — AI Chat & Knowledge Assistant
   - **Description:** AI browsing assistant with a local knowledge base. Bring your own API key (Anthropic, OpenAI, OpenRouter, Gemini, Ollama) — chat, save and search what you read.
   - **Category:** Productivity
   - **Languages:** English
   - **Category tags:** AI, Assistant, ChatGPT, Knowledge Management
   - **Icon & screenshots:** Use graphics from AitherConnect/icons/ + demo/
4. Accept the developer agreement
5. Save as a draft (DO NOT publish yet — wait for the release tag workflow to automate future updates)
6. Note the **Extension ID** from the listing URL: `https://chrome.google.com/webstore/detail/<EXTENSION_ID>`

### 3. Generate OAuth Credentials for CI/CD

The workflow uses the Chrome Web Store API (OAuth 2.0 client credentials) to upload on your behalf. Generate these credentials **once** and store them as GitHub repository secrets.

#### Option A: Google Cloud Console (Recommended)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (name: "AitherConnect CI" or similar)
3. Enable the **Chrome Web Store API** (search in the API library)
4. Create a **Service Account** (not a User OAuth):
   - Go to **IAM & Admin** → **Service Accounts**
   - Click **Create Service Account**
   - Name: `aitherconnect-ci` or similar
   - Grant role: **Editor** (for Web Store API access)
5. Create an API key or OAuth client:
   - Click on the service account → **Keys** tab
   - Create a new JSON key
   - Download and parse the JSON to extract credentials (details below)

#### Option B: Chrome Web Store OAuth Flow (via Manual Authorization)

If the Google Cloud approach is unavailable, use the Chrome Web Store's direct OAuth:

1. Install the [`chrome-webstore-upload-cli`](https://github.com/mubaidr/chrome-webstore-upload-cli) locally:
   ```bash
   npm install -g chrome-webstore-upload-cli
   ```

2. Generate credentials via the CLI's OAuth flow:
   ```bash
   chrome-webstore-upload-cli auth
   ```
   This will:
   - Open a browser to authenticate with your Google account
   - Ask for permission to access the Chrome Web Store API
   - Return a refresh token

### 4. Extract & Store Credentials as GitHub Secrets

Regardless of the method above, you need four credentials. Go to your GitHub repository **Settings** → **Secrets and variables** → **Actions**, and add:

| Secret Name | Value | Source |
|---|---|---|
| `CWS_EXTENSION_ID` | Your extension's ID (from step 2.6 above) | Chrome Web Store Console URL |
| `CWS_CLIENT_ID` | OAuth Client ID | Google Cloud Console or `chrome-webstore-upload-cli auth` output |
| `CWS_CLIENT_SECRET` | OAuth Client Secret | Google Cloud Console (JSON key) or `chrome-webstore-upload-cli auth` |
| `CWS_REFRESH_TOKEN` | OAuth Refresh Token | `chrome-webstore-upload-cli auth` flow result |

**Security notes:**
- These credentials are sensitive — treat them like passwords
- The workflow uses `continue-on-error: true` so a secret misconfiguration won't block the entire release
- Rotate credentials periodically (especially the refresh token)

### 5. Test the Workflow

Push a test tag to verify the workflow works:

```bash
git tag connect-v3.0.1
git push origin connect-v3.0.1
```

Then check:
1. `.github/workflows/build-connect.yml` run in the **Actions** tab
2. The "Publish to Chrome Web Store (public variant)" step should show:
   - **Success**: Package uploaded to the Web Store (may take hours to appear in the store)
   - **Skipped**: `CWS_EXTENSION_ID` not set (re-check your secrets)
   - **Warning**: Upload failed with a 4xx error (check OAuth credentials are valid and the extension ID matches)

Once tested, publish the draft to the store manually or trigger another release tag.

## Ongoing Use

After the one-time setup:

1. **Update the extension**: Edit code, bump the version in `AitherConnect/manifest.json`
2. **Create a release tag**: `git tag connect-v<VERSION>` and push
3. **CI/CD publishes automatically**: The workflow builds, computes checksums, uploads to the store, and creates a GitHub release
4. **Manual review**: The Chrome Web Store may require a brief manual review (~24 hours) before the update appears in the store

## Troubleshooting

### Secret Not Recognized
- Double-check the secret name is exactly `CWS_EXTENSION_ID` (case-sensitive)
- Ensure it's in the correct repository (not a fork or organization secret)

### Upload Returns 401 Unauthorized
- The OAuth token may have expired — regenerate via `chrome-webstore-upload-cli auth` and update `CWS_REFRESH_TOKEN`
- Verify the client ID and secret match

### Upload Returns 400 Bad Request
- The zip file may be corrupted — verify `aither-connect-public-v*.zip` is valid (unzip locally)
- The manifest version may not match the release tag — the workflow has a guard to prevent this

### Store Review Rejected
- The extension may violate store policies (e.g., overly broad permissions, misleading description)
- Review [Chrome Web Store policies](https://chrome.google.com/webstore/category/policies) and resubmit with corrections

## References

- [Chrome Web Store API Documentation](https://developer.chrome.com/webstore)
- [`chrome-webstore-upload-cli`](https://github.com/mubaidr/chrome-webstore-upload-cli) (the CLI tool used in CI)
- [Chrome Web Store Publishing Policies](https://chrome.google.com/webstore/category/policies)
- [Manifest v3 Migration Guide](https://developer.chrome.com/docs/extensions/mv3/)
