import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

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
    ["wrangler", "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(inspector), "--persist-to", dir, "--show-interactive-dev-session=false", "--log-level", "warn"],
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
    stop: async () => {
      await stop(child);
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
