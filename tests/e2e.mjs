import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";
import { addMonths } from "../site/js/model.js";
import { startRelay } from "../worker/test/relay.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = path.join(root, "site");
const shots = "/opt/cursor/artifacts/screenshots";
const login = `tony-${Date.now().toString(36)}`;
const password = "correct-horse";
const vin = "4T1BF1FK5HU123456";

const server = await boot();
const browser = await chromium.launch();
const failures = [];
try {
  const iphone = devices["iPhone 13"];
  const contextA = await browser.newContext({ ...iphone });
  const contextB = await browser.newContext({ ...iphone });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await pageA.goto(server.pageUrl);
  await pageB.goto(server.pageUrl);
  await pageA.getByText("Not signed in. This log stays on this device only.").waitFor();
  await mkdir(shots, { recursive: true });
  await pageA.screenshot({ path: path.join(shots, "iphone_not_signed_in.png") });

  const pointerEvents = await pageA.evaluate(() => getComputedStyle(document.querySelector("nav a svg")).pointerEvents);
  assert.equal(pointerEvents, "none");
  const icon = await pageA.evaluate(async () => {
    const img = document.querySelector(".brand img");
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let light = 0;
    let minx = canvas.width;
    let maxx = 0;
    let miny = canvas.height;
    let maxy = 0;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const index = (y * canvas.width + x) * 4;
        if (data[index] > 220 && data[index + 1] > 220 && data[index + 2] > 220) {
          light += 1;
          minx = Math.min(minx, x);
          maxx = Math.max(maxx, x);
          miny = Math.min(miny, y);
          maxy = Math.max(maxy, y);
        }
      }
    }
    return { w: canvas.width, h: canvas.height, light, bw: maxx - minx, bh: maxy - miny };
  });
  assert.equal(icon.w, 192);
  assert.equal(icon.h, 192);
  assert.ok(icon.bw > 80 && icon.bh > 80 && icon.light > 4000, `logo is not a solid icon ${JSON.stringify(icon)}`);

  await pageA.getByRole("link", { name: "More" }).click();
  await pageA.getByRole("link", { name: "Account and sync" }).click();
  await pageA.getByRole("button", { name: "New account" }).click();
  await pageA.getByLabel("Email or username").fill("ada@example.com");
  assert.equal(await pageA.getByLabel("Recovery email", { exact: true }).inputValue(), "ada@example.com");
  await pageA.getByLabel("Email or username").fill(login);
  assert.equal(await pageA.getByLabel("Recovery email", { exact: true }).inputValue(), "");
  await pageA.getByLabel("Password", { exact: true }).fill(password);
  await pageA.getByLabel("Confirm password").fill(password);
  await pageA.getByRole("button", { name: "Create account" }).click();
  await pageA.getByTestId("account-result").waitFor();
  assert.match(await pageA.getByTestId("account-result").innerText(), /Check the box/i);
  assert.doesNotMatch(await pageA.getByTestId("account-result").innerText(), /Account created/);
  await pageA.getByRole("checkbox", { name: /I understand/i }).check();
  await pageA.evaluate(() => {
    const main = document.querySelector("#main");
    main.scrollTop = main.scrollHeight;
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await pageA.getByRole("button", { name: "Create account" }).click();
  await pageA.getByText(/Account created/i).waitFor({ timeout: 20000 });
  await pageA.getByTestId("sync-banner").getByText(/Last synced/i).waitFor({ timeout: 20000 });
  await assertHeadingClear(pageA, "iphone after create");
  await pageA.screenshot({ path: path.join(shots, "iphone_account_created.png") });
  const signedInIcon = await pageA.evaluate(() => getComputedStyle(document.querySelector("#sync-banner svg")).pointerEvents);
  assert.equal(signedInIcon, "none");

  await pageA.getByRole("link", { name: "More" }).click();
  await pageA.getByRole("link", { name: "Assets", exact: true }).click();
  await pageA.getByRole("link", { name: "Add asset" }).click();
  await pageA.getByLabel("Brand").fill("Lexus");
  await pageA.getByLabel("Model").fill("RX");
  await pageA.getByLabel("Year built").fill("2019");
  await pageA.getByLabel("License plate").fill("8abc123");
  await pageA.getByLabel("VIN").fill(vin);
  await pageA.getByTestId("display-name").waitFor();
  assert.equal(await pageA.getByTestId("display-name").innerText(), "2019 Lexus RX · 8ABC123");
  await pageA.getByLabel("Nickname").fill("Daily driver");
  assert.equal(await pageA.getByTestId("display-name").innerText(), "Daily driver");
  await pageA.getByLabel("Nickname").fill("");
  assert.equal(await pageA.getByTestId("display-name").innerText(), "2019 Lexus RX · 8ABC123");
  await pageA.screenshot({ path: path.join(shots, "iphone_car_details.png"), fullPage: true });
  await saveAndSync(pageA, "Save asset");
  await pageA.getByRole("button", { name: /2019 Lexus RX · 8ABC123/ }).click();
  assert.equal(await pageA.getByLabel("Brand").inputValue(), "Lexus");
  assert.equal(await pageA.getByLabel("Model").inputValue(), "RX");
  assert.equal(await pageA.getByLabel("Year built").inputValue(), "2019");
  assert.equal(await pageA.getByLabel("License plate").inputValue(), "8ABC123");
  assert.equal(await pageA.getByLabel("VIN").inputValue(), vin);
  await pageA.getByRole("link", { name: "Jobs" }).click();
  await pageA.getByRole("link", { name: "Log a job" }).click();
  assert.equal(await pageA.getByLabel("Category", { exact: true }).inputValue(), "");
  assert.equal(await pageA.getByLabel("Category", { exact: true }).evaluate((el) => el.selectedOptions[0].textContent), "Choose…");
  await pageA.getByLabel("What was done").fill("Oil change");
  await pageA.getByRole("button", { name: "Save job" }).click();
  await pageA.getByText("Choose a category.").waitFor();
  await pageA.getByLabel("Asset", { exact: true }).selectOption({ label: "2019 Lexus RX · 8ABC123" });
  await pageA.getByLabel("Category", { exact: true }).selectOption({ label: "Oil change" });
  await pageA.getByLabel("Asset", { exact: true }).selectOption({ label: "Home" });
  assert.equal(await pageA.getByLabel("Category", { exact: true }).inputValue(), "");
  await pageA.getByLabel("Asset", { exact: true }).selectOption({ label: "2019 Lexus RX · 8ABC123" });
  await pageA.getByLabel("Category", { exact: true }).selectOption({ label: "Oil change" });
  await pageA.getByLabel("Where").fill("Dealer");
  await pageA.getByLabel("Contractor", { exact: true }).selectOption({ label: "Add a contractor…" });
  await pageA.getByLabel("Contractor name").fill("Lexus of Marin");
  await pageA.getByLabel("Phone").fill("415-555-0100");
  await pageA.getByLabel("Cost").fill("89.50");
  await pageA.getByRole("button", { name: "Done", exact: true }).click();
  const doneDate = await pageA.getByLabel("Date done").inputValue();
  await pageA.getByLabel("Repeat").selectOption({ label: "Every 6 months" });
  assert.equal(await pageA.getByLabel("Next due date").inputValue(), addMonths(doneDate, 6));
  await pageA.getByLabel("Odometer").fill("42000");
  await pageA.screenshot({ path: path.join(shots, "iphone_job_form.png") });
  await saveAndSync(pageA, "Save job");

  await pageA.getByRole("link", { name: "Log a job" }).click();
  await pageA.getByLabel("What was done").fill("Gutter cleaning");
  await pageA.getByLabel("Asset", { exact: true }).selectOption({ label: "Home" });
  await pageA.getByLabel("Category", { exact: true }).selectOption({ label: "Cleaning" });
  await pageA.getByRole("button", { name: "Scheduled", exact: true }).click();
  await pageA.getByLabel("Scheduled date").fill(shiftDays(-40));
  await saveAndSync(pageA, "Save job");

  await pageA.getByRole("link", { name: "Summary" }).click();
  assert.equal(await pageA.getByTestId("month-total").innerText(), "$89.50");
  assert.equal(await pageA.getByTestId("year-total").innerText(), "$89.50");
  await pageA.locator("section", { has: pageA.getByRole("heading", { name: "By category" }) }).getByText("Oil change").waitFor();
  await pageA.screenshot({ path: path.join(shots, "iphone_summary_totals.png"), fullPage: true });
  await pageA.getByRole("link", { name: "Upcoming" }).click();
  await pageA.getByText("Overdue").first().waitFor();
  await pageA.getByText("Gutter cleaning").first().waitFor();
  await pageA.screenshot({ path: path.join(shots, "iphone_upcoming.png") });
  await pageA.getByRole("link", { name: "Jobs" }).click();
  await pageA.getByLabel("Search").fill("oil");
  await pageA.getByRole("button", { name: /Oil change/ }).waitFor();
  await pageA.getByLabel("Search").fill("zzzz");
  await pageA.getByText("No jobs match.").waitFor();
  await pageA.getByLabel("Search").fill("");
  await pageA.screenshot({ path: path.join(shots, "iphone_jobs.png") });

  const overflow = await pageA.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `horizontal overflow ${overflow}`);

  await pageB.getByRole("link", { name: "More" }).click();
  await pageB.getByRole("link", { name: "Account and sync" }).click();
  await pageB.getByRole("button", { name: "New account" }).click();
  await pageB.getByLabel("Email or username").fill(login);
  await pageB.getByLabel("Password", { exact: true }).fill(password);
  await pageB.getByLabel("Confirm password").fill(password);
  await pageB.getByRole("checkbox", { name: /I understand/i }).check();
  await pageB.getByRole("button", { name: "Create account" }).click();
  await pageB.getByText(/already exists/i).waitFor({ timeout: 20000 });
  assert.doesNotMatch(await pageB.getByTestId("account-result").innerText(), /Account created/);
  await pageB.getByRole("button", { name: "I have an account" }).click();
  await pageB.getByLabel("Email or username").fill(login);
  await pageB.getByLabel("Password", { exact: true }).fill(password);
  await pageB.getByRole("button", { name: "Sign in" }).click();
  await pageB.getByText(/Signed in as/i).first().waitFor({ timeout: 20000 });
  await pageB.getByRole("link", { name: "More" }).click();
  await pageB.getByRole("link", { name: "Assets", exact: true }).click();
  await pageB.getByRole("button", { name: /2019 Lexus RX · 8ABC123/ }).click();
  assert.equal(await pageB.getByLabel("License plate").inputValue(), "8ABC123");
  assert.equal(await pageB.getByLabel("VIN").inputValue(), vin);
  await pageB.getByRole("link", { name: "Jobs" }).click();
  await pageB.getByRole("button", { name: /Oil change/ }).click();
  await pageB.getByLabel("Cost").fill("100");
  await saveAndSync(pageB, "Save job");

  await pageA.getByRole("button", { name: "Sync now" }).click();
  await pageA.waitForResponse((response) => response.url().endsWith("/sync") && response.ok());
  await pageA.getByRole("link", { name: "Summary" }).click();
  await pageA.getByTestId("month-total").getByText("$100.00").waitFor({ timeout: 10000 });

  await pageB.getByRole("link", { name: "Jobs" }).click();
  await pageB.getByRole("button", { name: /Oil change/ }).click();
  await pageB.getByRole("button", { name: "Delete job" }).click();
  await pageB.getByRole("dialog").getByRole("button", { name: "Delete job" }).click();
  await pageB.waitForResponse((response) => response.url().endsWith("/sync") && response.ok());
  await pageA.getByRole("button", { name: "Sync now" }).click();
  await pageA.waitForResponse((response) => response.url().endsWith("/sync") && response.ok());
  await pageA.getByRole("link", { name: "Jobs" }).click();
  await pageA.getByRole("button", { name: /Oil change/ }).waitFor({ state: "hidden", timeout: 10000 });
  await pageA.getByText("Gutter cleaning").first().waitFor();
  await pageA.getByRole("button", { name: "Sync now" }).click();
  await pageA.waitForResponse((response) => response.url().endsWith("/sync") && response.ok());
  assert.equal(await pageA.getByRole("button", { name: /Oil change/ }).count(), 0);

  await pageB.reload();
  await pageB.getByRole("link", { name: "Jobs" }).click();
  await pageB.getByText("Gutter cleaning").first().waitFor();
  assert.equal(await pageB.getByRole("button", { name: /Oil change/ }).count(), 0);

  const ipad = await browser.newContext({ ...devices["iPad Mini"] });
  const pad = await ipad.newPage();
  await pad.goto(server.pageUrl);
  await pad.getByRole("link", { name: "More" }).click();
  await pad.getByRole("link", { name: "Account and sync" }).click();
  await pad.getByLabel("Email or username").fill(login);
  await pad.getByLabel("Password", { exact: true }).fill(password);
  await pad.evaluate(() => {
    const main = document.querySelector("#main");
    main.scrollTop = main.scrollHeight;
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await pad.getByRole("button", { name: "Sign in" }).click();
  await pad.getByText(/Signed in as/i).first().waitFor({ timeout: 20000 });
  await assertHeadingClear(pad, "ipad after sign-in");
  await pad.screenshot({ path: path.join(shots, "after_account_ipad.png") });
  await pad.getByRole("link", { name: "Summary" }).click();
  await pad.getByText("Gutter cleaning").waitFor({ timeout: 15000 }).catch(() => {});
  await pad.getByRole("link", { name: "Jobs" }).click();
  await pad.getByText("Gutter cleaning").first().waitFor({ timeout: 15000 });
  await assertHeadingClear(pad, "ipad jobs");
  for (const name of ["Summary", "Upcoming", "More"]) {
    await pad.getByRole("link", { name }).click();
    await assertHeadingClear(pad, `ipad ${name}`);
  }
  const ipadOverflow = await pad.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(ipadOverflow <= 1, `iPad overflow ${ipadOverflow}`);
  await ipad.close();

  const landscape = await browser.newContext({
    ...devices["iPad Mini"],
    viewport: { width: 1024, height: 768 },
    screen: { width: 1024, height: 768 },
  });
  const wide = await landscape.newPage();
  await wide.goto(server.pageUrl);
  await wide.getByRole("link", { name: "More" }).click();
  await wide.getByRole("link", { name: "Account and sync" }).click();
  await wide.getByLabel("Email or username").fill(login);
  await wide.getByLabel("Password", { exact: true }).fill(password);
  await wide.evaluate(() => {
    const main = document.querySelector("#main");
    main.scrollTop = main.scrollHeight;
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await wide.getByRole("button", { name: "Sign in" }).click();
  await wide.getByText(/Signed in as/i).first().waitFor({ timeout: 20000 });
  await assertHeadingClear(wide, "ipad landscape after sign-in");
  await wide.screenshot({ path: path.join(shots, "after_account_ipad_landscape.png") });
  for (const name of ["Summary", "Upcoming", "Jobs"]) {
    await wide.getByRole("link", { name }).click();
    await assertHeadingClear(wide, `ipad landscape ${name}`);
  }
  await landscape.close();

  await pageA.getByRole("link", { name: "More" }).click();
  await pageA.getByRole("link", { name: "Account and sync" }).click();
  await pageA.getByText(/No recovery email is set/i).waitFor();
  const recovery = `reset-${login}@example.com`;
  await pageA.getByLabel("Recovery email", { exact: true }).fill(recovery);
  await pageA.getByLabel("Current password").fill(password);
  await pageA.getByRole("button", { name: "Save recovery email" }).click();
  await pageA.getByText(`Recovery email saved. A reset link can be emailed to ${recovery}.`).waitFor({ timeout: 20000 });

  await pageB.getByRole("link", { name: "More" }).click();
  await pageB.getByRole("link", { name: "Account and sync" }).click();
  await pageB.getByRole("button", { name: "Sign out" }).click();
  await pageB.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
  await pageB.getByRole("button", { name: "Forgot password?" }).click();
  await pageB.getByLabel("Email or username").fill(login);
  const sentBefore = server.relay.requests.length;
  await pageB.getByRole("button", { name: "Send reset link" }).click();
  await pageB.getByText("If that account has a recovery email, a reset link is on its way.").waitFor({ timeout: 20000 });
  const deadline = Date.now() + 10000;
  while (server.relay.requests.length < sentBefore + 1 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const sent = server.relay.requests.at(-1);
  assert.equal(sent.to, recovery);
  assert.match(sent.link, /^https:\/\/tonychendds\.github\.io\/upkeep-web\/#reset=[a-f0-9]{64}$/);
  const resetToken = sent.link.split("#reset=")[1];
  await pageB.goto(`${server.pageUrl}#reset=${resetToken}`);
  await pageB.getByRole("heading", { name: "Choose a new password" }).waitFor();
  await pageB.getByLabel("New password").fill("fresh-password");
  await pageB.getByLabel("Confirm password").fill("fresh-password");
  await pageB.getByRole("button", { name: "Update password" }).click();
  await pageB.getByText(/Password updated/i).waitFor({ timeout: 20000 });
  await assertHeadingClear(pageB, "iphone after password reset");
  assert.equal(new URL(pageB.url()).hash, "#/account");
  const signedInIconAfterReset = await pageB.evaluate(() => getComputedStyle(document.querySelector("#sync-banner svg")).pointerEvents);
  assert.equal(signedInIconAfterReset, "none");
  await pageB.getByRole("link", { name: "Jobs" }).click();
  await pageB.getByText("Gutter cleaning").first().waitFor({ timeout: 15000 });

  await pageA.getByRole("link", { name: "Jobs" }).click();
  await pageA.getByText("Gutter cleaning").first().waitFor();
  const oldSession = await pageA.evaluate(async () => {
    const session = JSON.parse(localStorage.getItem("upkeep.session.v1") || "null");
    const sync = new URL(location.href).searchParams.get("sync");
    const response = await fetch(`${sync}/sync`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session?.token || ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: [] }),
    });
    return { status: response.status, hasToken: Boolean(session?.token) };
  });
  assert.equal(oldSession.status, 401, `old session still accepted (${oldSession.status})`);
  const expired = pageA.waitForResponse((response) => response.url().endsWith("/sync") && response.status() === 401);
  await pageA.getByTestId("sync-banner").getByRole("button", { name: "Sync now" }).click();
  await expired;
  await pageA.getByTestId("sync-banner").getByText(/session expired/i).waitFor({ timeout: 15000 });
  await pageA.getByText("Gutter cleaning").first().waitFor();

  await pageB.goto(`${server.pageUrl}#reset=${resetToken}`);
  await pageB.getByRole("heading", { name: "Choose a new password" }).waitFor();
  await pageB.getByLabel("New password").fill("fresh-password");
  await pageB.getByLabel("Confirm password").fill("fresh-password");
  await pageB.getByRole("button", { name: "Update password" }).click();
  await pageB.getByText(/expired or was already used/i).waitFor({ timeout: 20000 });
  await pageB.getByRole("button", { name: "Send a new link" }).click();
  await pageB.getByRole("heading", { name: "Forgot password" }).waitFor();
  assert.equal(new URL(pageB.url()).hash, "#/account");
  console.log("e2e ok");
} catch (error) {
  failures.push(error);
  try {
    await mkdir(shots, { recursive: true });
    const pages = browser.contexts().flatMap((context) => context.pages());
    for (const [index, page] of pages.entries()) {
      await page.screenshot({ path: path.join(shots, `failure_${index}.png`), fullPage: true }).catch(() => {});
    }
  } catch { /* ignore screenshot errors */ }
  throw error;
} finally {
  await browser.close();
  await server.stop();
}

async function assertHeadingClear(page, label) {
  const metrics = await page.evaluate(() => {
    const banner = document.querySelector("#sync-banner").getBoundingClientRect();
    const heading = document.querySelector("#main h1").getBoundingClientRect();
    const main = document.querySelector("#main");
    return {
      gap: heading.top - banner.bottom,
      scrollY: window.scrollY,
      mainScroll: main.scrollTop,
      windowOverflow: document.documentElement.scrollHeight - window.innerHeight,
    };
  });
  assert.ok(metrics.gap >= -1, `${label} heading under banner ${JSON.stringify(metrics)}`);
  assert.ok(Math.abs(metrics.scrollY) <= 1, `${label} window scrolled ${JSON.stringify(metrics)}`);
  assert.ok(metrics.mainScroll <= 1, `${label} content scrolled ${JSON.stringify(metrics)}`);
  assert.ok(metrics.windowOverflow <= 1, `${label} window can scroll ${JSON.stringify(metrics)}`);
}

async function saveAndSync(page, buttonName) {
  const pending = page.waitForResponse((response) => response.url().endsWith("/sync") && response.request().method() === "POST" && response.ok(), { timeout: 15000 });
  await page.getByRole("button", { name: buttonName }).click();
  await pending;
}

function shiftDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

async function boot() {
  const relay = await startRelay();
  const dir = await mkdtemp(path.join(tmpdir(), "upkeep-e2e-"));
  const workerPort = await freePort();
  const inspector = await freePort();
  const sitePort = await freePort();
  const env = { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" };
  await execFileAsync(
    "npx",
    ["wrangler", "d1", "migrations", "apply", "upkeep-sync", "--local", "--persist-to", dir],
    { cwd: path.join(root, "worker"), env },
  );
  const child = spawn(
    "npx",
    ["wrangler", "dev", "--local", "--ip", "127.0.0.1", "--port", String(workerPort), "--inspector-port", String(inspector), "--persist-to", dir, "--show-interactive-dev-session=false", "--log-level", "warn", "--var", `RESET_RELAY_URL:${relay.url}`, "--var", `RESET_RELAY_SECRET:${relay.secret}`],
    { cwd: path.join(root, "worker"), env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  const workerUrl = `http://127.0.0.1:${workerPort}`;
  const deadline = Date.now() + 90000;
  let up = false;
  while (Date.now() < deadline) {
    if (child.exitCode != null) break;
    try {
      if ((await fetch(`${workerUrl}/`)).ok) { up = true; break; }
    } catch { /* booting */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!up) throw new Error(`worker failed to start\n${logs}`);
  const site = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      const filePath = path.normalize(path.join(siteDir, pathname));
      if (!filePath.startsWith(siteDir)) {
        response.writeHead(403);
        response.end();
        return;
      }
      const data = await readFile(filePath);
      const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json", ".png": "image/png" };
      response.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" });
      response.end(data);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });
  await new Promise((resolve) => site.listen(sitePort, "127.0.0.1", resolve));
  return {
    pageUrl: `http://127.0.0.1:${sitePort}/?sync=${encodeURIComponent(workerUrl)}`,
    relay,
    stop: async () => {
      site.close();
      try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
      await relay.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      const port = typeof address === "object" && address ? address.port : 0;
      listener.close(() => resolve(port));
    });
    listener.on("error", reject);
  });
}
