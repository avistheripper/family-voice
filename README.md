# Family Voice

Two-person browser-to-browser voice calling with React, TypeScript, WebRTC and Supabase Realtime.

## 1. Configure Supabase

Create a Supabase project at https://supabase.com/dashboard. In Project Settings / API (or Connect), copy the Project URL and **publishable/anon** key. Never use the service-role key in the browser.

Supabase Realtime must be enabled. This MVP uses an unprotected public Realtime channel for signaling, **not** a secure authenticated room. A long random link reduces casual discovery but is not access control. Do not use for sensitive calls without implementing authenticated private channels and authorization.

## 2. Local setup

```bash
npm install
cp .env.example .env
# edit .env
npm run dev
```

Open the app in two browser tabs, create a room, copy the invite link, join from both. Test with headphones to avoid feedback. For two different devices, use a deployed HTTPS site; `getUserMedia` generally requires HTTPS or localhost.

## 3. Deploy on Cloudflare Pages

1. Push this directory to a GitHub repository.
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git.
3. Framework preset: Vite. Build command: `npm run build`. Output directory: `dist`.
4. Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Pages project settings, then redeploy.
5. The `public/_redirects` file supports SPA fallback.
6. Open the deployed URL, click New, copy the invite link to the other participant, and both click Join.

## 4. TURN for real-world connectivity

STUN-only may fail across cellular networks, symmetric NAT, and restrictive Wi-Fi. Obtain TURN credentials from a TURN provider and set:

```
VITE_TURN_URL=turns:your-turn-server:5349
VITE_TURN_USERNAME=...
VITE_TURN_CREDENTIAL=...
```

These `VITE_` values are exposed in the built browser bundle. Use only **temporary TURN credentials** issued by a backend in a production version; never put permanent TURN secrets in `VITE_` variables. For this demo, prefer testing on networks where STUN works until a token-issuing endpoint is implemented.

## Limitations

- Exactly two participants. A third presence participant is rejected, though public-channel membership is not an access-control boundary.
- Both users must keep the page open. No ringing, push notifications, or background calling.
- A refresh interrupts the call. A reconnect may require leaving and rejoining.
- Presence sync is eventually consistent; simultaneous joins or fast reconnects may require a retry.
- The UI shows native audio controls as an autoplay fallback on mobile browsers.
- Public Realtime channels are not private: anyone knowing the room ID can join or interfere. Use authenticated private Realtime channels for real privacy.
- For a production-grade app, add short-lived TURN credentials, server-authoritative room capacity, call timeout/recovery, and stronger signaling validation.
