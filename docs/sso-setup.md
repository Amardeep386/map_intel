# Sign in with Google / Microsoft: setting it up

MAP Intel offers "Continue with Google" and "Continue with Microsoft" on the sign-in page once each
provider's client id and secret are set on the API (Render). Nothing changes for anyone until then.
Built in Phase 5 · M8 (`server/src/lib/sso.ts`, `server/src/api/routes/auth.ts`, migration 048).

The redirect (callback) URIs to register, for the live API:

| Provider | Redirect URI |
|---|---|
| Google | `https://map-intel-api.onrender.com/auth/sso/google/callback` |
| Microsoft | `https://map-intel-api.onrender.com/auth/sso/microsoft/callback` |

For local development add `http://localhost:4000/auth/sso/google/callback` (and `.../microsoft/callback`) too.

## Google (Google Cloud Console)

1. https://console.cloud.google.com → create or pick a project (e.g. "Mirethos MAP Intel").
2. **APIs & Services → OAuth consent screen**: User type **External**; app name "Mirethos MAP Intel";
   support email; authorised domain `onrender.com` and `vercel.app` (or your own domain later);
   scopes `openid`, `email`, `profile` (no sensitive scopes, so no Google review is needed).
   Publish the app (status "In production") so anyone with a Google account can reach the sign-in
   screen. MAP Intel still lets in only invited people or allowed domains.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**: type **Web application**;
   Authorised redirect URIs: the Google URI above.
4. Copy the **Client ID** and **Client secret**.

## Microsoft (Microsoft Entra admin center)

1. https://entra.microsoft.com → **Identity → Applications → App registrations → New registration**.
2. Name "Mirethos MAP Intel"; **Supported account types: Accounts in any organizational directory
   (Any Microsoft Entra ID tenant – Multitenant)**. Personal Microsoft accounts are refused by MAP
   Intel anyway.
3. Redirect URI: platform **Web**, the Microsoft URI above → Register.
4. Copy the **Application (client) ID** from the Overview page.
5. **Certificates & secrets → New client secret** (24 months) → copy the secret **Value** (not its ID).
   Put a reminder in the calendar to renew it before it expires.
6. **API permissions**: the default `User.Read` is enough (sign-in uses `openid email profile`).
7. Optional: to allow only one organisation (e.g. Mirethos's own staff), set `MICROSOFT_TENANT` to
   that tenant id instead of `organizations`.

## Render (map-intel-api → Environment)

| Variable | Value |
|---|---|
| `API_PUBLIC_URL` | `https://map-intel-api.onrender.com` |
| `PORTAL_URL` | `https://map-intel-iota.vercel.app` (already set) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from Google step 4 |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | from Microsoft steps 4–5 |
| `MICROSOFT_TENANT` | `organizations` (default) or one tenant id |

Save → Render redeploys → the buttons appear on the sign-in page.

## Who can get in

1. Someone already using MAP Intel, by the verified email on their Google / Microsoft account (the
   first time links that account; after that the link is used, even if the email changes).
2. Someone with a pending invite: signing in accepts the invite.
3. Someone whose email domain an account allows (Settings → Sign-in security → allowed email
   domains): they join that account with the chosen role (Brand user or Analyst). Public domains
   such as gmail.com cannot be allowed.

Anyone else is told to ask for an invite. Disabled users stay out. If an account requires
multi-factor sign-in, SSO still asks for the authenticator code (SSO replaces the password only).
Microsoft sign-ins use the organisation-controlled sign-in name, not the editable email field.
