export const DEFAULT_HOME_ID = "asset:home";
export const SYNC_URL = "https://upkeep-sync.tonychendds.workers.dev";

export const DEFAULT_CATEGORIES = [
  { id: "default:car:oil-change", assetType: "car", name: "Oil change" },
  { id: "default:car:tires", assetType: "car", name: "Tires" },
  { id: "default:car:brakes", assetType: "car", name: "Brakes" },
  { id: "default:car:battery", assetType: "car", name: "Battery" },
  { id: "default:car:repair", assetType: "car", name: "Repair" },
  { id: "default:car:registration", assetType: "car", name: "Registration" },
  { id: "default:car:insurance", assetType: "car", name: "Insurance" },
  { id: "default:car:car-wash", assetType: "car", name: "Car wash" },
  { id: "default:car:other", assetType: "car", name: "Other" },
  { id: "default:home:hvac", assetType: "home", name: "HVAC" },
  { id: "default:home:plumbing", assetType: "home", name: "Plumbing" },
  { id: "default:home:electrical", assetType: "home", name: "Electrical" },
  { id: "default:home:roof", assetType: "home", name: "Roof" },
  { id: "default:home:landscaping", assetType: "home", name: "Landscaping" },
  { id: "default:home:appliances", assetType: "home", name: "Appliances" },
  { id: "default:home:pest-control", assetType: "home", name: "Pest control" },
  { id: "default:home:cleaning", assetType: "home", name: "Cleaning" },
  { id: "default:home:painting", assetType: "home", name: "Painting" },
  { id: "default:home:other", assetType: "home", name: "Other" },
];

const REPEAT_PRESETS = [
  { value: "months:3", label: "Every 3 months" },
  { value: "months:6", label: "Every 6 months" },
  { value: "months:12", label: "Every year" },
  { value: "months:custom", label: "Every… months" },
  { value: "miles:custom", label: "Every… miles" },
];

export function repeatPresets(assetType) {
  return REPEAT_PRESETS.filter((preset) => assetType === "car" || !preset.value.startsWith("miles"));
}

export function seedHome() {
  return {
    id: DEFAULT_HOME_ID,
    type: "asset",
    updatedAt: 1,
    deleted: false,
    payload: { name: "Home", assetType: "home", make: "", model: "", year: "", plate: "", vin: "", nickname: "" },
  };
}

export function carDefaultName({ year = "", make = "", model = "", plate = "" } = {}) {
  const vehicle = [year, make, model].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  const plateText = String(plate || "").trim().toUpperCase();
  if (vehicle && plateText) return `${vehicle} · ${plateText}`;
  return vehicle || plateText || "";
}

export function normalizeAssetPayload(input) {
  const assetType = input.assetType === "car" ? "car" : "home";
  if (assetType === "home") {
    return {
      name: String(input.name || "").trim(),
      assetType,
      make: "",
      model: "",
      year: "",
      plate: "",
      vin: "",
      nickname: "",
    };
  }
  const make = String(input.make || "").trim();
  const model = String(input.model || "").trim();
  const year = String(input.year ?? "").trim();
  const plate = String(input.plate || "").trim().toUpperCase();
  const vin = String(input.vin || "").trim().toUpperCase();
  const nickname = String(input.nickname || "").trim();
  const generated = carDefaultName({ year, make, model, plate });
  return {
    name: nickname || generated,
    assetType,
    make,
    model,
    year,
    plate,
    vin,
    nickname,
  };
}

