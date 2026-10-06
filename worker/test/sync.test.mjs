import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { startRelay } from "./relay.mjs";

const execFileAsync = promisify(execFile);
const workerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("register, login, per-record sync, tombstones, and CORS", { timeout: 180000 }, async () => {
  const server = await startWorker();
  try {
    const origin = "https://tonychendds.github.io";
    const health = await fetch(`${server.url}/`, { headers: { Origin: origin } });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("access-control-allow-origin"), origin);

    const preflight = await fetch(`${server.url}/sync`, {
      method: "OPTIONS",
      headers: { Origin: "http://127.0.0.1:4173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "http://127.0.0.1:4173");

    const evil = await fetch(`${server.url}/`, { headers: { Origin: "https://evil.example" } });
    assert.notEqual(evil.headers.get("access-control-allow-origin"), "https://evil.example");

    const bad = await server.request("/auth/register", { method: "POST", body: { email: "tony", password: "short" } });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).token, undefined);

    const created = await server.request("/auth/register", { method: "POST", body: { email: "Tony@Example.com", password: "correct-horse" } });
    assert.equal(created.status, 201);
    const account = await created.json();
    assert.equal(account.email, "tony@example.com");
    assert.match(account.token, /^[a-f0-9]{64}$/);

    const duplicate = await server.request("/auth/register", { method: "POST", body: { email: "tony@example.com", password: "correct-horse" } });
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).token, undefined);

    const wrong = await server.request("/auth/login", { method: "POST", body: { email: "tony@example.com", password: "wrong-password" } });
    assert.equal(wrong.status, 401);

    const signedIn = await server.request("/auth/login", { method: "POST", body: { email: "tony@example.com", password: "correct-horse" } });
    assert.equal(signedIn.status, 200);
    const session = await signedIn.json();
    const token = session.token;

    const car = {
      id: "car-rx",
      type: "asset",
      updatedAt: 10,
      deleted: false,
      payload: {
        name: "placeholder",
        assetType: "car",
        make: "Lexus",
        model: "RX",
        year: "2019",
        plate: "8abc123",
        vin: "4t1bf1fk5hu123456",
        nickname: "Daily driver",
      },
    };
    const oil = job("job-oil", 20);
    const first = await server.sync(token, [car, oil]);
    assert.equal(first.status, 200);
    const stored = await first.json();
    const storedCar = stored.records.find((record) => record.id === "car-rx");
    assert.equal(storedCar.payload.name, "Daily driver");
    assert.equal(storedCar.payload.make, "Lexus");
    assert.equal(storedCar.payload.model, "RX");
    assert.equal(storedCar.payload.year, "2019");
    assert.equal(storedCar.payload.plate, "8ABC123");
    assert.equal(storedCar.payload.vin, "4T1BF1FK5HU123456");
    assert.equal(storedCar.payload.nickname, "Daily driver");

    const empty = await server.sync(token, []);
    const afterEmpty = await empty.json();
    assert.equal(afterEmpty.records.length, 2);
    assert.equal(afterEmpty.records.find((record) => record.id === "job-oil").payload.title, "Oil change");

    const invalid = await server.sync(token, [{ ...car, id: "car-bad", payload: { ...car.payload, plate: "" }, updatedAt: 30 }]);
    assert.equal(invalid.status, 400);
    const stillThere = await (await server.sync(token, [])).json();
    assert.equal(stillThere.records.length, 2);

    const tombstone = { ...oil, deleted: true, updatedAt: 40 };
    assert.equal((await server.sync(token, [tombstone])).status, 200);
    const resurrect = { ...oil, deleted: false, updatedAt: 80 };
    await server.sync(token, [resurrect]);
    const afterDelete = await (await server.sync(token, [])).json();
    assert.equal(afterDelete.records.find((record) => record.id === "job-oil").deleted, true);
    assert.equal(afterDelete.records.find((record) => record.id === "car-rx").deleted, false);

    const other = await server.request("/auth/register", { method: "POST", body: { email: "other-user", password: "correct-horse" } });
    const otherToken = (await other.json()).token;
    const otherBook = await (await server.sync(otherToken, [])).json();
    assert.deepEqual(otherBook.records, []);

    const pulled = await server.request("/sync", { token });
    assert.equal(pulled.status, 200);
    assert.equal((await pulled.json()).records.length, 2);

    await server.request("/auth/logout", { method: "POST", token });
    const rejected = await server.sync(token, []);
    assert.equal(rejected.status, 401);

    const again = await server.request("/auth/login", { method: "POST", body: { email: "tony@example.com", password: "correct-horse" } });
    const firstSession = await again.json();
    assert.equal(firstSession.recoveryEmail, "tony@example.com");
    const second = await server.request("/auth/login", { method: "POST", body: { email: "tony@example.com", password: "correct-horse" } });
    const secondSession = await second.json();
    const me = await (await server.request("/auth/me", { token: firstSession.token })).json();
    assert.equal(me.recoveryEmail, "tony@example.com");

    const message = "If that account has a recovery email, a reset link is on its way.";
    const before = server.relay.requests.length;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await server.request("/auth/reset-request", { method: "POST", body: { email: "Tony@Example.com" } });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).message, message);
    }
    assert.equal(server.relay.requests.length, before + 3);
    const sent = server.relay.requests.at(-1);
    assert.equal(sent.secret, server.relay.secret);
    assert.equal(sent.to, "tony@example.com");
    assert.match(sent.link, /^https:\/\/tonychendds\.github\.io\/upkeep-web\/#reset=[a-f0-9]{64}$/);
    const resetToken = sent.link.split("#reset=")[1];

    const limited = await server.request("/auth/reset-request", { method: "POST", body: { email: "tony@example.com" } });
    assert.equal(limited.status, 200);
    assert.equal((await limited.json()).message, message);
    assert.equal(server.relay.requests.length, before + 3);
    assert.match(server.logs(), /rate limit/);

    const confirmed = await server.request("/auth/reset-confirm", { method: "POST", body: { token: resetToken, password: "brand-new-password" } });
    assert.equal(confirmed.status, 200);
    const resetSession = await confirmed.json();
    assert.match(resetSession.token, /^[a-f0-9]{64}$/);
    assert.equal(resetSession.email, "tony@example.com");
    assert.equal((await server.sync(firstSession.token, [])).status, 401);
    assert.equal((await server.sync(secondSession.token, [])).status, 401);
    const afterReset = await (await server.sync(resetSession.token, [])).json();
    assert.equal(afterReset.records.length, 2);
    assert.equal(afterReset.records.find((record) => record.id === "car-rx").payload.name, "Daily driver");
    assert.equal(afterReset.records.find((record) => record.id === "job-oil").deleted, true);
    assert.equal((await server.request("/auth/login", { method: "POST", body: { email: "tony@example.com", password: "correct-horse" } })).status, 401);
    assert.equal((await server.request("/auth/login", { method: "POST", body: { email: "tony@example.com", password: "brand-new-password" } })).status, 200);

    const reused = await server.request("/auth/reset-confirm", { method: "POST", body: { token: resetToken, password: "another-password" } });
    assert.equal(reused.status, 400);
    assert.match((await reused.json()).error, /expired or was already used/i);
    assert.equal((await server.request("/auth/login", { method: "POST", body: { email: "tony@example.com", password: "brand-new-password" } })).status, 200);

    await clearResetLimits(server.dir);
    const expiring = await server.request("/auth/reset-request", { method: "POST", body: { email: "tony@example.com" } });
    assert.equal((await expiring.json()).message, message);
    const expiringToken = server.relay.requests.at(-1).link.split("#reset=")[1];
    await expireToken(server.dir, expiringToken);
    const expired = await server.request("/auth/reset-confirm", { method: "POST", body: { token: expiringToken, password: "expired-password" } });
    assert.equal(expired.status, 400);
    assert.match((await expired.json()).error, /expired or was already used/i);
    assert.equal((await server.request("/auth/login", { method: "POST", body: { email: "tony@example.com", password: "brand-new-password" } })).status, 200);

    const plain = await server.request("/auth/register", { method: "POST", body: { email: "plain-user", password: "correct-horse", recoveryEmail: "" } });
    assert.equal((await plain.json()).recoveryEmail, null);
    const plainCount = server.relay.requests.length;
    const plainReset = await server.request("/auth/reset-request", { method: "POST", body: { email: "plain-user" } });
    assert.equal((await plainReset.json()).message, message);
    assert.equal(server.relay.requests.length, plainCount);

    const missing = await server.request("/auth/reset-request", { method: "POST", body: { email: "nobody-home" } });
    assert.equal((await missing.json()).message, message);
    assert.equal(server.relay.requests.length, plainCount);

    await clearResetLimits(server.dir);
    server.relay.setMode("fail");
    const failed = await server.request("/auth/reset-request", { method: "POST", body: { email: "tony@example.com" } });
    assert.equal((await failed.json()).message, message);
    assert.match(server.logs(), /relay failed/);
    server.relay.setMode("down");
    const down = await server.request("/auth/reset-request", { method: "POST", body: { email: "tony@example.com" } });
    assert.equal((await down.json()).message, message);
    assert.match(server.logs(), /relay unreachable/);
    server.relay.setMode("ok");

    const wrongPassword = await server.request("/auth/recovery-email", {
      method: "POST",
      token: resetSession.token,
      body: { password: "wrong-password", recoveryEmail: "other@example.com" },
    });
    assert.equal(wrongPassword.status, 401);
    const changed = await server.request("/auth/recovery-email", {
      method: "POST",
      token: resetSession.token,
      body: { password: "brand-new-password", recoveryEmail: "Other@Example.com" },
    });
    assert.equal(changed.status, 200);
    assert.equal((await changed.json()).recoveryEmail, "other@example.com");
    await clearResetLimits(server.dir);
    const previous = server.relay.requests.length;
    await server.request("/auth/reset-request", { method: "POST", body: { email: "tony@example.com" } });
    assert.equal(server.relay.requests.at(-1).to, "other@example.com");
    assert.equal(server.relay.requests.length, previous + 1);
  } finally {
    await server.stop();
  }
});

