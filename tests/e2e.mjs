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

  await pageA.getByRole("link", { name: "More" }).click();
  await pageA.getByRole("link", { name: "Account and sync" }).click();
  await pageA.getByRole("button", { name: "New account" }).click();
  await pageA.getByLabel("Email or username").fill(login);
  await pageA.getByLabel("Password", { exact: true }).fill(password);
  await pageA.getByLabel("Confirm password").fill(password);
  await pageA.getByRole("button", { name: "Create account" }).click();
  await pageA.getByTestId("account-result").waitFor();
  assert.match(await pageA.getByTestId("account-result").innerText(), /cannot be reset/i);
  assert.doesNotMatch(await pageA.getByTestId("account-result").innerText(), /Account created/);
  await pageA.getByRole("checkbox", { name: /I understand/i }).check();
  await pageA.getByRole("button", { name: "Create account" }).click();
  await pageA.getByText(/Account created/i).waitFor({ timeout: 20000 });
  await pageA.getByTestId("sync-banner").getByText(/Last synced/i).waitFor({ timeout: 20000 });
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
  await pageA.getByLabel("What was done").fill("Oil change");
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
  await pad.getByRole("button", { name: "Sign in" }).click();
  await pad.getByRole("link", { name: "Summary" }).click();
  await pad.getByText("Gutter cleaning").waitFor({ timeout: 15000 }).catch(() => {});
  await pad.getByRole("link", { name: "Jobs" }).click();
  await pad.getByText("Gutter cleaning").first().waitFor({ timeout: 15000 });
  const ipadOverflow = await pad.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(ipadOverflow <= 1, `iPad overflow ${ipadOverflow}`);
  await ipad.close();
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
    ["wrangler", "dev", "--local", "--ip", "127.0.0.1", "--port", String(workerPort), "--inspector-port", String(inspector), "--persist-to", dir, "--show-interactive-dev-session=false", "--log-level", "warn"],
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
    stop: async () => {
      site.close();
      try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
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
