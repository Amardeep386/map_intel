# Sign in with Google: setting it up

MAP Intel offers "Continue with Google" on the sign-in page once Google's client id and secret are set
on the API (Render). Google only (decision 44, 9 Oct 2026). Built in Phase 5 · M8
(`server/src/lib/sso.ts`, `server/src/api/routes/auth.ts`, migration 048). **Done for the live site
on 9 Oct 2026.**

Redirect URI registered with Google: `https://map-intel-api.onrender.com/auth/sso/google/callback`
(for local development also `http://localhost:4000/auth/sso/google/callback`).

## Google Cloud Console

1. https://console.cloud.google.com → the project ("Mirethos MAP Intel").
2. **APIs & Services → OAuth consent screen**: User type **External**; app name "Mirethos MAP Intel";
   support email; scopes `openid`, `email`, `profile` only (no Google review needed). **Publish**
   the app ("In production"); while it is in "Testing" only the listed test users can sign in.
   MAP Intel still lets in only invited people or allowed domains.
3. **APIs & Services → Credentials → OAuth client ID**, type **Web application**:
   - **Authorised JavaScript origins:** leave empty (sign-in runs through the API, not the browser).
   - **Authorised redirect URIs:** the URI above (exactly: `https`, no trailing slash).
   - "Use this client for an AI-powered agent": off.
4. Copy the **Client ID** and **Client secret**.

## Render (map-intel-api → Environment)

| Variable | Value |
|---|---|
| `API_PUBLIC_URL` | `https://map-intel-api.onrender.com` |
| `PORTAL_URL` | `https://map-intel-iota.vercel.app` (already set) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from step 4 |

Save → Render redeploys → the button appears on the sign-in page.

## Who can get in

1. Someone already using MAP Intel, by the verified email on their Google account (the first time
   links that Google account; after that the link is used, even if the email changes).
2. Someone with a pending invite: signing in accepts the invite.
3. Someone whose email domain an account allows (Settings → Sign-in security → allowed email
   domains): they join that account with the chosen role (Brand user or Analyst). Public domains
   such as gmail.com cannot be allowed.

Anyone else is told to ask for an invite. Disabled users stay out. If an account requires
multi-factor sign-in, Google sign-in still asks for the authenticator code (it replaces the password only).

Adding another provider later (e.g. Microsoft for a brand that uses it) is a `Provider` entry in
`server/src/lib/sso.ts`; the routes, identity links, joining rules and tests already handle any
OpenID Connect provider.
