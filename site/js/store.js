import { ensureSeed, mergeRecords, mergeWithServer } from "./model.js";

const DATA_KEY = "upkeep.data.v1";
const SESSION_KEY = "upkeep.session.v1";

export function loadState() {
  const state = {
    records: {},
    session: null,
    lastSyncedAt: null,
    syncError: null,
    syncing: false,
    flash: null,
    revision: 0,
    loadWarning: "",
  };

  try {
    const rawSession = localStorage.getItem(SESSION_KEY);
    if (rawSession) {
      const session = JSON.parse(rawSession);
      if (session && typeof session.token === "string" && session.token && typeof session.email === "string") {
        state.session = { token: session.token, email: session.email };
      }
    }
  } catch {
    state.session = null;
  }

  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (!data || typeof data.records !== "object" || data.records == null || Array.isArray(data.records)) {
        throw new Error("bad data");
      }
      state.records = data.records;
      state.lastSyncedAt = typeof data.lastSyncedAt === "number" ? data.lastSyncedAt : null;
      state.syncError = typeof data.syncError === "string" ? data.syncError : null;
    }
  } catch {
    state.loadWarning = "Saved data on this device could not be read. A copy was kept on this device.";
    try {
      const raw = localStorage.getItem(DATA_KEY);
      if (raw) localStorage.setItem("upkeep.data.backup", raw);
    } catch {
      /* storage may be blocked */
    }
    state.records = {};
  }

  ensureSeed(state.records);
  return state;
}

export function persist(state) {
  try {
    localStorage.setItem(
      DATA_KEY,
      JSON.stringify({
        records: state.records,
        lastSyncedAt: state.lastSyncedAt,
        syncError: state.syncError,
      }),
    );
    if (state.session) localStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    state.syncError = "This device could not save your changes. Free some space and try again.";
  }
}

export function saveRecord(state, record) {
  state.records = { ...state.records, [record.id]: record };
  state.revision += 1;
  persist(state);
}

export function deleteRecord(state, id) {
  const existing = state.records[id];
  if (!existing || existing.deleted) return;
  state.records = {
    ...state.records,
    [id]: { ...existing, deleted: true, updatedAt: Date.now() },
  };
  state.revision += 1;
  persist(state);
}

export function applyServerRecords(state, serverRecords) {
  const next = { ...state.records };
  for (const remote of serverRecords) {
    if (!remote || typeof remote.id !== "string") continue;
    next[remote.id] = mergeWithServer(state.records[remote.id], remote);
  }
  state.records = next;
  ensureSeed(state.records);
  persist(state);
}

export function importRecords(state, incoming) {
  const next = { ...state.records };
  for (const record of incoming) next[record.id] = mergeRecords(next[record.id], record);
  state.records = next;
  ensureSeed(state.records);
  state.revision += 1;
  persist(state);
}

export function setSession(state, session) {
  state.session = session;
  state.syncError = null;
  persist(state);
}

export function clearSession(state) {
  state.session = null;
  state.syncing = false;
  persist(state);
}
