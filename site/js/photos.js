// Receipt bytes live in IndexedDB, never localStorage. The job record only stores ids.
const DB_NAME = "upkeep.photos.v1";
const STORE = "photos";

export async function loadJobPhotos(ids) {
  const all = await listPhotos();
  const wanted = new Set(ids);
  return all.filter((photo) => wanted.has(photo.id));
}

export async function commitJobPhotos(jobId, live, removed) {
  for (const photo of removed) {
    if (!photo.stored) continue;
    const existing = await getPhoto(photo.id);
    await putPhoto({
      id: photo.id,
      jobId: existing?.jobId || jobId,
      mime: "image/jpeg",
      blob: null,
      createdAt: existing?.createdAt || photo.createdAt || Date.now(),
      deleted: true,
      updatedAt: Date.now(),
      pending: true,
    });
  }
  for (const photo of live) {
    if (!photo.blob) continue;
    const existing = await getPhoto(photo.id);
    const alreadySynced = existing && !existing.deleted && existing.blob && !existing.pending;
    await putPhoto({
      id: photo.id,
      jobId,
      mime: photo.blob.type || "image/jpeg",
      blob: photo.blob,
      createdAt: photo.createdAt || existing?.createdAt || Date.now(),
      deleted: false,
      updatedAt: Date.now(),
      pending: !alreadySynced,
    });
  }
}

export async function tombstoneJobPhotos(jobId) {
  const all = await listPhotos();
  const now = Date.now();
  for (const photo of all) {
    if (photo.jobId !== jobId || photo.deleted) continue;
    await putPhoto({ ...photo, blob: null, deleted: true, pending: true, updatedAt: now });
  }
}

export async function ensurePhotos(syncUrl, token, ids) {
  for (const id of ids) {
    const existing = await getPhoto(id);
    if (existing?.deleted) continue;
    if (existing?.blob) continue;
    const full = await requestPhoto(syncUrl, token, `/photos/${encodeURIComponent(id)}`);
    if (full.status === 404) continue;
    if (!full.ok || !full.body) throw new Error(full.body?.error || "A receipt photo could not be downloaded.");
    await storeRemote(full.body);
  }
}

export async function syncPhotoStore(syncUrl, token) {
  const local = await listPhotos();
  for (const photo of local) {
    if (!photo.pending) continue;
    if (photo.deleted || !photo.blob) {
      const result = await requestPhoto(syncUrl, token, `/photos/${encodeURIComponent(photo.id)}`, { method: "DELETE" });
      if (!result.ok) throw new Error(result.body?.error || "A receipt photo could not be removed from your other devices.");
      await putPhoto({ ...photo, blob: null, deleted: true, pending: false });
      continue;
    }
    const data = await blobToBase64(photo.blob);
    const result = await requestPhoto(syncUrl, token, "/photos", {
      method: "POST",
      body: {
        id: photo.id,
        jobId: photo.jobId,
        mime: "image/jpeg",
        data,
        createdAt: photo.createdAt,
      },
    });
    if (!result.ok || !result.body) throw new Error(result.body?.error || "A receipt photo could not be uploaded.");
    if (result.body.deleted) await putPhoto({ ...photo, blob: null, deleted: true, pending: false });
    else await putPhoto({ ...photo, pending: false });
  }

  const listed = await requestPhoto(syncUrl, token, "/photos");
  if (!listed.ok || !Array.isArray(listed.body?.photos)) {
    throw new Error(listed.body?.error || "Receipt photos could not be synced.");
  }
  const current = new Map((await listPhotos()).map((photo) => [photo.id, photo]));
  for (const meta of listed.body.photos) {
    const existing = current.get(meta.id);
    if (existing?.deleted) continue;
    if (meta.deleted) {
      await putPhoto({
        id: meta.id,
        jobId: meta.jobId,
        mime: meta.mime || "image/jpeg",
        blob: null,
        createdAt: meta.createdAt || Date.now(),
        deleted: true,
        updatedAt: meta.updatedAt || Date.now(),
        pending: false,
      });
      continue;
    }
    if (existing?.blob) continue;
    const full = await requestPhoto(syncUrl, token, `/photos/${encodeURIComponent(meta.id)}`);
    if (!full.ok || !full.body) throw new Error(full.body?.error || "A receipt photo could not be downloaded.");
    await storeRemote(full.body);
  }
}

async function storeRemote(body) {
  if (!body || typeof body.id !== "string") return;
  if (body.deleted || typeof body.data !== "string" || !body.data) {
    await putPhoto({
      id: body.id,
      jobId: body.jobId,
      mime: body.mime || "image/jpeg",
      blob: null,
      createdAt: body.createdAt || Date.now(),
      deleted: true,
      updatedAt: body.updatedAt || Date.now(),
      pending: false,
    });
    return;
  }
  await putPhoto({
    id: body.id,
    jobId: body.jobId,
    mime: "image/jpeg",
    blob: base64ToBlob(body.data, "image/jpeg"),
    createdAt: body.createdAt || Date.now(),
    deleted: false,
    updatedAt: body.updatedAt || Date.now(),
    pending: false,
  });
}

async function requestPhoto(syncUrl, token, pathname, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`${syncUrl}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Could not reach the sync server. Receipt photos are still saved on this device.");
  }
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

async function listPhotos() {
  return withStore("readonly", (store) => requestToPromise(store.getAll()));
}

async function getPhoto(id) {
  return withStore("readonly", (store) => requestToPromise(store.get(id)));
}

async function putPhoto(photo) {
  await withStore("readwrite", (store) => requestToPromise(store.put(photo)));
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("This browser cannot store receipt photos."));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Receipt photos could not be opened on this device."));
  });
}

async function withStore(mode, run) {
  const db = await openDb();
  const tx = db.transaction(STORE, mode);
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("This device could not save the photo."));
    tx.onabort = () => reject(tx.error || new Error("This device could not save the photo."));
  });
  try {
    const result = await run(tx.objectStore(STORE));
    await done;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* already finished */ }
    await done.catch(() => {});
    throw error;
  } finally {
    db.close();
  }
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("This device could not save the photo."));
  });
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size));
  }
  return btoa(binary);
}

function base64ToBlob(data, mime) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}
