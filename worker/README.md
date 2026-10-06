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
npx wrangler deploy
```

Apply migrations before the first deploy, and again whenever `migrations/` changes.

## Local development

```bash
npm install
npx wrangler d1 migrations apply upkeep-sync --local
npx wrangler dev
```

`wrangler dev` uses a local D1 database. The web app can point at it with `?sync=http://127.0.0.1:8787`.

## What the API does

- `POST /auth/register` and `POST /auth/login` with `{ "email", "password" }`. `email` may be an email address or a username. Passwords are hashed with PBKDF2-SHA256 (100,000 iterations). Responses include a bearer token only after the row is stored.
- `POST /auth/logout` revokes the bearer token.
- `POST /sync` with `{ "records": [...] }` upserts those records and returns the full set. An empty `records` array only reads. It does not delete anything.
- `GET /sync` reads every record for the signed-in account.

Each record is `{ id, type, updatedAt, deleted, payload }`. `type` is `asset`, `category`, `contractor`, or `job`. A delete is stored as `deleted: true` and is never removed. A later push of a live copy does not bring it back.

Last-write-wins applies to live edits (`updatedAt`, milliseconds). CORS allows `https://tonychendds.github.io` plus `http://localhost` and `http://127.0.0.1` for development.
