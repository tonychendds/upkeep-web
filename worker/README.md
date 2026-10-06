# upkeep-sync

Cloudflare Worker that stores Upkeep accounts and per-record sync data in D1.

Public URL (after you deploy): https://upkeep-sync.tonychendds.workers.dev

The database already exists:

- name: `upkeep-sync`
- id: `ef27fdaf-690d-490c-9f16-5b3a10f3b375`
- binding: `DB`

## Deploy

From this directory, signed in to the Cloudflare account that owns the database:

```bash
npm install
npx wrangler d1 migrations apply upkeep-sync --remote
npx wrangler secret put RESET_RELAY_URL
npx wrangler secret put RESET_RELAY_SECRET
npx wrangler deploy
```

Apply migrations before the first deploy, and again whenever `migrations/` changes. `0002_recovery.sql` adds a nullable `recovery_email` column and the reset-token tables. Existing users and maintenance records are left as they are.

`RESET_RELAY_URL` and `RESET_RELAY_SECRET` are Worker secrets, not checked-in config. `wrangler secret put` prompts for each value. The URL is the Google Apps Script web app that sends mail from Tony's Gmail. The secret is the shared string that script expects. Until both are set, reset requests still return the generic message and log that the relay was skipped (`npx wrangler tail`).

The worker POSTs JSON:

```json
{ "secret": "<RESET_RELAY_SECRET>", "to": "<recovery email>", "link": "https://tonychendds.github.io/upkeep-web/#reset=<token>" }
```

Apps Script web apps answer that POST with a 302 to `script.googleusercontent.com`. The worker follows the redirect and reads the final JSON: `{ "ok": true }` or `{ "ok": false, "error": "..." }`. The relay only accepts links that start with `https://tonychendds.github.io/upkeep-web/` and only allowlisted recipients. If the relay is down or returns `ok: false`, the worker logs the failure and still tells the client the generic message.

## Local development

```bash
npm install
npx wrangler d1 migrations apply upkeep-sync --local
npx wrangler dev
```

`wrangler dev` uses a local D1 database. The web app can point at it with `?sync=http://127.0.0.1:8787`.

## What the API does

- `POST /auth/register` and `POST /auth/login` with `{ "email", "password" }`. `email` may be an email address or a username. Register also accepts `recoveryEmail`. If that field is omitted and the username is an email, the recovery email defaults to it. Passwords are hashed with PBKDF2-SHA256 (100,000 iterations). Responses include a bearer token only after the row is stored. Sync records are plain JSON; the password is not used to encrypt them.
- `POST /auth/logout` revokes the bearer token.
- `GET /auth/me` returns `{ email, recoveryEmail }` for the signed-in account.
- `POST /auth/recovery-email` with `{ "password", "recoveryEmail" }` changes the recovery email after the current password matches.
- `POST /auth/reset-request` with `{ "email" }` always responds `{ "ok": true, "message": "If that account has a recovery email, a reset link is on its way." }` whether or not the account exists. It sends at most 3 links per account and 3 per IP each hour. The token is 32 random bytes, stored only as a SHA-256 hash, single use, and expires in 30 minutes.
- `POST /auth/reset-confirm` with `{ "token", "password" }` sets the new password, deletes every session for that account, and returns a new bearer token. The maintenance log is not modified.
- `POST /sync` with `{ "records": [...] }` upserts those records and returns the full set. An empty `records` array only reads. It does not delete anything.
- `GET /sync` reads every record for the signed-in account.

Each record is `{ id, type, updatedAt, deleted, payload }`. `type` is `asset`, `category`, `contractor`, or `job`. A delete is stored as `deleted: true` and is never removed. A later push of a live copy does not bring it back.

Last-write-wins applies to live edits (`updatedAt`, milliseconds). CORS allows `https://tonychendds.github.io` plus `http://localhost` and `http://127.0.0.1` for development.
