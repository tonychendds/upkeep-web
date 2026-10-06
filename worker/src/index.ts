const PAGES_ORIGIN = "https://tonychendds.github.io";
const PBKDF2_ITERATIONS = 100_000;
const MAX_BODY_BYTES = 2_000_000;
const MAX_RECORDS = 2000;

interface Env {
  DB: D1Database;
}

interface D1Statement {
  bind(...values: Array<string | number | null>): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1Statement;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
}

interface RecordRow {
  id: string;
  type: string;
  updated_at: number;
  deleted: number;
  payload: string | null;
}

type RecordType = "asset" | "category" | "contractor" | "job";

interface SyncRecord {
  id: string;
  type: RecordType;
  updatedAt: number;
  deleted: boolean;
  payload: Record<string, unknown> | null;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") {
      if (origin && !isAllowedOrigin(origin)) return cors(request, json({ error: "Origin is not allowed." }, 403));
      return cors(request, new Response(null, { status: 204 }));
    }
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/") return cors(request, json({ ok: true, service: "upkeep-sync" }));
      if (request.method === "POST" && url.pathname === "/auth/register") return cors(request, await register(request, env));
      if (request.method === "POST" && url.pathname === "/auth/login") return cors(request, await login(request, env));
      if (request.method === "POST" && url.pathname === "/auth/logout") return cors(request, await logout(request, env));
      if (request.method === "GET" && url.pathname === "/sync") return cors(request, await pull(request, env));
      if (request.method === "POST" && url.pathname === "/sync") return cors(request, await push(request, env));
      return cors(request, json({ error: "Not found." }, 404));
    } catch {
      return cors(request, json({ error: "The sync server could not finish that request." }, 500));
    }
  },
};

export default worker;

function isAllowedOrigin(origin: string): boolean {
  if (origin === PAGES_ORIGIN) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:") return false;
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function cors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  const origin = request.headers.get("Origin");
  if (origin && isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function register(request: Request, env: Env): Promise<Response> {
  const credentials = await readCredentials(request);
  if (!credentials.ok) return json({ error: credentials.error }, 400);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(credentials.login).first<{ id: string }>();
  if (existing) return json({ error: "An account with that email or username already exists." }, 409);
  const { hash, salt } = await hashPassword(credentials.password);
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, credentials.login, hash, salt, Date.now())
    .run();
  const token = await createSession(env, id);
  return json({ token, email: credentials.login }, 201);
}

async function login(request: Request, env: Env): Promise<Response> {
  const credentials = await readCredentials(request);
  if (!credentials.ok) return json({ error: credentials.error }, 400);
  const user = await env.DB.prepare("SELECT id, email, password_hash, password_salt FROM users WHERE email = ?")
    .bind(credentials.login)
    .first<UserRow>();
  if (!user || !(await verifyPassword(credentials.password, user.password_salt, user.password_hash))) {
    return json({ error: "Email or password does not match." }, 401);
  }
  const token = await createSession(env, user.id);
  return json({ token, email: user.email });
}

async function logout(request: Request, env: Env): Promise<Response> {
  const userId = await userIdFromRequest(request, env);
  if (!userId) return json({ error: "Sign in again." }, 401);
  const token = bearer(request);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  }
  return json({ ok: true });
}

async function pull(request: Request, env: Env): Promise<Response> {
  const userId = await userIdFromRequest(request, env);
  if (!userId) return json({ error: "Sign in again." }, 401);
  return json({ records: await readAll(env, userId), serverTime: Date.now() });
}

async function push(request: Request, env: Env): Promise<Response> {
  const userId = await userIdFromRequest(request, env);
  if (!userId) return json({ error: "Sign in again." }, 401);
  const body = await readObject(request);
  if (!body.ok) return json({ error: body.error }, 400);
  if (!Array.isArray(body.value.records)) return json({ error: "Records must be a list." }, 400);
  if (body.value.records.length > MAX_RECORDS) return json({ error: "Too many records in one sync." }, 400);

  const incoming: SyncRecord[] = [];
  for (const raw of body.value.records) {
    const parsed = parseRecord(raw);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    incoming.push(parsed.record);
  }

  // Apply one record at a time. Absence never deletes: an empty list is a pull.
  // A tombstone sticks even if a later push sends an older or newer live copy.
  for (const record of incoming) {
    const existing = await env.DB.prepare(
      "SELECT id, type, updated_at, deleted, payload FROM records WHERE user_id = ? AND id = ?",
    )
      .bind(userId, record.id)
      .first<RecordRow>();
    const resolved = resolveRecord(existing ? rowToRecord(existing) : null, record);
    if (!resolved.changed) continue;
    await env.DB.prepare(
      "INSERT INTO records (user_id, id, type, updated_at, deleted, payload) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, id) DO UPDATE SET type = excluded.type, updated_at = excluded.updated_at, deleted = excluded.deleted, payload = excluded.payload",
    )
      .bind(
        userId,
        resolved.record.id,
        resolved.record.type,
        resolved.record.updatedAt,
        resolved.record.deleted ? 1 : 0,
        resolved.record.payload ? JSON.stringify(resolved.record.payload) : null,
      )
      .run();
  }

  return json({ records: await readAll(env, userId), serverTime: Date.now() });
}

