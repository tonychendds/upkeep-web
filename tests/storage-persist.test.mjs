import assert from "node:assert/strict";
import { test } from "node:test";
import { requestPersistentStorage } from "../site/js/storage-persist.js";

function withNavigator(storage, run) {
  const previous = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: storage == null ? undefined : { storage } });
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (previous === undefined) delete globalThis.navigator;
      else Object.defineProperty(globalThis, "navigator", { configurable: true, value: previous });
    });
}

test("persistent storage is a no-op when the API is missing", async () => {
  await withNavigator(undefined, async () => {
    assert.equal(await requestPersistentStorage(), false);
  });
  await withNavigator({}, async () => {
    assert.equal(await requestPersistentStorage(), false);
  });
});

test("persistent storage is skipped when the browser already persisted the site", async () => {
  let persistCalls = 0;
  await withNavigator({
    persisted: async () => true,
    persist: async () => {
      persistCalls += 1;
      return true;
    },
  }, async () => {
    assert.equal(await requestPersistentStorage(), true);
  });
  assert.equal(persistCalls, 0);
});

test("persistent storage is requested when the site is not persisted", async () => {
  let persistCalls = 0;
  await withNavigator({
    persisted: async () => false,
    persist: async () => {
      persistCalls += 1;
      return true;
    },
  }, async () => {
    assert.equal(await requestPersistentStorage(), true);
  });
  assert.equal(persistCalls, 1);
});

test("persistent storage never throws", async () => {
  await withNavigator({
    persisted: async () => { throw new Error("persisted failed"); },
    persist: async () => { throw new Error("persist failed"); },
  }, async () => {
    assert.equal(await requestPersistentStorage(), false);
  });
  await withNavigator({
    persist: async () => { throw new Error("denied"); },
  }, async () => {
    assert.equal(await requestPersistentStorage(), false);
  });
});