export function assetSubtitle(payload) {
  if (!payload || payload.assetType !== "car") return "Home";
  const generated = carDefaultName(payload);
  if (payload.nickname && generated) return generated;
  if (payload.vin) return `VIN ${payload.vin}`;
  return "Car";
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function todayISO(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function currentMonth(now = new Date()) {
  return todayISO(now).slice(0, 7);
}

export function addMonths(iso, count) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return null;
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const target = new Date(year, month - 1 + count, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return todayISO(target);
}

export function suggestNextDue(date, repeat) {
  if (!repeat || repeat.unit !== "months" || !date) return null;
  return addMonths(date, repeat.every);
}

export function formatMoney(cents) {
  if (cents == null || Number.isNaN(cents)) return "—";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const remainder = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${remainder}`;
}

export function parseMoney(value) {
  const trimmed = String(value ?? "").trim().replace(/[$,\s]/g, "");
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return undefined;
  const [dollars, fraction = ""] = trimmed.split(".");
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_00) return undefined;
  return cents;
}

export function formatDate(iso) {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function formatSynced(timestamp, now = Date.now()) {
  if (!timestamp) return "Not synced yet";
  const date = new Date(timestamp);
  const sameDay = todayISO(date) === todayISO(new Date(now));
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Last synced ${time}`;
  return `Last synced ${formatDate(todayISO(date))} ${time}`;
}

export function liveRecords(records, type) {
  return Object.values(records)
    .filter((record) => record && !record.deleted && record.type === type)
    .sort((left, right) => (left.payload?.name || left.payload?.title || "").localeCompare(right.payload?.name || right.payload?.title || ""));
}

export function isPristine(records) {
  const list = Object.values(records);
  if (list.some((record) => record.deleted)) return false;
  const live = list.filter((record) => !record.deleted);
  if (live.some((record) => record.type !== "asset")) return false;
  const assets = live.filter((record) => record.type === "asset");
  if (assets.length !== 1) return false;
  const asset = assets[0];
  return asset.id === DEFAULT_HOME_ID && asset.payload?.name === "Home" && asset.payload?.assetType === "home";
}

export function recordsToPush(records) {
  if (isPristine(records)) return [];
  return Object.values(records).filter((record) => !recordError(record));
}

export function recordError(record) {
  if (!record || typeof record !== "object") return "A record is missing.";
  if (typeof record.id !== "string" || !/^[A-Za-z0-9:_-]{1,80}$/.test(record.id)) return "A record id is not valid.";
  if (!["asset", "category", "contractor", "job"].includes(record.type)) return "A record type is not valid.";
  if (typeof record.updatedAt !== "number" || !Number.isSafeInteger(record.updatedAt) || record.updatedAt < 1) {
    return "A record is missing a timestamp.";
  }
  if (typeof record.deleted !== "boolean") return "A record is missing its deleted flag.";
  if (record.deleted) return "";
  return payloadError(record.type, record.payload);
}

function payloadError(type, payload) {
  if (!payload || typeof payload !== "object") return "A record is missing its details.";
  if (type === "category") {
    if (!requiredText(payload.name, 80)) return "Category name is required.";
    if (payload.assetType !== "home" && payload.assetType !== "car") return "Choose home or car.";
    return "";
  }
  if (type === "asset") {
    if (payload.assetType !== "home" && payload.assetType !== "car") return "Choose home or car.";
    if (!requiredText(payload.name, 120)) return "Name is required.";
    if (payload.assetType === "home") return "";
    if (!requiredText(payload.make, 40)) return "Brand is required.";
    if (!requiredText(payload.model, 40)) return "Model is required.";
    if (!yearOk(payload.year)) return "Enter the year the car was built.";
    if (!plateOk(payload.plate)) return "Enter the license plate.";
    if (!vinOk(payload.vin)) return "VIN should be 11 to 17 letters and numbers, or leave it blank.";
    if (payload.nickname != null && (typeof payload.nickname !== "string" || payload.nickname.trim().length > 80)) return "Nickname is too long.";
    return "";
  }
  if (type === "contractor") {
    if (!requiredText(payload.name, 80)) return "Contractor name is required.";
    if (typeof payload.phone !== "string" || payload.phone.trim().length > 40) return "Phone is too long.";
    if (typeof payload.email !== "string" || payload.email.trim().length > 200) return "Email is too long.";
    if (payload.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email.trim())) return "Contractor email is not valid.";
    return "";
  }
  if (!requiredText(payload.title, 160)) return "Describe what was done.";
  if (!idOk(payload.assetId) || !idOk(payload.categoryId)) return "Choose an asset and a category.";
  if (typeof payload.location !== "string" || payload.location.trim().length > 160) return "Location is too long.";
  if (typeof payload.notes !== "string" || payload.notes.length > 4000) return "Notes are too long.";
  if (payload.contractorId != null && !idOk(payload.contractorId)) return "Contractor is not valid.";
  if (payload.status !== "scheduled" && payload.status !== "done") return "Choose Scheduled or Done.";
  if (!dateOk(payload.date)) return "Enter a date.";
  if (payload.nextDueDate != null && !dateOk(payload.nextDueDate)) return "Next due date is not valid.";
  if (payload.costCents != null && !wholeOk(payload.costCents, 100_000_000_00)) return "Cost is not valid.";
  if (payload.odometer != null && !wholeOk(payload.odometer, 10_000_000)) return "Odometer is not valid.";
  if (payload.nextDueOdometer != null && !wholeOk(payload.nextDueOdometer, 10_000_000)) return "Next due miles are not valid.";
  if (payload.repeat != null) {
    const unit = payload.repeat.unit;
    const every = payload.repeat.every;
    if (unit !== "months" && unit !== "miles") return "Repeat interval is not valid.";
    if (!Number.isSafeInteger(every)) return "Repeat interval is not valid.";
    if (unit === "months" && (every < 1 || every > 120)) return "Months must be between 1 and 120.";
    if (unit === "miles" && (every < 1 || every > 1_000_000)) return "Miles must be between 1 and 1,000,000.";
  }
  return "";
}

function requiredText(value, max) {
  return typeof value === "string" && value.trim() && value.trim().length <= max;
}

function idOk(value) {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,80}$/.test(value);
}