function job(id, updatedAt) {
  return {
    id,
    type: "job",
    updatedAt,
    deleted: false,
    payload: {
      title: "Oil change",
      assetId: "asset:home",
      categoryId: "default:car:oil-change",
      location: "Dealer",
      contractorId: null,
      costCents: 8950,
      status: "done",
      date: "2026-10-01",
      nextDueDate: "2027-04-01",
      nextDueOdometer: null,
      repeat: { unit: "months", every: 6 },
      odometer: 42000,
      notes: "",
    },
  };
}

async function startWorker() {
  const relay = await startRelay();
  const dir = await mkdtemp(path.join(tmpdir(), "upkeep-d1-"));
  const port = await freePort();
  const inspector = await freePort();
  const env = { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" };
  await execFileAsync(
    "npx",
    ["wrangler", "d1", "migrations", "apply", "upkeep-sync", "--local", "--persist-to", dir],
    { cwd: workerDir, env },
  );
  const child = spawn(
    "npx",
    ["wrangler", "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(inspector), "--persist-to", dir, "--show-interactive-dev-session=false", "--log-level", "log", "--var", `RESET_RELAY_URL:${relay.url}`, "--var", `RESET_RELAY_SECRET:${relay.secret}`],
    { cwd: workerDir, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  const url = `http://127.0.0.1:${port}`;
  const ready = Date.now() + 90000;
  let up = false;
  while (Date.now() < ready) {
    if (child.exitCode != null) break;
    try {
      const response = await fetch(`${url}/`);
      if (response.ok) { up = true; break; }
    } catch { /* worker still booting */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!up) {
    await stop(child);
    throw new Error(`wrangler dev did not start\n${logs}`);
  }
  return {
    url,
    dir,
    relay,
    logs: () => logs,
    stop: async () => {
      await stop(child);
      await relay.stop();
      await rm(dir, { recursive: true, force: true });
    },
    request(pathname, { method = "GET", body, token, origin = "http://127.0.0.1:4173" } = {}) {
      return fetch(`${url}${pathname}`, {
        method,
        headers: {
          Origin: origin,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    },
    sync(token, records) {
      return this.request("/sync", { method: "POST", token, body: { records } });
    },
  };
}

async function clearResetLimits(dir) {
  await withDb(dir, (db) => {
    db.prepare("DELETE FROM reset_rate_limits").run();
  });
}

async function expireToken(dir, token) {
  const hash = createHash("sha256").update(token).digest("hex");
  await withDb(dir, (db) => {
    const result = db.prepare("UPDATE password_resets SET expires_at = 1 WHERE token_hash = ?").run(hash);
    if (result.changes !== 1) throw new Error(`token row not updated (${result.changes})`);
  });
}

async function withDb(dir, fn) {
  const file = await findSqlite(dir);
  let lastError = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const db = new DatabaseSync(file, { timeout: 2000 });
      try {
        return fn(db);
      } finally {
        db.close();
      }
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw lastError;
}

async function findSqlite(dir) {
  const files = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith(".sqlite")) files.push(full);
    }
  }
  for (const file of files) {
    try {
      const db = new DatabaseSync(file, { readOnly: true, timeout: 1000 });
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'password_resets'").get();
      db.close();
      if (row) return file;
    } catch {
      /* not the D1 file, or it is locked */
    }
  }
  throw new Error(`no password_resets table under ${dir} (${files.join(", ")})`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function stop(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
      resolve();
    }, 5000);
    child.on("exit", () => { clearTimeout(timer); resolve(); });
  });
}
