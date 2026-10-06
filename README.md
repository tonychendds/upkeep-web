# Upkeep

Mobile-first log for home and car maintenance. It runs as a static site on GitHub Pages and syncs through a small Cloudflare Worker so an iPhone and an iPad can share one account.

Live site (after Pages is enabled): https://tonychendds.github.io/upkeep-web/

## What you can track

- Assets: the home, plus cars. A car stores brand, model, year, license plate, and an optional VIN. The display name defaults to something like `2019 Lexus RX · 8ABC123`. A nickname replaces that name without erasing the details.
- Jobs: what was done, where, contractor, cost, status (Scheduled or Done), the date, an optional next due date, and a repeat (every 3 months, 6 months, 1 year, a custom number of months, or miles for a car). Marking a job done suggests the next due date from the interval. Cars can store an odometer.
- Upcoming: scheduled jobs and next-due reminders, with overdue items highlighted.
- Summary: monthly and yearly totals by asset and category. Only Done jobs are counted.
- Contractors: name, phone, email, and total spent on completed jobs.
- JSON backup and import. Import merges by record id and asks before combining. CSV export is included.

Categories start with a sensible list for cars and for the home. Custom categories are saved with the log.

## Sign-in and sync

The banner at the top stays visible.

- Signed out: "Not signed in. This log stays on this device only."
- Signed in: the account name, the last sync time, and any error. Sync now is always there.

Create account shows a clear success only after the server returns a token, or the server's error if it does not. A recovery email is optional and strongly encouraged. If the username is an email address, that address is the recovery email unless you clear it. Forgot password emails a one-time link to the recovery email. The link expires in 30 minutes. Resetting the password signs out every device and does not delete the maintenance log. Without a recovery email, a forgotten password cannot be recovered by email. The create form says so, and the acknowledgement box has to be checked.

Sync runs when you open the app, when the tab becomes visible again, after each edit (short delay), and when you tap Sync now. A network failure leaves the on-device log alone.

Records sync individually with `updatedAt` timestamps. A delete is a tombstone: an older copy on another device cannot bring it back. An empty device does not upload over the server. On sign-in, an untouched device just downloads. If both sides have data, they merge by record id.

## GitHub Pages

The site is the `site/` folder. Paths are relative, so they work under `/upkeep-web/`.

Workflow: `.github/workflows/pages.yml` deploys with `actions/deploy-pages` on every push to `main`.

One-time setup:

1. Open the repo on GitHub → Settings → Pages.
2. Set Source to **GitHub Actions** (not "Deploy from a branch").
3. Push to `main`. The workflow publishes `site/`.

Add to Home Screen uses `site/manifest.webmanifest` plus the icons in `site/icons/`.

## Sync worker

The worker lives in `worker/` and is not part of the Pages upload. Deploy steps are in [worker/README.md](worker/README.md):

```bash
cd worker
npm install
npx wrangler d1 migrations apply upkeep-sync --remote
npx wrangler deploy
```

Expected URL: https://upkeep-sync.tonychendds.workers.dev

Local development can point the site at a local worker with `?sync=http://127.0.0.1:8787`.

## Tests

```bash
npm install
npm install --prefix worker
npx playwright install chromium
npm test
```

That runs the model checks, the worker against `wrangler dev` with local D1, and a headless two-browser sync test (including an iPhone-sized viewport).
