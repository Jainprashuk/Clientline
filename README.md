# Clientline

Leads, outreach, deals and invoices for freelancers. Node + Express, MongoDB
Atlas (M0) via Mongoose, React + Vite client served under `/app`.

## Accounts are shared with Outreach

There is one account store for both products: the `users`, `sessions`,
`logincodes` and `accessrequests` collections in **Outreach's** database.
Clientline reaches them through `lib/authDb.js` (same cluster, same connection
pool); everything else lives in Clientline's own database.

- `User.apps` says which products an account may sign in to: `['outreach']`,
  `['clientline']` or both. Check with `hasApp(user)`; sweep users with `inApp()`
  (`lib/apps.js`).
- Sessions, sign-in codes and access requests carry the app that issued them and
  only work there. The cookie is `clientline_session`.
- Invite-only, exactly like Outreach. `isAdmin` is global; a separate admin app
  will manage both. Until it exists:

  ```sh
  node scripts/grant-access.js --email=someone@example.com            # dev
  node scripts/grant-access.js --email=someone@example.com --env=prod
  node scripts/grant-access.js --email=someone@example.com --revoke   # Clientline only
  ```

`lib/apps.js`, `lib/session.js`, `lib/loginCode.js` and the four models in
`models/` are copies of Outreach's. Keep them identical apart from `APP` and the
`authDb.model(...)` line in each model, and make any change in both repos.

## Run locally

```sh
cp .env.example .env        # fill in; AUTH_DB_DEV=outreach_dev
npm install
npm run build:client        # or: npm run dev:client (Vite on :5174, proxies to :3001)
npm run dev                 # http://localhost:3001
```

Without `RESEND_API_KEY`, sign-in codes print to the server log instead of being
emailed.

## Deploy

Vercel, like Outreach: `client/dist` is committed and served by `server.js`.
Set `NODE_ENV=prod`, `MONGODB_URI_PROD`, `AUTH_DB_PROD=outreach_prod`,
`RESEND_API_KEY`, `OTP_FROM_EMAIL` and `CLIENTLINE_URL`.
