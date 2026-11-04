# Later

Things decided or noticed but parked. Add to it as you go; move an item out when it's done.

## Next up

- **Daily automatic runs (Inngest)** — slice 6 of the Leads plan.
  - One Inngest function per source, triggered by an event, `concurrency { limit: 1, key: userId }`, one step per unit (thread / search) so no step nears Vercel's 60 s.
  - Daily crons fan out to users whose profile is complete and who have the source on: news and client posts 08:00 IST, HN on days 1–10 at 07:00 IST. First lines written as a last step.
  - `app.js`: serve `/api/inngest` (skip login and compression for it, like Outreach `server.js:196`). `POST /api/sources/run` sends an event when Inngest is configured; runs inline as now when it isn't (local).
  - Env on Vercel: `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_APP_ID=clientline`. Re-sync the app in Inngest after deploy.
  - Building blocks already exist: `lib/sources/run.js` (`startRun`, `planRun`, `runUnit`, `finishRun`), `lib/leads/opener.js` (`writeOpenersFor`), root `inngest.js`.
- **Admin app** — one app to manage users and access requests for both Outreach and Clientline (global `isAdmin`). Until then: `scripts/grant-access.js`.

## Leads

- **Held leads (no email)** — try to find a contact later: their site's contact page, an email pattern on a known domain (`lib/emailPatterns.js`), or a search on the user's key.
- **Learn from discards** — "not my service" five times in a row → suggest removing the keyword that matched; "too small" → suggest raising the minimum. Discard reasons are already stored.
- **Track the full path per source** — contacted → replied → call → won → paid; "money per 100 leads" by source (leads plan §8). Needs Outreach/Deals first.
- **Pause weak sources** — a source with many leads and no replies is costing free allowance; suggest turning it off.
- **HN freelancer thread is nearly empty of clients** (one client post in nine months, measured Nov 2026). Kept because it's free; revisit if it stays at zero.
- **Places** — cities don't map to their region yet (typing "Dubai" doesn't offer UAE). Add city → region aliases to the place list and to `REGIONS` in `lib/leads/gates.js`.
- **Funding news** — Google News links are redirects; resolving them to the real article would give a better "where" and sometimes the company's site.
- **Parked sources** (leads plan §3): Gmail history, website audits (OpenStreetMap + PageSpeed), long-open developer roles, newly registered companies, agency partnerships.
- **Let users add their own sources** — an RSS feed or a saved search (open question in the leads plan).

## Setup and profile

- **Prefill from Outreach** — for users of both apps, start the setup from the roles and skills saved there.
- **"Describe yourself in a sentence"** — once a Groq key exists, AI suggests tiles and keywords; the user confirms.
- **Packages, UPI, GST** — belong to Proposals and Invoices; add when those pages are built.

## Keys and limits

- **Shared search allowance** — Clientline counts only its own Tavily/SerpApi searches; a key shared from Outreach is also spent there, so the provider can say "used up" before Clientline's counter does. Could read Outreach's usage too.
- **Several keys per provider** — Outreach supports up to 5 per provider with failover/balance; Clientline has one. Add if users hit daily limits.
- **Notifications** — Outreach raises a bell notice when a key is rejected or out of quota; Clientline only shows it on Free connections. Needs a bell first.
- **Rotating `CREDENTIAL_KEY`** — today a new key makes every saved key unreadable. A re-encrypt script (decrypt with old, encrypt with new) would make rotation safe.

## Pages still placeholders

Today, Outreach, Inbox, Deals, Proposals, Invoices, Project boards (see `claudemd/clientline-prototype.html`).

## Housekeeping

- **Tests** — add `scripts/test-tenant.js` (user B can't read or change user A's leads, profile or keys) and a LeadShare test (the 4th account is refused).
- **AI call log** — rows are kept 30 days; nothing shows them yet. An admin view would help debug first lines.
- **Rate limits** — `POST /api/sources/run` and paste have no per-user rate limit beyond "one run at a time".