function resolveRecord(existing: SyncRecord | null, incoming: SyncRecord): { record: SyncRecord; changed: boolean } {
  if (!existing) return { record: incoming, changed: true };
  if (existing.deleted && !incoming.deleted) return { record: existing, changed: false };
  if (incoming.deleted && !existing.deleted) return { record: incoming, changed: true };
  if (existing.deleted && incoming.deleted) {
    if (incoming.updatedAt > existing.updatedAt) return { record: incoming, changed: true };
    return { record: existing, changed: false };
  }
  if (incoming.updatedAt > existing.updatedAt) return { record: incoming, changed: true };
  return { record: existing, changed: false };
}

async function readAll(env: Env, userId: string): Promise<SyncRecord[]> {
  const result = await env.DB.prepare(
    "SELECT id, type, updated_at, deleted, payload FROM records WHERE user_id = ? ORDER BY id",
  )
    .bind(userId)
    .all<RecordRow>();
  return (result.results ?? []).map(rowToRecord);
}

function rowToRecord(row: RecordRow): SyncRecord {
  let payload: Record<string, unknown> | null = null;
  if (row.payload) {
    try {
      const parsed = JSON.parse(row.payload) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
    } catch {
      payload = null;
    }
  }
  return {
    id: row.id,
    type: row.type as RecordType,
    updatedAt: row.updated_at,
    deleted: row.deleted === 1,
    payload,
  };
}

function parseRecord(raw: unknown): { ok: true; record: SyncRecord } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "A record is missing." };
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id : "";
  if (!/^[A-Za-z0-9:_-]{1,80}$/.test(id)) return { ok: false, error: "A record id is not valid." };
  const type = value.type;
  if (type !== "asset" && type !== "category" && type !== "contractor" && type !== "job") {
    return { ok: false, error: "A record type is not valid." };
  }
  const updatedAt = value.updatedAt;
  if (typeof updatedAt !== "number" || !Number.isSafeInteger(updatedAt) || updatedAt < 1) {
    return { ok: false, error: "A record is missing a timestamp." };
  }
  if (typeof value.deleted !== "boolean") return { ok: false, error: "A record is missing its deleted flag." };
  if (value.deleted) {
    const payload = value.payload == null ? null : parsePayload(type, value.payload);
    return { ok: true, record: { id, type, updatedAt, deleted: true, payload: payload ?? null } };
  }
  const payload = parsePayload(type, value.payload);
  if (!payload) return { ok: false, error: `The ${type} record "${id}" is not valid.` };
  return { ok: true, record: { id, type, updatedAt, deleted: false, payload } };
}

function parsePayload(type: RecordType, raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (type === "asset") return parseAsset(value);
  if (type === "category") {
    const name = requiredText(value.name, 80);
    const assetType = value.assetType === "home" || value.assetType === "car" ? value.assetType : null;
    if (!name || !assetType) return null;
    return { name, assetType };
  }
  if (type === "contractor") {
    const name = requiredText(value.name, 80);
    const phone = optionalText(value.phone, 40);
    const email = optionalText(value.email, 200);
    if (!name || phone == null || email == null) return null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    return { name, phone, email };
  }
  const title = requiredText(value.title, 160);
  const assetId = idText(value.assetId);
  const categoryId = idText(value.categoryId);
  const location = optionalText(value.location, 160);
  const notes = optionalText(value.notes, 4000);
  let contractorId: string | null = null;
  if (value.contractorId != null && value.contractorId !== "") {
    contractorId = idText(value.contractorId);
    if (!contractorId) return null;
  }
  const status = value.status === "scheduled" || value.status === "done" ? value.status : null;
  const date = dateText(value.date);
  const nextDueDate = value.nextDueDate == null || value.nextDueDate === "" ? null : dateText(value.nextDueDate);
  const costCents = value.costCents == null ? null : moneyCents(value.costCents);
  const odometer = value.odometer == null ? null : wholeNumber(value.odometer, 10_000_000);
  const nextDueOdometer = value.nextDueOdometer == null ? null : wholeNumber(value.nextDueOdometer, 10_000_000);
  const repeat = parseRepeat(value.repeat);
  if (!title || !assetId || !categoryId || location == null || notes == null || contractorId === undefined) return null;
  if (!status || !date || nextDueDate === undefined || costCents === undefined || odometer === undefined || nextDueOdometer === undefined) {
    return null;
  }
  if (repeat === undefined) return null;
  return {
    title,
    assetId,
    categoryId,
    location,
    contractorId,
    costCents,
    status,
    date,
    nextDueDate,
    nextDueOdometer,
    repeat,
    odometer,
    notes,
  };
}