function dateOk(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function wholeOk(value, max) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function yearOk(value) {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}$/.test(text)) return false;
  const year = Number(text);
  return year >= 1900 && year <= 2100;
}

function plateOk(value) {
  return typeof value === "string" && /^[A-Z0-9 -]{1,12}$/.test(value.trim().toUpperCase());
}

function vinOk(value) {
  if (value == null || String(value).trim() === "") return true;
  return typeof value === "string" && /^[A-HJ-NPR-Z0-9]{11,17}$/.test(value.trim().toUpperCase());
}

export function ensureSeed(records) {
  const assets = Object.values(records).filter((record) => record.type === "asset");
  if (assets.length === 0) records[DEFAULT_HOME_ID] = seedHome();
}

/** Server copy wins when it is deleted or at least as new. A local tombstone sticks until the server has it. */
export function mergeWithServer(local, remote) {
  if (!remote) return local ?? null;
  if (!local) return remote;
  if (local.deleted && remote.deleted) return remote.updatedAt >= local.updatedAt ? remote : local;
  if (local.deleted) return local;
  if (remote.deleted) return remote;
  return remote.updatedAt >= local.updatedAt ? remote : local;
}

/** Import / two-device merge. A deletion beats a live copy of the same id. */
export function mergeRecords(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (left.deleted || right.deleted) {
    if (left.deleted && right.deleted) return left.updatedAt >= right.updatedAt ? left : right;
    return left.deleted ? left : right;
  }
  return left.updatedAt >= right.updatedAt ? left : right;
}

export function categoriesFor(records, assetType) {
  const defaults = DEFAULT_CATEGORIES.filter((category) => category.assetType === assetType).map((category) => ({
    id: category.id,
    name: category.name,
  }));
  const custom = liveRecords(records, "category")
    .filter((record) => record.payload.assetType === assetType)
    .map((record) => ({ id: record.id, name: record.payload.name }));
  return [...defaults, ...custom];
}

export function categoryLabel(records, id) {
  const preset = DEFAULT_CATEGORIES.find((category) => category.id === id);
  if (preset) return preset.name;
  const record = records[id];
  if (record?.payload?.name) return record.payload.name;
  return "Unknown category";
}

export function assetLabel(records, id) {
  const record = records[id];
  if (record?.payload?.name) return record.payload.name;
  return "Unknown asset";
}

export function assetTypeOf(records, id) {
  return records[id]?.payload?.assetType || null;
}

export function contractorLabel(records, id) {
  if (!id) return "";
  return records[id]?.payload?.name || "Unknown contractor";
}

export function liveJobs(records) {
  return Object.values(records)
    .filter((record) => record && !record.deleted && record.type === "job")
    .sort((left, right) => String(right.payload?.date || "").localeCompare(String(left.payload?.date || "")));
}

