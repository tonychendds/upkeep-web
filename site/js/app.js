import { syncBaseFromLocation } from "./model.js";
import { loadState } from "./store.js";
import { createSync } from "./sync.js";
import { mountApp } from "./ui.js";

const state = loadState();
const syncUrl = syncBaseFromLocation(window.location);
const sync = createSync(state, syncUrl, {
  onStatus() {
    app.renderBanner();
  },
  onData() {
    app.renderData();
  },
});
const app = mountApp(document.querySelector("#app"), { state, sync, syncUrl });
app.start();

window.addEventListener("focus", () => {
  void sync.syncNow("focus");
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void sync.syncNow("visible");
});
if (state.session) void sync.syncNow("load");
