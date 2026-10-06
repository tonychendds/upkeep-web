import { recordsToPush } from "./model.js";
import { applyServerRecords, clearSession, persist } from "./store.js";

export function createSync(state, syncUrl, hooks) {
  let timer = null;
  let running = false;
  let rerun = false;

  function schedule() {
    if (!state.session) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void syncNow("edit");
    }, 700);
  }

  async function syncNow() {
    if (!state.session) return { ok: false, error: "Not signed in." };
    if (running) {
      rerun = true;
      return { ok: true, queued: true };
    }
    running = true;
    let result = { ok: false, error: "Sync did not finish." };
    try {
      do {
        rerun = false;
        result = await pushAndPull();
      } while (rerun && state.session);
      return result;
    } finally {
      running = false;
    }
  }

  async function pushAndPull() {
    const snapshot = recordsToPush(state.records);
    state.syncing = true;
    hooks.onStatus?.();
    try {
      const response = await fetch(`${syncUrl}/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.session.token}`,
        },
        body: JSON.stringify({ records: snapshot }),
      });
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (response.status === 401) {
        clearSession(state);
        state.syncing = false;
        state.flash = {
          kind: "error",
          text: "Your session expired. Sign in again. Nothing on this device was deleted.",
        };
        hooks.onStatus?.();
        hooks.onData?.();
        return { ok: false, error: "Your session expired. Sign in again." };
      }
      if (!response.ok || !body || !Array.isArray(body.records)) {
        throw new Error(body?.error || "Sync didn't finish. Your changes are still saved on this device.");
      }
      state.lastSyncedAt = typeof body.serverTime === "number" ? body.serverTime : Date.now();
      state.syncError = null;
      state.syncing = false;
      applyServerRecords(state, body.records);
      hooks.onStatus?.();
      hooks.onData?.();
      return { ok: true };
    } catch (error) {
      state.syncing = false;
      if (!state.session) {
        hooks.onStatus?.();
        return { ok: false, error: error.message || "Sign in again." };
      }
      state.syncError = error.message || "Sync didn't finish. Your changes are still saved on this device.";
      persist(state);
      hooks.onStatus?.();
      return { ok: false, error: state.syncError };
    }
  }

  return { schedule, syncNow };
}

export async function registerAccount(syncUrl, email, password, recoveryEmail) {
  let response;
  try {
    response = await fetch(`${syncUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, recoveryEmail: recoveryEmail ?? "" }),
    });
  } catch {
    return { ok: false, error: "Could not reach the sync server. The account was not created." };
  }
  return readAuthResult(response, 201, "The account was not created.");
}

export async function loginAccount(syncUrl, email, password) {
  let response;
  try {
    response = await fetch(`${syncUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { ok: false, error: "Could not reach the sync server. You are not signed in." };
  }
  return readAuthResult(response, 200, "Sign-in did not finish.");
}

async function readAuthResult(response, successStatus, fallback) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.status === successStatus && body && typeof body.token === "string" && body.token && typeof body.email === "string") {
    const recoveryEmail = typeof body.recoveryEmail === "string" && body.recoveryEmail ? body.recoveryEmail : null;
    return { ok: true, token: body.token, email: body.email, recoveryEmail };
  }
  const reason = body?.error || `${fallback} (server status ${response.status}).`;
  return { ok: false, error: reason };
}

export async function requestPasswordReset(syncUrl, email) {
  let response;
  try {
    response = await fetch(`${syncUrl}/auth/reset-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch {
    return { ok: false, error: "Could not reach the sync server. The reset link was not sent." };
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok && body?.ok === true) return { ok: true };
  return { ok: false, error: body?.error || "The reset link was not sent." };
}

export async function confirmPasswordReset(syncUrl, token, password) {
  let response;
  try {
    response = await fetch(`${syncUrl}/auth/reset-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
  } catch {
    return { ok: false, error: "Could not reach the sync server. The password was not changed." };
  }
  return readAuthResult(response, 200, "The password was not changed.");
}

export async function updateRecoveryEmail(syncUrl, token, password, recoveryEmail) {
  let response;
  try {
    response = await fetch(`${syncUrl}/auth/recovery-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password, recoveryEmail }),
    });
  } catch {
    return { ok: false, error: "Could not reach the sync server. The recovery email was not changed." };
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok && body?.ok === true && typeof body.recoveryEmail === "string") {
    return { ok: true, recoveryEmail: body.recoveryEmail };
  }
  return { ok: false, error: body?.error || "The recovery email was not changed." };
}

export async function fetchAccount(syncUrl, token) {
  let response;
  try {
    response = await fetch(`${syncUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, error: "Could not reach the sync server." };
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok && body && typeof body.email === "string") {
    const recoveryEmail = typeof body.recoveryEmail === "string" && body.recoveryEmail ? body.recoveryEmail : null;
    return { ok: true, email: body.email, recoveryEmail };
  }
  return { ok: false, error: body?.error || "Could not load the account.", status: response.status };
}

export async function logoutAccount(syncUrl, token) {
  try {
    await fetch(`${syncUrl}/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* Signing out locally still keeps the log on this device. */
  }
}