export function filterJobs(records, filters) {
  const query = (filters.query || "").trim().toLowerCase();
  return liveJobs(records).filter((job) => {
    const payload = job.payload || {};
    if (filters.assetId && payload.assetId !== filters.assetId) return false;
    if (filters.status && payload.status !== filters.status) return false;
    if (filters.categoryId && payload.categoryId !== filters.categoryId) return false;
    if (!query) return true;
    const haystack = [
      payload.title,
      payload.notes,
      payload.location,
      assetLabel(records, payload.assetId),
      categoryLabel(records, payload.categoryId),
      contractorLabel(records, payload.contractorId),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function upcomingItems(records, today = todayISO()) {
  const items = [];
  for (const job of liveJobs(records)) {
    const payload = job.payload || {};
    if (payload.status === "scheduled" && payload.date) {
      items.push({
        key: `${job.id}:scheduled`,
        job,
        date: payload.date,
        kind: "scheduled",
        overdue: payload.date < today,
      });
    } else if (payload.status === "done" && payload.nextDueDate) {
      items.push({
        key: `${job.id}:due`,
        job,
        date: payload.nextDueDate,
        kind: "due",
        overdue: payload.nextDueDate < today,
      });
    } else if (payload.status === "done" && payload.nextDueOdometer) {
      items.push({ key: `${job.id}:miles`, job, date: null, kind: "mileage", overdue: false });
    }
  }
  items.sort((left, right) => {
    if (left.date && right.date) return left.date.localeCompare(right.date) || left.kind.localeCompare(right.kind);
    if (left.date) return -1;
    if (right.date) return 1;
    return String(left.job.payload?.title || "").localeCompare(String(right.job.payload?.title || ""));
  });
  return items;
}

export function summarize(records, month) {
  const year = month.slice(0, 4);
  const done = liveJobs(records).filter((job) => job.payload?.status === "done" && job.payload?.date && job.payload?.costCents != null);
  const monthJobs = done.filter((job) => job.payload.date.startsWith(month));
  const yearJobs = done.filter((job) => job.payload.date.startsWith(year));
  const sum = (jobs) => jobs.reduce((total, job) => total + (job.payload.costCents || 0), 0);

  const assetIds = new Set(liveRecords(records, "asset").map((asset) => asset.id));
  for (const job of yearJobs) assetIds.add(job.payload.assetId);
  const assets = [...assetIds]
    .map((id) => ({
      id,
      name: assetLabel(records, id),
      assetType: assetTypeOf(records, id),
      monthCents: sum(monthJobs.filter((job) => job.payload.assetId === id)),
      yearCents: sum(yearJobs.filter((job) => job.payload.assetId === id)),
    }))
    .sort((left, right) => {
      if (left.assetType === "home" && right.assetType !== "home") return -1;
      if (right.assetType === "home" && left.assetType !== "home") return 1;
      return left.name.localeCompare(right.name);
    });

  const categoryIds = new Set(yearJobs.map((job) => job.payload.categoryId));
  const categories = [...categoryIds]
    .map((id) => ({
      id,
      name: categoryLabel(records, id),
      monthCents: sum(monthJobs.filter((job) => job.payload.categoryId === id)),
      yearCents: sum(yearJobs.filter((job) => job.payload.categoryId === id)),
    }))
    .sort((left, right) => right.yearCents - left.yearCents || left.name.localeCompare(right.name));

  return {
    monthCents: sum(monthJobs),
    yearCents: sum(yearJobs),
    assets,
    categories,
  };
}

export function contractorSpent(records, contractorId) {
  return liveJobs(records)
    .filter((job) => job.payload?.status === "done" && job.payload?.contractorId === contractorId)
    .reduce((total, job) => total + (job.payload.costCents || 0), 0);
}

export function jobsUsing(records, field, id) {
  return liveJobs(records).filter((job) => job.payload?.[field] === id).length;
}

export function toCsv(records) {
  const headers = ["Date", "Status", "Asset", "Nickname", "Year", "Brand", "Model", "License plate", "VIN", "Category", "What was done", "Where", "Contractor", "Cost", "Odometer", "Next due", "Next due miles", "Notes"];
  const lines = [headers.map(csvCell).join(",")];
  for (const job of [...liveJobs(records)].sort((left, right) => String(left.payload.date).localeCompare(String(right.payload.date)))) {
    const payload = job.payload;
    const asset = records[payload.assetId]?.payload || {};
    lines.push(
      [
        payload.date || "",
        payload.status || "",
        assetLabel(records, payload.assetId),
        asset.nickname || "",
        asset.year || "",
        asset.make || "",
        asset.model || "",
        asset.plate || "",
        asset.vin || "",
        categoryLabel(records, payload.categoryId),
        payload.title || "",
        payload.location || "",
        contractorLabel(records, payload.contractorId),
        payload.costCents == null ? "" : (payload.costCents / 100).toFixed(2),
        payload.odometer ?? "",
        payload.nextDueDate || "",
        payload.nextDueOdometer ?? "",
        payload.notes || "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function buildBackup(records) {
  return {
    app: "upkeep",
    version: 1,
    exportedAt: new Date().toISOString(),
    records: Object.values(records),
  };
}

export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (!data || data.app !== "upkeep" || data.version !== 1 || !Array.isArray(data.records)) {
    throw new Error("That file is not an Upkeep backup.");
  }
  if (!data.records.length) throw new Error("That backup has no records.");
  return data.records.map((raw) => {
    const error = recordError(raw);
    if (error) throw new Error(error);
    return raw;
  });
}

export function syncBaseFromLocation(locationLike) {
  try {
    // Dev override only: never let a link point the live site's sign-in at another server.
    const value = new URL(locationLike.href).searchParams.get("sync");
    if (value) {
      const target = new URL(value);
      if (target.protocol === "http:" && (target.hostname === "127.0.0.1" || target.hostname === "localhost")) {
        return value.replace(/\/$/, "");
      }
    }
  } catch {
    /* use the production worker */
  }
  return SYNC_URL;
}