function parseAsset(value: Record<string, unknown>): Record<string, unknown> | null {
  const assetType = value.assetType === "home" || value.assetType === "car" ? value.assetType : null;
  if (!assetType) return null;
  if (assetType === "home") {
    const name = requiredText(value.name, 120);
    if (!name) return null;
    return { name, assetType, make: "", model: "", year: "", plate: "", vin: "", nickname: "" };
  }
  const make = optionalText(value.make, 40);
  const model = optionalText(value.model, 40);
  const year = yearText(value.year);
  const plateRaw = optionalText(value.plate, 12);
  const vinRaw = optionalText(value.vin, 17);
  const nickname = optionalText(value.nickname, 80);
  if (make == null || model == null || year == null || plateRaw == null || vinRaw == null || nickname == null) return null;
  const plate = plateRaw.toUpperCase();
  const vin = vinRaw.toUpperCase();
  if (!make || !model || !year || !/^[A-Z0-9 -]{1,12}$/.test(plate)) return null;
  if (vin && !/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)) return null;
  const generated = carDefaultName(year, make, model, plate);
  const name = (nickname || generated).slice(0, 120);
  if (!name) return null;
  return { name, assetType, make, model, year, plate, vin, nickname };
}

function carDefaultName(year: string, make: string, model: string, plate: string): string {
  const vehicle = [year, make, model].filter(Boolean).join(" ");
  if (vehicle && plate) return `${vehicle} · ${plate}`;
  return vehicle || plate;
}

function yearText(value: unknown): string | null {
  if (value == null || value === "") return "";
  const text = typeof value === "number" && Number.isInteger(value) ? String(value) : typeof value === "string" ? value.trim() : null;
  if (text == null) return null;
  if (!text) return "";
  if (!/^\d{4}$/.test(text)) return null;
  const year = Number(text);
  if (year < 1900 || year > 2100) return null;
  return text;
}

function parseRepeat(raw: unknown): { unit: "months" | "miles"; every: number } | null | undefined {
  if (raw == null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const unit = value.unit === "months" || value.unit === "miles" ? value.unit : null;
  const every = typeof value.every === "number" && Number.isSafeInteger(value.every) ? value.every : null;
  if (!unit || every == null) return undefined;
  if (unit === "months" && (every < 1 || every > 120)) return undefined;
  if (unit === "miles" && (every < 1 || every > 1_000_000)) return undefined;
  return { unit, every };
}

function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max) return null;
  return text;
}

function optionalText(value: unknown, max: number): string | null {
  if (value == null) return "";
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length > max) return null;
  return text;
}

function idText(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9:_-]{1,80}$/.test(value)) return null;
  return value;
}

function dateText(value: unknown): string | null | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return value;
}

function moneyCents(value: unknown): number | null | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 100_000_000_00) return undefined;
  return value;
}

function wholeNumber(value: unknown, max: number): number | null | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) return undefined;
  return value;
}

async function createSession(env: Env, userId: string): Promise<string> {
  const token = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(token), userId, Date.now())
    .run();
  return token;
}

async function userIdFromRequest(request: Request, env: Env): Promise<string | null> {
  const token = bearer(request);
  if (!token) return null;
  const row = await env.DB.prepare("SELECT user_id FROM sessions WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+([A-Fa-f0-9]{64})$/.exec(header);
  return match ? match[1] : null;
}

async function readCredentials(request: Request): Promise<{ ok: true; login: string; password: string } | { ok: false; error: string }> {
  const body = await readObject(request);
  if (!body.ok) return body;
  const login = normalizeLogin(body.value.email);
  const password = typeof body.value.password === "string" ? body.value.password : "";
  if (!login) return { ok: false, error: "Enter a valid email address or username." };
  if (password.length < 8 || password.length > 200) return { ok: false, error: "Password must be 8 to 200 characters." };
  return { ok: true, login, password };
}

function normalizeLogin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const login = value.trim().toLowerCase();
  if (!login || login.length > 200) return null;
  if (login.includes("@")) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login) ? login : null;
  }
  return /^[a-z0-9](?:[a-z0-9._-]{1,38}[a-z0-9])$/.test(login) ? login : null;
}

async function readObject(request: Request): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return { ok: false, error: "That request is too large." };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, error: "Expected JSON." };
  }
  if (text.length > MAX_BODY_BYTES) return { ok: false, error: "That request is too large." };
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Expected a JSON object." };
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, error: "Expected JSON." };
  }
}

async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, saltBytes);
  return { hash: bytesToHex(hash), salt: bytesToHex(saltBytes) };
}

async function verifyPassword(password: string, saltHex: string, hashHex: string): Promise<boolean> {
  const salt = hexToBytes(saltHex);
  if (!salt) return false;
  const actual = bytesToHex(await pbkdf2(password, salt));
  return constantEqual(actual, hashHex);
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function constantEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}
