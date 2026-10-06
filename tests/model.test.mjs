import assert from "node:assert/strict";
import test from "node:test";
import {
  addMonths,
  carDefaultName,
  isPristine,
  mergeRecords,
  mergeWithServer,
  normalizeAssetPayload,
  parseBackup,
  recordError,
  recordsToPush,
  seedHome,
  suggestNextDue,
  summarize,
  toCsv,
  upcomingItems,
} from "../site/js/model.js";

test("car details build a display name and a nickname can replace it", () => {
  assert.equal(carDefaultName({ year: "2019", make: "Lexus", model: "RX", plate: "8abc123" }), "2019 Lexus RX · 8ABC123");
  const generated = normalizeAssetPayload({
    assetType: "car",
    make: "Lexus",
    model: "RX",
    year: "2019",
    plate: "8abc123",
    vin: "4t1bf1fk5hu123456",
    nickname: "",
  });
  assert.equal(generated.name, "2019 Lexus RX · 8ABC123");
  assert.equal(generated.plate, "8ABC123");
  assert.equal(generated.vin, "4T1BF1FK5HU123456");
  assert.equal(recordError({ id: "car-1", type: "asset", updatedAt: 2, deleted: false, payload: generated }), "");
  const nick = normalizeAssetPayload({ ...generated, nickname: "Daily driver" });
  assert.equal(nick.name, "Daily driver");
  assert.equal(nick.make, "Lexus");
  assert.equal(recordError({ id: "car-1", type: "asset", updatedAt: 3, deleted: false, payload: { ...generated, plate: "" } }), "Enter the license plate.");
  assert.match(recordError({ id: "car-1", type: "asset", updatedAt: 3, deleted: false, payload: { ...generated, vin: "BAD" } }), /VIN/);
});

test("a pristine home is not uploaded, and a car makes the book worth syncing", () => {
  const home = seedHome();
  const records = { [home.id]: home };
  assert.equal(isPristine(records), true);
  assert.deepEqual(recordsToPush(records), []);
  records["car-1"] = {
    id: "car-1",
    type: "asset",
    updatedAt: 5,
    deleted: false,
    payload: normalizeAssetPayload({ assetType: "car", make: "Lexus", model: "RX", year: "2019", plate: "8ABC123", vin: "", nickname: "" }),
  };
  assert.equal(isPristine(records), false);
  assert.equal(recordsToPush(records).length, 2);
});

test("deletions stick and older copies do not come back", () => {
  const live = { id: "job-1", type: "job", updatedAt: 50, deleted: false, payload: { title: "Oil change" } };
  const tomb = { ...live, updatedAt: 40, deleted: true };
  assert.equal(mergeRecords(live, tomb).deleted, true);
  assert.equal(mergeRecords(tomb, { ...live, updatedAt: 500 }).deleted, true);
  assert.equal(mergeWithServer({ ...live, updatedAt: 500 }, tomb).deleted, true);
  assert.equal(mergeWithServer(tomb, { ...live, updatedAt: 500 }).deleted, true);
  const newer = mergeRecords({ ...live, updatedAt: 10 }, { ...live, updatedAt: 20, payload: { title: "Newer" } });
  assert.equal(newer.payload.title, "Newer");
});

test("repeat intervals suggest the next due date", () => {
  assert.equal(addMonths("2026-10-06", 6), "2027-04-06");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(suggestNextDue("2026-10-06", { unit: "months", every: 12 }), "2027-10-06");
  assert.equal(suggestNextDue("2026-10-06", { unit: "miles", every: 5000 }), null);
});

test("totals ignore scheduled jobs and upcoming marks overdue dates", () => {
  const records = {
    home: seedHome(),
    done: job("done", "2026-10-02", 8000, { status: "done" }),
    later: job("later", "2026-12-01", 5000, { status: "scheduled" }),
    due: job("due", "2026-01-01", 1000, { status: "done", nextDueDate: "2026-09-01" }),
  };
  const totals = summarize(records, "2026-10");
  assert.equal(totals.monthCents, 8000);
  assert.equal(totals.yearCents, 9000);
  const items = upcomingItems(records, "2026-10-06");
  assert.equal(items.find((item) => item.job.id === "later").overdue, false);
  assert.equal(items.find((item) => item.job.id === "later").kind, "scheduled");
  assert.equal(items.find((item) => item.job.id === "due").overdue, true);
  const csv = toCsv(records);
  assert.match(csv, /License plate/);
  assert.match(csv, /Oil change/);
});

test("backup import keeps car fields and merges by id", () => {
  const payload = normalizeAssetPayload({ assetType: "car", make: "Lexus", model: "RX", year: "2019", plate: "8ABC123", vin: "4T1BF1FK5HU123456", nickname: "Daily driver" });
  const backup = {
    app: "upkeep",
    version: 1,
    records: [{ id: "car-1", type: "asset", updatedAt: 9, deleted: false, payload }],
  };
  const [record] = parseBackup(JSON.stringify(backup));
  assert.equal(record.payload.nickname, "Daily driver");
  assert.equal(record.payload.vin, "4T1BF1FK5HU123456");
  assert.throws(() => parseBackup("{}"), /Upkeep backup/);
});

function job(id, date, costCents, extra) {
  return {
    id,
    type: "job",
    updatedAt: 10,
    deleted: false,
    payload: {
      title: "Oil change",
      assetId: "asset:home",
      categoryId: "default:car:oil-change",
      location: "",
      contractorId: null,
      costCents,
      status: "done",
      date,
      nextDueDate: null,
      nextDueOdometer: null,
      repeat: null,
      odometer: null,
      notes: "",
      ...extra,
    },
  };
}
