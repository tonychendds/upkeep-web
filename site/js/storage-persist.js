// Ask the browser to keep localStorage. Chrome can evict a site and wipe the log.
// This does not change what is stored or how sync works. Unsupported browsers are ignored.
export async function requestPersistentStorage() {
  try {
    const storage = globalThis.navigator?.storage;
    if (!storage || typeof storage.persist !== "function") return false;
    if (typeof storage.persisted === "function") {
      try {
        if (await storage.persisted()) return true;
      } catch {
        /* still try persist() */
      }
    }
    return (await storage.persist()) === true;
  } catch {
    return false;
  }
}
