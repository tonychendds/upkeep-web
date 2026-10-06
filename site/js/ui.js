import { icon } from "./icons.js";
import {
  addMonths,
  assetLabel,
  assetSubtitle,
  buildBackup,
  categoriesFor,
  categoryLabel,
  contractorLabel,
  contractorSpent,
  currentMonth,
  filterJobs,
  formatDate,
  formatMoney,
  formatMonth,
  formatSynced,
  jobsUsing,
  liveRecords,
  newId,
  normalizeAssetPayload,
  parseBackup,
  parseMoney,
  recordError,
  repeatPresets,
  summarize,
  suggestNextDue,
  toCsv,
  todayISO,
  upcomingItems,
} from "./model.js";
import { clearSession, deleteRecord, importRecords, saveRecord, setSession } from "./store.js";
import { confirmPasswordReset, fetchAccount, loginAccount, logoutAccount, registerAccount, requestPasswordReset, updateRecoveryEmail } from "./sync.js";

const FORM_ROUTES = new Set(["job", "asset", "contractor"]);
const jobsFilter = { query: "", assetId: "", status: "", categoryId: "" };
const assetJobFilters = new Map();
let summaryMonth = currentMonth();
let accountMode = "signin";

export function mountApp(root, { state, sync, syncUrl }) {
  root.replaceChildren(shell());
  const main = document.querySelector("#main");
  const nav = document.querySelector("#nav");

  function start() {
    renderBanner();
    renderNav();
    renderMain();
    window.addEventListener("hashchange", () => {
      const route = parseRoute(location.hash);
      if (route.name !== "account" && route.name !== "reset") accountMode = "signin";
      state.flash = null;
      renderBanner();
      renderNav();
      renderMain();
      window.scrollTo(0, 0);
    });
  }

  function renderBanner() {
    const banner = document.querySelector("#sync-banner");
    banner.replaceChildren();
    if (state.loadWarning) banner.append(el("p", {}, [state.loadWarning]));
    if (!state.session) {
      const expired = typeof state.flash?.text === "string" && /session expired/i.test(state.flash.text);
      banner.className = expired ? "banner error" : "banner warn";
      banner.append(
        el("p", {}, [expired ? state.flash.text : "Not signed in. This log stays on this device only."]),
        el("a", { class: "banner-link", href: "#/account" }, ["Sign in"]),
      );
      return;
    }
    banner.className = state.syncError ? "banner error" : "banner ok";
    const detail = state.syncing
      ? "Syncing…"
      : state.syncError
        ? state.syncError
        : formatSynced(state.lastSyncedAt);
    banner.append(
      el("p", {}, [`Signed in as ${state.session.email}. ${detail}`]),
      el("button", { type: "button", class: "banner-link", onClick: () => void sync.syncNow("manual") }, [icon("sync"), "Sync now"]),
    );
  }

  function renderNav() {
    const route = parseRoute(location.hash);
    let current = activeNav(route);
    if (route.name === "job") {
      const assetId = (route.id && state.records[route.id]?.payload?.assetId) || route.assetId;
      const type = assetId && state.records[assetId]?.payload?.assetType;
      if (type === "home") current = "house";
      else if (type === "car") current = "car";
    }
    const items = [
      ["#/summary", "summary", "Summary", "summary"],
      ["#/house", "house", "House", "house"],
      ["#/car", "car", "Car", "car"],
      ["#/more", "more", "More", "more"],
    ];
    nav.replaceChildren(
      ...items.map(([href, name, label, iconName]) =>
        el("a", { class: "nav-link", href, "aria-current": current === name ? "page" : "false" }, [icon(iconName), label]),
      ),
    );
  }

  let shownKey = "";

  function renderMain() {
    const route = parseRoute(location.hash);
    main.dataset.screen = route.name;
    const view = {
      summary: () => renderSummary(),
      house: () => renderHouse(route),
      car: () => renderCar(route),
      upcoming: () => renderUpcoming(),
      jobs: () => renderJobs(),
      job: () => renderJob(route),
      assets: () => renderAssets(),
      asset: () => renderAsset(route),
      contractors: () => renderContractors(),
      contractor: () => renderContractor(route),
      account: () => renderAccount(),
      reset: () => renderReset(route),
      more: () => renderMore(),
    }[route.name];
    const key = [route.name, route.id || "", route.assetId || "", route.preset || "", route.token || "", route.markDone ? "1" : "", accountMode, state.flash?.text || ""].join("\0");
    const resetScroll = key !== shownKey;
    shownKey = key;
    main.replaceChildren(view ? view() : renderSummary());
    if (resetScroll) {
      main.scrollTop = 0;
      window.scrollTo(0, 0);
    }
    // preventScroll: focusing <main> otherwise scrolls the heading under the header.
    main.focus?.({ preventScroll: true });
    if (resetScroll) main.scrollTop = 0;
  }

  function renderData() {
    const route = parseRoute(location.hash);
    if (FORM_ROUTES.has(route.name)) return;
    renderMain();
  }

  function setFlash(kind, text) {
    state.flash = text ? { kind, text } : null;
    renderBanner();
    renderMain();
  }

  function go(hash) {
    if (location.hash === hash) renderMain();
    else location.hash = hash;
  }

  function renderSummary() {
    const totals = summarize(state.records, summaryMonth);
    const monthInput = el("input", { id: "summary-month", type: "month", value: summaryMonth });
    monthInput.addEventListener("change", () => {
      if (monthInput.value) summaryMonth = monthInput.value;
      renderMain();
    });
    return wrap([
      el("h1", {}, ["Summary"]),
      el("p", { class: "lede" }, ["Totals count completed jobs only. Scheduled work is not included."]),
      el("div", { class: "field month" }, [el("label", { for: "summary-month" }, ["Month"]), monthInput]),
      el("div", { class: "figures" }, [
        figure(formatMonth(summaryMonth), formatMoney(totals.monthCents), "month-total"),
        figure(summaryMonth.slice(0, 4), formatMoney(totals.yearCents), "year-total"),
      ]),
      breakdown("By asset", totals.assets, "No assets yet."),
      breakdown("By category", totals.categories, "No completed jobs in this year."),
      el("a", { class: "button", href: "#/jobs/new" }, [icon("plus"), "Log a job"]),
    ]);
  }

  function renderUpcoming() {
    const items = upcomingItems(state.records);
    const list = items.length
      ? items.map((item) => upcomingCard(item))
      : [el("div", { class: "panel" }, [el("p", { class: "lede" }, ["Nothing scheduled, and no next-due dates yet."])])];
    return wrap([
      el("h1", {}, ["All upcoming"]),
      el("p", { class: "lede" }, ["Scheduled jobs and the next time a finished job comes due. Overdue items are highlighted."]),
      el("div", { id: "upcoming-list", class: "stack" }, list),
      el("a", { class: "button", href: "#/jobs/new" }, [icon("plus"), "Log a job"]),
    ]);
  }

  function upcomingCard(item) {
    const payload = item.job.payload;
    const when = item.kind === "mileage"
      ? `Due at ${Number(payload.nextDueOdometer).toLocaleString("en-US")} mi`
      : formatDate(item.date);
    const kind = item.overdue ? "Overdue" : item.kind === "scheduled" ? "Scheduled" : item.kind === "mileage" ? "By mileage" : "Due again";
    return el("button", {
      type: "button",
      class: item.overdue ? "card-button overdue" : "card-button",
      onClick: () => { location.hash = `#/jobs/${item.job.id}`; },
    }, [
      el("span", { class: `pill ${item.overdue ? "overdue" : item.kind}` }, [kind]),
      el("span", { class: "card-title" }, [payload.title || "Job"]),
      el("span", { class: "meta" }, [`${assetLabel(state.records, payload.assetId)} · ${when}`]),
    ]);
  }

  function renderJobs() {
    const assets = assetChoices();
    const categories = [
      ...categoriesFor(state.records, "home"),
      ...categoriesFor(state.records, "car"),
    ];
    const seen = new Set();
    const categoryOptions = categories.filter((category) => {
      if (seen.has(category.id)) return false;
      seen.add(category.id);
      return true;
    });
    const query = el("input", { id: "job-search", type: "search", placeholder: "Search title, place, notes, contractor", value: jobsFilter.query });
    const assetSelect = selectFrom([["", "All assets"], ...assets.map((asset) => [asset.id, asset.payload.name])], jobsFilter.assetId);
    const statusSelect = selectFrom([["", "All statuses"], ["done", "Done"], ["scheduled", "Scheduled"]], jobsFilter.status);
    const categorySelect = selectFrom([["", "All categories"], ...categoryOptions.map((category) => [category.id, category.name])], jobsFilter.categoryId);
    const list = el("div", { id: "job-list", class: "stack" });
    const refill = () => {
      const jobs = filterJobs(state.records, jobsFilter);
      list.replaceChildren(
        ...(jobs.length
          ? jobs.map((job) => jobCard(job))
          : [el("div", { class: "panel" }, [el("p", { class: "lede" }, ["No jobs match."])])]),
      );
    };
    query.addEventListener("input", () => { jobsFilter.query = query.value; refill(); });
    assetSelect.addEventListener("change", () => { jobsFilter.assetId = assetSelect.value; refill(); });
    statusSelect.addEventListener("change", () => { jobsFilter.status = statusSelect.value; refill(); });
    categorySelect.addEventListener("change", () => { jobsFilter.categoryId = categorySelect.value; refill(); });
    refill();
    return wrap([
      el("h1", {}, ["All jobs"]),
      el("a", { class: "button", href: "#/jobs/new" }, [icon("plus"), "Log a job"]),
      el("div", { class: "filters" }, [
        labeled("Search", query),
        labeled("Asset filter", assetSelect),
        labeled("Status filter", statusSelect),
        labeled("Category filter", categorySelect),
      ]),
      list,
    ]);
  }

  function jobCard(job) {
    const payload = job.payload;
    const cost = payload.costCents == null ? "No cost yet" : formatMoney(payload.costCents);
    return el("button", {
      type: "button",
      class: "card-button",
      onClick: () => { location.hash = `#/jobs/${job.id}`; },
    }, [
      el("span", { class: `pill ${payload.status === "done" ? "done" : "scheduled"}` }, [payload.status === "done" ? "Done" : "Scheduled"]),
      el("span", { class: "card-title" }, [payload.title]),
      el("span", { class: "meta" }, [`${formatDate(payload.date)} · ${assetLabel(state.records, payload.assetId)} · ${categoryLabel(state.records, payload.categoryId)}`]),
      el("span", {}, [cost]),
    ]);
  }

  function renderHouse(route) {
    const homes = assetChoices().filter((asset) => asset.payload.assetType === "home");
    if (!homes.length) {
      return wrap([
        el("h1", {}, ["House"]),
        el("div", { class: "panel", "data-testid": "house-empty" }, [
          el("p", { class: "lede" }, ["No home yet. Add one to track jobs, upcoming work, and spending."]),
        ]),
        el("a", { class: "button", href: "#/assets/new/home" }, [icon("plus"), "Add a home"]),
      ]);
    }
    const home = homes.find((asset) => asset.id === route.id) || homes[0];
    const parts = [el("h1", {}, ["House"])];
    if (homes.length > 1) parts.push(assetPicker("Home", "home-picker", homes, home.id, (id) => { location.hash = `#/house/${id}`; }));
    parts.push(
      el("section", { class: "card stack", "data-testid": "house-details" }, [
        el("h2", { "data-testid": "house-name" }, [home.payload.name || "Home"]),
        el("p", { class: "meta" }, ["Home"]),
        el("a", { class: "button secondary", href: `#/assets/${home.id}` }, ["Edit home"]),
      ]),
      el("h2", {}, ["Upcoming"]),
      upcomingStack(itemsForAsset(home.id), "Nothing scheduled for this home, and no next-due dates yet."),
      el("h2", {}, ["Jobs"]),
      el("a", { class: "button", href: `#/jobs/new/${home.id}` }, [icon("plus"), "Log a job"]),
      scopedJobBrowser(home),
      spendingBlock(home.id, "Completed jobs for this home.", "house-month-total", "house-year-total"),
    );
    return wrap(parts);
  }

  function renderCar(route) {
    const cars = assetChoices().filter((asset) => asset.payload.assetType === "car");
    if (!cars.length) {
      return wrap([
        el("h1", {}, ["Car"]),
        el("div", { class: "panel", "data-testid": "car-empty" }, [
          el("p", { class: "lede" }, ["No cars yet. Add one to track service, upcoming work, and spending."]),
        ]),
        el("a", { class: "button", href: "#/assets/new/car" }, [icon("plus"), "Add car"]),
      ]);
    }
    const car = cars.find((asset) => asset.id === route.id) || cars[0];
    const payload = car.payload;
    const parts = [el("h1", {}, ["Car"])];
    if (cars.length > 1) {
      parts.push(assetPicker("Car", "car-picker", cars, car.id, (id) => { location.hash = `#/car/${id}`; }));
      parts.push(el("a", { class: "button secondary", href: "#/assets/new/car" }, [icon("plus"), "Add car"]));
    }
    parts.push(
      el("section", { class: "card stack", "data-testid": "car-details" }, [
        el("h2", { "data-testid": "car-name" }, [payload.name || "Car"]),
        el("p", { class: "meta" }, [assetSubtitle(payload)]),
        detailList([
          ["Brand", payload.make, "car-brand"],
          ["Model", payload.model, "car-model"],
          ["Year", payload.year, "car-year"],
          ["Plate", payload.plate, "car-plate"],
          ["VIN", payload.vin, "car-vin"],
          ["Nickname", payload.nickname, "car-nickname"],
        ]),
        el("a", { class: "button secondary", href: `#/assets/${car.id}` }, ["Edit car"]),
      ]),
      el("h2", {}, ["Upcoming"]),
      upcomingStack(itemsForAsset(car.id), "Nothing scheduled for this car, and no next-due dates yet."),
      el("h2", {}, ["Jobs"]),
      el("a", { class: "button", href: `#/jobs/new/${car.id}` }, [icon("plus"), "Log a job"]),
      scopedJobBrowser(car),
      spendingBlock(car.id, "Completed jobs for this car.", "car-month-total", "car-year-total"),
    );
    if (cars.length === 1) parts.push(el("a", { class: "button secondary", href: "#/assets/new/car" }, [icon("plus"), "Add car"]));
    return wrap(parts);
  }

  function assetPicker(label, testid, assets, selected, onChange) {
    const picker = selectFrom(assets.map((asset) => [asset.id, asset.payload.name]), selected);
    picker.setAttribute("data-testid", testid);
    picker.addEventListener("change", () => onChange(picker.value));
    return labeled(label, picker);
  }

  function itemsForAsset(assetId) {
    return upcomingItems(state.records).filter((item) => item.job.payload?.assetId === assetId);
  }

  function upcomingStack(items, empty) {
    const list = items.length
      ? items.map((item) => upcomingCard(item))
      : [el("div", { class: "panel" }, [el("p", { class: "lede" }, [empty])])];
    return el("div", { class: "stack" }, list);
  }

  function spendingBlock(assetId, lede, monthTest, yearTest) {
    const month = currentMonth();
    const totals = summarize(state.records, month);
    const row = totals.assets.find((asset) => asset.id === assetId) || { monthCents: 0, yearCents: 0 };
    return el("section", { class: "stack" }, [
      el("h2", {}, ["Spending"]),
      el("p", { class: "lede" }, [lede]),
      el("div", { class: "figures" }, [
        figure(formatMonth(month), formatMoney(row.monthCents), monthTest),
        figure(month.slice(0, 4), formatMoney(row.yearCents), yearTest),
      ]),
    ]);
  }

  function scopedJobBrowser(asset) {
    const filters = assetJobFilters.get(asset.id) || { query: "", status: "", categoryId: "" };
    assetJobFilters.set(asset.id, filters);
    const categories = categoriesFor(state.records, asset.payload.assetType);
    const query = el("input", {
      type: "search",
      placeholder: "Search title, place, notes, contractor",
      value: filters.query,
    });
    const statusSelect = selectFrom([["", "All statuses"], ["done", "Done"], ["scheduled", "Scheduled"]], filters.status);
    const categorySelect = selectFrom([["", "All categories"], ...categories.map((category) => [category.id, category.name])], filters.categoryId);
    const list = el("div", { class: "stack", "data-testid": "asset-job-list" });
    const refill = () => {
      const jobs = filterJobs(state.records, { ...filters, assetId: asset.id });
      list.replaceChildren(
        ...(jobs.length
          ? jobs.map((job) => jobCard(job))
          : [el("div", { class: "panel" }, [el("p", { class: "lede" }, ["No jobs match."])])]),
      );
    };
    query.addEventListener("input", () => { filters.query = query.value; refill(); });
    statusSelect.addEventListener("change", () => { filters.status = statusSelect.value; refill(); });
    categorySelect.addEventListener("change", () => { filters.categoryId = categorySelect.value; refill(); });
    refill();
    return el("div", { class: "stack" }, [
      el("div", { class: "filters" }, [
        labeled("Search", query),
        labeled("Status filter", statusSelect),
        labeled("Category filter", categorySelect),
      ]),
      list,
    ]);
  }

  function sectionForAsset(assetId) {
    const type = state.records[assetId]?.payload?.assetType;
    if (type === "car") return `#/car/${assetId}`;
    if (type === "home") return `#/house/${assetId}`;
    return "#/jobs";
  }

  function renderJob(route) {
    const existing = route.id ? state.records[route.id] : null;
    if (route.id && (!existing || existing.deleted || existing.type !== "job")) {
      return wrap([el("h1", {}, ["Job not found"]), el("a", { class: "button secondary", href: "#/jobs" }, ["Back to jobs"])]);
    }
    const assets = assetChoices();
    if (!assets.length) {
      return wrap([
        el("h1", {}, ["Log a job"]),
        el("p", { class: "lede" }, ["Add a home or a car first."]),
        el("a", { class: "button", href: "#/assets/new" }, ["Add asset"]),
      ]);
    }
    const payload = existing?.payload || {};
    let status = route.markDone ? "done" : payload.status || "done";
    let nextDueTouched = Boolean(payload.nextDueDate) && !route.markDone;
    const assetSelect = el("select");
    const categorySelect = el("select");
    const contractorSelect = el("select");
    const title = input("text", payload.title || "", { required: true, maxlength: "160" });
    const where = input("text", payload.location || "", { maxlength: "160" });
    const cost = input("text", payload.costCents == null ? "" : (payload.costCents / 100).toFixed(2), { inputmode: "decimal", placeholder: "0.00" });
    const date = input("date", payload.date || todayISO());
    const nextDue = input("date", payload.nextDueDate || "");
    const odometer = input("text", payload.odometer ?? "", { inputmode: "numeric", placeholder: "Miles" });
    const notes = el("textarea", { maxlength: "4000" }, [payload.notes || ""]);
    const repeat = el("select");
    const customRepeat = input("number", payload.repeat && !["3", "6", "12"].includes(String(payload.repeat.every)) ? String(payload.repeat.every) : "", { min: "1", inputmode: "numeric" });
    const newCategory = input("text", "", { maxlength: "80" });
    const contractorName = input("text", "", { maxlength: "80" });
    const contractorPhone = input("tel", "", { maxlength: "40" });
    const contractorEmail = input("email", "", { maxlength: "200" });
    const newCategoryWrap = el("div", { class: "field" });
    const newContractorWrap = el("div", { class: "stack" });
    const odometerWrap = el("div", { class: "field" });
    const customWrap = el("div", { class: "field" });
    const hint = el("p", { class: "hint" });
    const error = el("div", { class: "flash error", hidden: true, role: "alert" });
    const doneButton = el("button", { type: "button" }, ["Done"]);
    const scheduledButton = el("button", { type: "button" }, ["Scheduled"]);
    const dateLabel = el("label", {}, ["Date done"]);
    date.id = "job-date";
    dateLabel.htmlFor = date.id;

    function showError(message) {
      error.hidden = !message;
      error.textContent = message || "";
      // The message sits at the top of a long form; bring it into view after tapping Save.
      if (message) error.scrollIntoView({ block: "nearest" });
    }

    function selectedType() {
      return state.records[assetSelect.value]?.payload?.assetType || "home";
    }

    function fillAssets() {
      assetSelect.replaceChildren(...assets.map((asset) => new Option(asset.payload.name, asset.id)));
      const fromRoute = route.assetId && assets.some((asset) => asset.id === route.assetId) ? route.assetId : "";
      const preferred = payload.assetId && assets.some((asset) => asset.id === payload.assetId)
        ? payload.assetId
        : fromRoute || assets[0].id;
      assetSelect.value = preferred;
    }

    function fillCategories(preferred) {
      const options = categoriesFor(state.records, selectedType());
      const placeholder = new Option("Choose…", "");
      placeholder.disabled = true;
      categorySelect.replaceChildren(
        placeholder,
        ...options.map((category) => new Option(category.name, category.id)),
        new Option("Add a category…", "__new"),
      );
      const keep = preferred && options.some((category) => category.id === preferred) ? preferred : "";
      categorySelect.value = keep;
      newCategoryWrap.hidden = categorySelect.value !== "__new";
    }

    function fillContractors() {
      const contractors = liveRecords(state.records, "contractor");
      contractorSelect.replaceChildren(
        new Option("No contractor", "none"),
        ...contractors.map((contractor) => new Option(contractor.payload.name, contractor.id)),
        new Option("Add a contractor…", "__new"),
      );
      const current = payload.contractorId && contractors.some((contractor) => contractor.id === payload.contractorId) ? payload.contractorId : "none";
      contractorSelect.value = current;
      newContractorWrap.hidden = contractorSelect.value !== "__new";
    }

    function fillRepeat() {
      const current = repeat.value;
      const presets = repeatPresets(selectedType());
      repeat.replaceChildren(new Option("Does not repeat", ""), ...presets.map((preset) => new Option(preset.label, preset.value)));
      const stored = payload.repeat;
      let preferred = current;
      if (!preferred && stored?.unit === "months" && [3, 6, 12].includes(stored.every)) preferred = `months:${stored.every}`;
      else if (!preferred && stored?.unit === "months") preferred = "months:custom";
      else if (!preferred && stored?.unit === "miles" && selectedType() === "car") preferred = "miles:custom";
      if (![...repeat.options].some((option) => option.value === preferred)) preferred = "";
      repeat.value = preferred || "";
      customWrap.hidden = repeat.value !== "months:custom" && repeat.value !== "miles:custom";
    }

    function readRepeat() {
      if (!repeat.value) return null;
      if (repeat.value === "months:3") return { unit: "months", every: 3 };
      if (repeat.value === "months:6") return { unit: "months", every: 6 };
      if (repeat.value === "months:12") return { unit: "months", every: 12 };
      const every = Number(customRepeat.value);
      if (!Number.isInteger(every) || every < 1) return undefined;
      return { unit: repeat.value === "miles:custom" ? "miles" : "months", every };
    }

    function refreshStatus() {
      doneButton.setAttribute("aria-pressed", status === "done" ? "true" : "false");
      scheduledButton.setAttribute("aria-pressed", status === "scheduled" ? "true" : "false");
      dateLabel.textContent = status === "done" ? "Date done" : "Scheduled date";
      odometerWrap.hidden = selectedType() !== "car";
      const interval = readRepeat();
      if (status === "done" && interval?.unit === "months" && date.value && !nextDueTouched) {
        const suggested = suggestNextDue(date.value, interval) || addMonths(date.value, interval.every);
        if (suggested) nextDue.value = suggested;
      }
      if (status === "done" && interval?.unit === "miles") {
        const miles = Number(odometer.value);
        hint.textContent = Number.isInteger(miles) && miles >= 0 && odometer.value.trim()
          ? `Next due around ${(miles + interval.every).toLocaleString("en-US")} miles. You can also set a date.`
          : "Enter the current odometer and how many miles between visits.";
      } else if (status === "done" && interval?.unit === "months") {
        hint.textContent = "Suggested from the repeat interval. You can change it.";
      } else {
        hint.textContent = "Optional. Mark the job done with a repeat to suggest the next date.";
      }
    }

    function onAssetChange() {
      const previousCategory = categorySelect.value;
      fillCategories(previousCategory);
      fillRepeat();
      refreshStatus();
    }

    fillAssets();
    fillCategories(payload.categoryId);
    fillContractors();
    fillRepeat();
    assetSelect.addEventListener("change", onAssetChange);
    categorySelect.addEventListener("change", () => { newCategoryWrap.hidden = categorySelect.value !== "__new"; });
    contractorSelect.addEventListener("change", () => { newContractorWrap.hidden = contractorSelect.value !== "__new"; });
    repeat.addEventListener("change", () => {
      customWrap.hidden = repeat.value !== "months:custom" && repeat.value !== "miles:custom";
      refreshStatus();
    });
    doneButton.addEventListener("click", () => { status = "done"; refreshStatus(); });
    scheduledButton.addEventListener("click", () => { status = "scheduled"; refreshStatus(); });
    date.addEventListener("change", refreshStatus);
    customRepeat.addEventListener("input", refreshStatus);
    odometer.addEventListener("input", refreshStatus);
    nextDue.addEventListener("input", () => { nextDueTouched = true; });
    refreshStatus();

    newCategoryWrap.append(el("label", {}, ["New category"]), newCategory);
    newCategoryWrap.hidden = true;
    newContractorWrap.append(
      labeled("Contractor name", contractorName),
      labeled("Phone", contractorPhone),
      labeled("Email", contractorEmail),
    );
    odometerWrap.append(labeled("Odometer", odometer));
    customWrap.append(el("label", {}, ["How many"]), customRepeat);

    const form = el("form", { id: "job-form", class: "stack" });
    form.append(
      error,
      labeled("What was done", title),
      labeled("Asset", assetSelect),
      labeled("Category", categorySelect),
      newCategoryWrap,
      labeled("Where", where),
      labeled("Contractor", contractorSelect),
      newContractorWrap,
      labeled("Cost", cost),
      el("div", { class: "field" }, [el("span", {}, ["Status"]), el("div", { class: "segment" }, [scheduledButton, doneButton])]),
      el("div", { class: "field" }, [dateLabel, date]),
      labeled("Repeat", repeat),
      customWrap,
      labeled("Next due date", nextDue),
      hint,
      odometerWrap,
      labeled("Notes", notes),
      el("button", { type: "submit", class: "button" }, ["Save job"]),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      showError("");
      const assetId = assetSelect.value;
      const assetType = selectedType();
      let categoryId = categorySelect.value;
      if (!categoryId) return showError("Choose a category.");
      if (categoryId === "__new") {
        const name = newCategory.value.trim();
        if (!name) return showError("Name the new category.");
        categoryId = newId();
        const category = { id: categoryId, type: "category", updatedAt: Date.now(), deleted: false, payload: { name, assetType } };
        const problem = recordError(category);
        if (problem) return showError(problem);
        saveRecord(state, category);
      }
      let contractorId = contractorSelect.value === "none" ? null : contractorSelect.value;
      if (contractorSelect.value === "__new") {
        const name = contractorName.value.trim();
        if (!name) return showError("Name the contractor.");
        contractorId = newId();
        const contractor = {
          id: contractorId,
          type: "contractor",
          updatedAt: Date.now(),
          deleted: false,
          payload: { name, phone: contractorPhone.value.trim(), email: contractorEmail.value.trim() },
        };
        const problem = recordError(contractor);
        if (problem) return showError(problem);
        saveRecord(state, contractor);
      }
      const costCents = parseMoney(cost.value);
      if (costCents === undefined) return showError("Enter the cost in dollars, like 89.50, or leave it blank.");
      const interval = readRepeat();
      if (interval === undefined) return showError("Enter how often this repeats.");
      let miles = null;
      if (assetType === "car" && odometer.value.trim()) {
        if (!/^\d+$/.test(odometer.value.trim())) return showError("Odometer should be a whole number of miles.");
        miles = Number(odometer.value.trim());
      }
      const job = {
        id: existing?.id || newId(),
        type: "job",
        updatedAt: Date.now(),
        deleted: false,
        payload: {
          title: title.value.trim(),
          assetId,
          categoryId,
          location: where.value.trim(),
          contractorId,
          costCents,
          status,
          date: date.value,
          nextDueDate: nextDue.value || null,
          nextDueOdometer: interval?.unit === "miles" && miles != null ? miles + interval.every : null,
          repeat: interval,
          odometer: miles,
          notes: notes.value.trim(),
        },
      };
      const problem = recordError(job);
      if (problem) return showError(problem);
      saveRecord(state, job);
      sync.schedule();
      go(sectionForAsset(assetId));
    });

    const extra = [];
    if (existing && payload.status === "done" && (payload.nextDueDate || payload.nextDueOdometer || payload.repeat)) {
      extra.push(el("button", { type: "button", class: "button secondary", onClick: () => scheduleFollowUp(existing) }, ["Schedule next visit"]));
    }
    if (existing) {
      extra.push(el("button", { type: "button", class: "button danger", onClick: () => void removeJob(existing) }, ["Delete job"]));
    }
    return wrap([
      el("h1", {}, [existing ? "Edit job" : "Log a job"]),
      el("p", { class: "lede" }, ["Where it happened, who did it, what it cost, and when it should happen again."]),
      form,
      ...extra,
    ]);
  }

  function scheduleFollowUp(job) {
    const payload = job.payload;
    const id = newId();
    const now = Date.now();
    saveRecord(state, {
      id,
      type: "job",
      updatedAt: now,
      deleted: false,
      payload: {
        title: payload.title,
        assetId: payload.assetId,
        categoryId: payload.categoryId,
        location: payload.location || "",
        contractorId: payload.contractorId || null,
        costCents: null,
        status: "scheduled",
        date: payload.nextDueDate || todayISO(),
        nextDueDate: null,
        nextDueOdometer: null,
        repeat: payload.repeat || null,
        odometer: null,
        notes: "",
      },
    });
    saveRecord(state, {
      ...job,
      updatedAt: now + 1,
      payload: { ...payload, nextDueDate: null, nextDueOdometer: null },
    });
    sync.schedule();
    go(`#/jobs/${id}`);
  }

  async function removeJob(job) {
    const ok = await confirmDialog("Delete this job?", "It stays deleted on your other devices after sync. This does not erase the rest of the log.", "Delete job");
    if (!ok) return;
    deleteRecord(state, job.id);
    sync.schedule();
    go(sectionForAsset(job.payload?.assetId));
  }

  function renderAssets() {
    const assets = assetChoices();
    return wrap([
      el("h1", {}, ["Assets"]),
      el("p", { class: "lede" }, ["Your home and each car. Open a car to see its plate, VIN, and nickname."]),
      el("div", { class: "stack" }, assets.map((asset) => el("button", {
        type: "button",
        class: "card-button",
        onClick: () => { location.hash = `#/assets/${asset.id}`; },
      }, [
        el("span", { class: "card-title" }, [asset.payload.name]),
        el("span", { class: "meta" }, [assetSubtitle(asset.payload)]),
      ]))),
      el("a", { class: "button", href: "#/assets/new" }, [icon("plus"), "Add asset"]),
    ]);
  }

  function renderAsset(route) {
    const existing = route.id ? state.records[route.id] : null;
    if (route.id && (!existing || existing.deleted || existing.type !== "asset")) {
      return wrap([el("h1", {}, ["Asset not found"]), el("a", { class: "button secondary", href: "#/assets" }, ["Back to assets"])]);
    }
    const payload = existing?.payload || { assetType: route.preset === "home" ? "home" : "car", name: "" };
    let assetType = payload.assetType === "home" ? "home" : "car";
    const name = input("text", payload.assetType === "home" ? payload.name || "" : "", { maxlength: "80" });
    const make = input("text", payload.make || "", { maxlength: "40", placeholder: "Lexus", autocapitalize: "words" });
    const model = input("text", payload.model || "", { maxlength: "40", placeholder: "RX" });
    const year = input("text", payload.year || "", { maxlength: "4", inputmode: "numeric", placeholder: "2019" });
    const plate = input("text", payload.plate || "", { maxlength: "12", autocapitalize: "characters", placeholder: "8ABC123" });
    const vin = input("text", payload.vin || "", { maxlength: "17", autocapitalize: "characters", placeholder: "Optional" });
    const nickname = input("text", payload.nickname || "", { maxlength: "80", placeholder: "Optional" });
    const previewName = el("strong", { "data-testid": "display-name" });
    const preview = el("div", { class: "preview" }, [el("span", {}, ["Shows up as"]), previewName]);
    const carFields = el("div", { class: "stack" });
    const homeFields = el("div", { class: "field" });
    const error = el("div", { class: "flash error", hidden: true, role: "alert" });
    const homeButton = el("button", { type: "button" }, ["Home"]);
    const carButton = el("button", { type: "button" }, ["Car"]);
    homeFields.append(labeled("Home name", name));
    carFields.append(
      labeled("Brand", make),
      labeled("Model", model),
      labeled("Year built", year),
      labeled("License plate", plate),
      labeled("VIN", vin),
      el("p", { class: "hint" }, ["VIN is optional. Brand, model, year, and plate are used for the name."]),
      labeled("Nickname", nickname),
      el("p", { class: "hint" }, ["Leave the nickname blank to use the generated name, such as 2019 Lexus RX · 8ABC123."]),
    );

    function refresh() {
      homeButton.hidden = Boolean(existing);
      carButton.hidden = Boolean(existing);
      homeButton.setAttribute("aria-pressed", assetType === "home" ? "true" : "false");
      carButton.setAttribute("aria-pressed", assetType === "car" ? "true" : "false");
      homeFields.hidden = assetType !== "home";
      carFields.hidden = assetType !== "car";
      preview.hidden = assetType !== "car";
      const next = normalizeAssetPayload({
        assetType,
        name: name.value,
        make: make.value,
        model: model.value,
        year: year.value,
        plate: plate.value,
        vin: vin.value,
        nickname: nickname.value,
      });
      previewName.textContent = next.name || "Add the year, brand, model, and plate";
    }

    for (const node of [name, make, model, year, plate, vin, nickname]) node.addEventListener("input", refresh);
    homeButton.addEventListener("click", () => { assetType = "home"; refresh(); });
    carButton.addEventListener("click", () => { assetType = "car"; refresh(); });
    refresh();

    const form = el("form", { id: "asset-form", class: "stack" });
    form.append(
      error,
      existing ? el("p", { class: "meta" }, [assetType === "car" ? "Car" : "Home"]) : el("div", { class: "segment" }, [homeButton, carButton]),
      preview,
      homeFields,
      carFields,
      el("button", { type: "submit", class: "button" }, ["Save asset"]),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const next = normalizeAssetPayload({
        assetType,
        name: name.value,
        make: make.value,
        model: model.value,
        year: year.value,
        plate: plate.value,
        vin: vin.value,
        nickname: nickname.value,
      });
      const record = { id: existing?.id || newId(), type: "asset", updatedAt: Date.now(), deleted: false, payload: next };
      const problem = recordError(record);
      if (problem) {
        error.hidden = false;
        error.textContent = problem;
        error.scrollIntoView({ block: "nearest" });
        return;
      }
      saveRecord(state, record);
      sync.schedule();
      if (existing || route.preset) go(record.payload.assetType === "car" ? `#/car/${record.id}` : `#/house/${record.id}`);
      else go("#/assets");
    });

    const page = wrap([
      el("h1", {}, [existing ? (assetType === "car" ? "Car details" : "Home") : "Add asset"]),
      el("p", { class: "lede" }, [assetType === "car" || !existing ? "Brand, model, year, and plate build the name. A nickname replaces it." : "Rename this home, or delete it if you don't need it."]),
      form,
    ]);
    if (existing) {
      page.append(el("button", {
        type: "button",
        class: "button danger",
        onClick: async () => {
          const count = jobsUsing(state.records, "assetId", existing.id);
          const ok = await confirmDialog(
            `Delete ${existing.payload.name}?`,
            count ? `${count} job${count === 1 ? "" : "s"} will keep this name in their history.` : "You can add it again later.",
            "Delete asset",
          );
          if (!ok) return;
          deleteRecord(state, existing.id);
          sync.schedule();
          go(existing.payload.assetType === "car" ? "#/car" : "#/house");
        },
      }, ["Delete asset"]));
    }
    return page;
  }

  function renderContractors() {
    const contractors = liveRecords(state.records, "contractor");
    const cards = contractors.length
      ? contractors.map((contractor) => el("button", {
        type: "button",
        class: "card-button",
        onClick: () => { location.hash = `#/contractors/${contractor.id}`; },
      }, [
        el("span", { class: "card-title" }, [contractor.payload.name]),
        el("span", { class: "meta" }, [[contractor.payload.phone, contractor.payload.email].filter(Boolean).join(" · ") || "No phone or email"]),
        el("span", {}, [`Spent ${formatMoney(contractorSpent(state.records, contractor.id))} on completed jobs`]),
      ]))
      : [el("div", { class: "panel" }, [el("p", { class: "lede" }, ["Contractors you add on a job show up here."])])];
    return wrap([
      el("h1", {}, ["Contractors"]),
      el("p", { class: "lede" }, ["People and shops you've used, with the total spent on completed jobs."]),
      el("div", { class: "stack" }, cards),
      el("a", { class: "button", href: "#/contractors/new" }, [icon("plus"), "Add contractor"]),
    ]);
  }

  function renderContractor(route) {
    const existing = route.id ? state.records[route.id] : null;
    if (route.id && (!existing || existing.deleted || existing.type !== "contractor")) {
      return wrap([el("h1", {}, ["Contractor not found"]), el("a", { class: "button secondary", href: "#/contractors" }, ["Back"])]);
    }
    const payload = existing?.payload || { name: "", phone: "", email: "" };
    const name = input("text", payload.name || "", { maxlength: "80" });
    const phone = input("tel", payload.phone || "", { maxlength: "40" });
    const email = input("email", payload.email || "", { maxlength: "200" });
    const error = el("div", { class: "flash error", hidden: true, role: "alert" });
    const form = el("form", { class: "stack" });
    form.append(error, labeled("Name", name), labeled("Phone", phone), labeled("Email", email), el("button", { type: "submit", class: "button" }, ["Save contractor"]));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const record = {
        id: existing?.id || newId(),
        type: "contractor",
        updatedAt: Date.now(),
        deleted: false,
        payload: { name: name.value.trim(), phone: phone.value.trim(), email: email.value.trim() },
      };
      const problem = recordError(record);
      if (problem) {
        error.hidden = false;
        error.textContent = problem;
        error.scrollIntoView({ block: "nearest" });
        return;
      }
      saveRecord(state, record);
      sync.schedule();
      go("#/contractors");
    });
    const page = wrap([
      el("h1", {}, [existing ? "Contractor" : "Add contractor"]),
      existing ? el("p", { class: "lede" }, [`Spent ${formatMoney(contractorSpent(state.records, existing.id))} on completed jobs.`]) : el("p", { class: "lede" }, ["Save someone you use more than once, then pick them on a job."]),
      form,
    ]);
    if (existing) {
      page.append(el("button", {
        type: "button",
        class: "button danger",
        onClick: async () => {
          const ok = await confirmDialog(`Delete ${existing.payload.name}?`, "Jobs keep the name in their history.", "Delete contractor");
          if (!ok) return;
          deleteRecord(state, existing.id);
          sync.schedule();
          go("#/contractors");
        },
      }, ["Delete contractor"]));
    }
    return page;
  }

  function renderAccount() {
    const blocks = [el("h1", {}, ["Account"]), flashNode()];
    if (accountMode === "forgot") return wrap([...blocks, renderForgot()]);
    if (state.session) {
      if (!("recoveryEmail" in state.session)) ensureRecoveryEmail();
      const recovery = state.session.recoveryEmail;
      const recoveryNote = !("recoveryEmail" in state.session)
        ? "Loading recovery email…"
        : recovery
          ? `A reset link can be emailed to ${recovery}.`
          : "No recovery email is set. Add one so a forgotten password can be reset by email.";
      const recoveryInput = input("email", recovery || "", { autocomplete: "email", maxlength: "200", placeholder: "name@example.com" });
      const currentPassword = input("password", "", { autocomplete: "current-password", maxlength: "200" });
      const recoveryError = el("div", { class: "flash error", hidden: true, role: "alert" });
      const recoveryForm = el("form", { class: "stack" });
      recoveryForm.append(
        recoveryError,
        labeled("Recovery email", recoveryInput),
        labeled("Current password", currentPassword),
        el("button", { type: "submit", class: "button" }, ["Save recovery email"]),
      );
      recoveryForm.addEventListener("submit", (event) => {
        event.preventDefault();
        recoveryError.hidden = true;
        const next = recoveryInput.value.trim();
        if (!looksLikeEmail(next)) {
          recoveryError.hidden = false;
          recoveryError.textContent = "Enter a valid recovery email.";
          recoveryError.scrollIntoView({ block: "nearest" });
          return;
        }
        if (currentPassword.value.length < 8) {
          recoveryError.hidden = false;
          recoveryError.textContent = "Enter your current password.";
          recoveryError.scrollIntoView({ block: "nearest" });
          return;
        }
        void saveRecoveryEmail(next, currentPassword.value);
      });
      blocks.push(
        el("div", { class: "panel stack" }, [
          el("p", { class: "lede" }, [`Signed in as ${state.session.email}.`]),
          el("p", { class: "meta" }, [state.syncError || formatSynced(state.lastSyncedAt)]),
          el("p", { class: "fine" }, [recoveryNote]),
          el("p", { class: "fine" }, ["Signing out keeps this log on the device."]),
        ]),
        el("button", { type: "button", class: "button", onClick: () => void sync.syncNow("manual") }, [icon("sync"), "Sync now"]),
        recoveryForm,
        el("button", {
          type: "button",
          class: "button secondary",
          onClick: async () => {
            const ok = await confirmDialog("Sign out on this device?", "Your log stays on this device. It will not be deleted from the server.", "Sign out");
            if (!ok) return;
            const token = state.session?.token;
            clearSession(state);
            if (token) await logoutAccount(syncUrl, token);
            setFlash("success", "Signed out. This log is only on this device until you sign in again.");
          },
        }, ["Sign out"]),
      );
      return wrap(blocks);
    }
    const login = input("text", "", { autocomplete: "username", maxlength: "200" });
    const password = input("password", "", { autocomplete: accountMode === "create" ? "new-password" : "current-password", maxlength: "200" });
    const confirm = input("password", "", { autocomplete: "new-password", maxlength: "200" });
    const recovery = input("email", "", { autocomplete: "email", maxlength: "200", placeholder: "name@example.com" });
    const ack = el("input", { type: "checkbox", id: "ack" });
    const ackText = document.createTextNode("");
    const warningTitle = el("strong", {}, [""]);
    const warningBody = el("p", { class: "lede" }, [""]);
    let recoveryTouched = false;
    const signinTab = el("button", { type: "button", "aria-pressed": accountMode === "signin" ? "true" : "false" }, ["I have an account"]);
    const createTab = el("button", { type: "button", "aria-pressed": accountMode === "create" ? "true" : "false" }, ["New account"]);
    signinTab.addEventListener("click", () => { accountMode = "signin"; renderMain(); });
    createTab.addEventListener("click", () => { accountMode = "create"; renderMain(); });
    function syncRecoveryPrefill() {
      if (recoveryTouched) return;
      const typed = login.value.trim();
      recovery.value = looksLikeEmail(typed) ? typed : "";
      refreshCreateWarning();
    }
    function refreshCreateWarning() {
      const email = recovery.value.trim();
      if (looksLikeEmail(email)) {
        warningTitle.textContent = "A reset link can be emailed to your recovery email.";
        warningBody.textContent = "There is no separate confirmation email when the account is created. If you forget the password, Forgot password sends the link to that inbox.";
        ackText.textContent = "I understand a reset link can be emailed only to this recovery email.";
      } else {
        warningTitle.textContent = "No recovery email is set.";
        warningBody.textContent = "A reset link can be emailed only to a recovery email. Without one, a forgotten password cannot be recovered by email.";
        ackText.textContent = "I understand no recovery email is set, so a forgotten password cannot be recovered by email.";
      }
    }
    login.addEventListener("input", syncRecoveryPrefill);
    recovery.addEventListener("input", () => { recoveryTouched = true; refreshCreateWarning(); });
    refreshCreateWarning();
    const form = el("form", { class: "stack" });
    form.append(
      labeled("Email or username", login),
      labeled("Password", password),
    );
    if (accountMode === "create") {
      form.append(
        labeled("Confirm password", confirm),
        labeled("Recovery email", recovery),
        el("div", { class: "callout warn" }, [warningTitle, warningBody]),
        el("label", { class: "check" }, [ack, ackText]),
      );
    }
    form.append(el("button", { type: "submit", class: "button" }, [accountMode === "create" ? "Create account" : "Sign in"]));
    if (accountMode === "signin") {
      form.append(el("button", {
        type: "button",
        class: "button secondary",
        onClick: () => { accountMode = "forgot"; renderMain(); },
      }, ["Forgot password?"]));
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitAuth({
        mode: accountMode,
        email: login.value.trim(),
        password: password.value,
        confirm: confirm.value,
        recoveryEmail: recovery.value.trim(),
        ack: ack.checked,
      });
    });
    blocks.push(el("div", { class: "segment" }, [signinTab, createTab]), form);
    return wrap(blocks);
  }

  function renderForgot() {
    const login = input("text", "", { autocomplete: "username", maxlength: "200" });
    const form = el("form", { class: "stack" });
    form.append(
      el("h2", {}, ["Forgot password"]),
      el("p", { class: "lede" }, ["Enter the username or email on the account. If it has a recovery email, a reset link is sent there."]),
      labeled("Email or username", login),
      el("button", { type: "submit", class: "button" }, ["Send reset link"]),
      el("button", {
        type: "button",
        class: "button secondary",
        onClick: () => { accountMode = "signin"; renderMain(); },
      }, ["Back to sign in"]),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitResetRequest(login.value.trim());
    });
    return form;
  }

  function renderReset(route) {
    const token = String(route.token || "");
    const usable = /^[A-Fa-f0-9]{64}$/.test(token);
    const password = input("password", "", { autocomplete: "new-password", maxlength: "200" });
    const confirm = input("password", "", { autocomplete: "new-password", maxlength: "200" });
    const form = el("form", { class: "stack" });
    const blocks = [
      el("h1", {}, ["Choose a new password"]),
      flashNode(),
      el("p", { class: "lede" }, ["This signs you in on this device and signs every other device out. Your maintenance log stays."]),
    ];
    if (!usable) {
      blocks.push(
        el("div", { class: "flash error", role: "alert" }, ["This reset link has expired or was already used."]),
        el("button", { type: "button", class: "button secondary", onClick: () => openForgot() }, ["Send a new link"]),
      );
      return wrap(blocks);
    }
    form.append(
      labeled("New password", password),
      labeled("Confirm password", confirm),
      el("button", { type: "submit", class: "button" }, ["Update password"]),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitNewPassword(token, password.value, confirm.value);
    });
    blocks.push(form);
    return wrap(blocks);
  }

  function openForgot() {
    accountMode = "forgot";
    state.flash = null;
    history.replaceState(null, "", `${location.pathname}${location.search}#/account`);
    renderMain();
  }

  function showAccountError(text) {
    state.flash = { kind: "error", text };
    let box = document.querySelector("#account-result");
    if (!box) {
      box = document.createElement("div");
      box.id = "account-result";
      box.dataset.testid = "account-result";
      box.setAttribute("role", "alert");
      document.querySelector("main h1")?.after(box);
    }
    box.className = "flash error";
    box.textContent = text;
    box.scrollIntoView({ block: "nearest" });
  }

  async function submitAuth(entry) {
    if (!entry.email) return showAccountError("Enter an email or username.");
    if (entry.password.length < 8) return showAccountError("Use at least 8 characters.");
    if (entry.mode === "create") {
      if (entry.recoveryEmail && !looksLikeEmail(entry.recoveryEmail)) return showAccountError("Enter a valid recovery email, or leave it blank.");
      if (!entry.ack) return showAccountError("Check the box before creating the account.");
      if (entry.password !== entry.confirm) return showAccountError("Those passwords do not match.");
    }
    setFlash("pending", entry.mode === "create" ? "Creating account…" : "Signing in…");
    const result = entry.mode === "create"
      ? await registerAccount(syncUrl, entry.email, entry.password, entry.recoveryEmail)
      : await loginAccount(syncUrl, entry.email, entry.password);
    if (!result.ok) return setFlash("error", result.error);
    setSession(state, { token: result.token, email: result.email, recoveryEmail: result.recoveryEmail ?? null });
    const success = entry.mode === "create"
      ? result.recoveryEmail
        ? `Account created. You're signed in as ${result.email}. A reset link can be emailed to ${result.recoveryEmail}.`
        : `Account created. You're signed in as ${result.email}. No recovery email is set, so a forgotten password cannot be recovered by email.`
      : `Signed in as ${result.email}. This device's log was merged with the server. Nothing was deleted just because one side was empty.`;
    setFlash("success", success);
    const synced = await sync.syncNow("auth");
    if (!synced.ok && state.session) {
      setFlash("success", `${success} Sync hasn't finished: ${synced.error}`);
    }
  }

  async function submitResetRequest(email) {
    if (!email) return showAccountError("Enter the email or username on the account.");
    setFlash("pending", "Sending a reset link…");
    const result = await requestPasswordReset(syncUrl, email);
    if (!result.ok) return setFlash("error", result.error);
    setFlash("success", "If that account has a recovery email, a reset link is on its way.");
  }

  async function submitNewPassword(token, password, confirm) {
    if (password.length < 8) return showAccountError("Use at least 8 characters.");
    if (password !== confirm) return showAccountError("Those passwords do not match.");
    setFlash("pending", "Updating password…");
    const result = await confirmPasswordReset(syncUrl, token, password);
    if (!result.ok) {
      state.flash = { kind: "error", text: result.error };
      renderResetError(result.error);
      return;
    }
    history.replaceState(null, "", `${location.pathname}${location.search}#/account`);
    setSession(state, { token: result.token, email: result.email, recoveryEmail: result.recoveryEmail ?? null });
    const success = "Password updated. You're signed in on this device. Other devices need to sign in again. Your maintenance log was not changed.";
    setFlash("success", success);
    const synced = await sync.syncNow("auth");
    if (!synced.ok && state.session) {
      setFlash("success", `${success} Sync hasn't finished: ${synced.error}`);
    }
  }

  function renderResetError(message) {
    const main = document.querySelector("#main");
    if (!main) return;
    main.replaceChildren(wrap([
      el("h1", {}, ["Choose a new password"]),
      el("div", { id: "account-result", class: "flash error", role: "alert", "data-testid": "account-result" }, [message]),
      el("p", { class: "lede" }, ["Ask for another link. The old one cannot be used again."]),
      el("button", { type: "button", class: "button", onClick: () => openForgot() }, ["Send a new link"]),
    ]));
    main.scrollTop = 0;
  }

  let recoveryLookup = null;

  function ensureRecoveryEmail() {
    if (!state.session || "recoveryEmail" in state.session || recoveryLookup) return;
    const token = state.session.token;
    recoveryLookup = fetchAccount(syncUrl, token).then((result) => {
      recoveryLookup = null;
      if (!state.session || state.session.token !== token) return;
      if (!result.ok) return;
      setSession(state, { token, email: result.email || state.session.email, recoveryEmail: result.recoveryEmail });
      if (parseRoute(location.hash).name === "account") renderMain();
    });
  }

  async function saveRecoveryEmail(recoveryEmail, password) {
    const token = state.session?.token;
    if (!token) return;
    setFlash("pending", "Saving recovery email…");
    const result = await updateRecoveryEmail(syncUrl, token, password, recoveryEmail);
    if (!result.ok) return setFlash("error", result.error);
    if (state.session) setSession(state, { ...state.session, recoveryEmail: result.recoveryEmail });
    setFlash("success", `Recovery email saved. A reset link can be emailed to ${result.recoveryEmail}.`);
  }

  function renderMore() {
    const file = el("input", { type: "file", accept: "application/json,.json" });
    file.hidden = true;
    file.addEventListener("change", () => {
      const picked = file.files?.[0];
      file.value = "";
      if (picked) void importFile(picked);
    });
    return wrap([
      el("h1", {}, ["More"]),
      flashNode(),
      el("a", { class: "menu-link", href: "#/upcoming" }, ["All upcoming"]),
      el("a", { class: "menu-link", href: "#/jobs" }, ["All jobs"]),
      el("a", { class: "menu-link", href: "#/assets" }, ["Assets"]),
      el("a", { class: "menu-link", href: "#/contractors" }, ["Contractors"]),
      el("a", { class: "menu-link", href: "#/account" }, ["Account and sync"]),
      el("button", { type: "button", class: "button secondary", onClick: () => download(`upkeep-backup-${todayISO()}.json`, JSON.stringify(buildBackup(state.records), null, 2), "application/json") }, ["Export JSON backup"]),
      el("button", { type: "button", class: "button secondary", onClick: () => download(`upkeep-jobs-${todayISO()}.csv`, toCsv(state.records), "text/csv") }, ["Export CSV"]),
      el("button", { type: "button", class: "button secondary", onClick: () => file.click() }, ["Import JSON backup"]),
      file,
      el("p", { class: "fine" }, ["Import merges by record. It asks before combining, and it does not replace this device outright."]),
    ]);
  }

  async function importFile(file) {
    let records;
    try {
      records = parseBackup(await file.text());
    } catch (error) {
      setFlash("error", error.message);
      return;
    }
    const assets = records.filter((record) => record.type === "asset" && !record.deleted).length;
    const jobs = records.filter((record) => record.type === "job" && !record.deleted).length;
    const ok = await confirmDialog(
      "Merge this backup?",
      `This file has ${assets} assets and ${jobs} jobs, including car details. Matching records keep the newer copy, and a deletion wins over an older copy. Records that exist only on this device stay.`,
      "Merge backup",
      false,
    );
    if (!ok) return;
    importRecords(state, records);
    sync.schedule();
    setFlash("success", "Backup merged into this device.");
  }

  function assetChoices() {
    return liveRecords(state.records, "asset").sort((left, right) => {
      if (left.payload.assetType === "home" && right.payload.assetType !== "home") return -1;
      if (right.payload.assetType === "home" && left.payload.assetType !== "home") return 1;
      return String(left.payload.name).localeCompare(String(right.payload.name));
    });
  }

  function flashNode() {
    if (!state.flash?.text) return null;
    return el("div", { id: "account-result", class: `flash ${state.flash.kind}`, role: "alert", "data-testid": "account-result" }, [state.flash.text]);
  }

  return { start, renderBanner, renderData };
}

function shell() {
  return el("div", { class: "app" }, [
    el("header", { class: "top" }, [
      el("div", { class: "brand" }, [
        el("img", { src: "./icons/icon-192.png", alt: "", width: "40", height: "40" }),
        el("div", {}, [el("p", { class: "wordmark" }, ["Upkeep"]), el("p", { class: "tag" }, ["Home and car care"])]),
      ]),
      el("div", { id: "sync-banner", class: "banner warn", role: "status", "data-testid": "sync-banner" }),
    ]),
    el("main", { id: "main", class: "main", tabindex: "-1" }),
    el("nav", { id: "nav", class: "nav", "aria-label": "Primary" }),
  ]);
}

function wrap(children) {
  return el("div", { class: "wrap" }, children.filter(Boolean));
}

function detailList(rows) {
  const list = el("dl", { class: "details" });
  for (const [label, value, testid] of rows) {
    const text = value == null || value === "" ? "Not set" : String(value);
    list.append(el("dt", {}, [label]), el("dd", testid ? { "data-testid": testid } : {}, [text]));
  }
  return list;
}

function figure(label, value, testid) {
  return el("div", { class: "figure" }, [
    el("p", { class: "figure-label" }, [label]),
    el("p", { class: "figure-value", "data-testid": testid }, [value]),
  ]);
}

function breakdown(title, rows, empty) {
  const body = rows.length
    ? [
      el("div", { class: "rowline head" }, [
        el("span", {}, [""]),
        el("span", { class: "meta" }, ["Month"]),
        el("span", { class: "meta" }, ["Year"]),
      ]),
      ...rows.map((row) => el("div", { class: "rowline" }, [
        el("span", {}, [row.name]),
        el("strong", {}, [formatMoney(row.monthCents)]),
        el("strong", {}, [formatMoney(row.yearCents)]),
      ])),
    ]
    : [el("p", { class: "lede" }, [empty])];
  return el("section", { class: "card" }, [el("h2", {}, [title]), ...body]);
}

function labeled(text, control) {
  if (!control.id) control.id = `f-${Math.random().toString(16).slice(2)}`;
  return el("div", { class: "field" }, [el("label", { for: control.id }, [text]), control]);
}

function input(type, value, attrs = {}) {
  const node = el("input", { type, ...attrs });
  node.value = value == null ? "" : String(value);
  return node;
}

function selectFrom(pairs, selected) {
  const node = el("select");
  node.replaceChildren(...pairs.map(([value, label]) => new Option(label, value)));
  node.value = selected || "";
  return node;
}

function download(filename, contents, type) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function confirmDialog(title, body, confirmLabel, danger = true) {
  return new Promise((resolve) => {
    const dialog = el("dialog", { class: "modal" });
    const cancel = el("button", { type: "button", class: "button secondary" }, ["Cancel"]);
    const ok = el("button", { type: "button", class: danger ? "button danger" : "button" }, [confirmLabel]);
    dialog.append(
      el("h2", {}, [title]),
      el("p", {}, [body]),
      el("div", { class: "dialog-actions" }, [cancel, ok]),
    );
    const finish = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener("click", () => finish(false));
    ok.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function parseRoute(hash) {
  const reset = /^#reset=(.*)$/.exec(String(hash || ""));
  if (reset) return { name: "reset", token: decodeURIComponent(reset[1]) };
  const [head, id, extra] = String(hash || "").replace(/^#\/?/, "").split("/").filter(Boolean);
  if (!head || head === "summary") return { name: "summary" };
  if (head === "house") return { name: "house", id: id || null };
  if (head === "car") return { name: "car", id: id || null };
  if (head === "upcoming") return { name: "upcoming" };
  if (head === "jobs" && !id) return { name: "jobs" };
  if (head === "jobs" && id === "new") return { name: "job", id: null, assetId: extra || null };
  if (head === "jobs" && id) return { name: "job", id, markDone: extra === "done" };
  if (head === "assets" && !id) return { name: "assets" };
  if (head === "assets" && id === "new") return { name: "asset", id: null, preset: extra === "home" || extra === "car" ? extra : null };
  if (head === "assets" && id) return { name: "asset", id };
  if (head === "contractors" && !id) return { name: "contractors" };
  if (head === "contractors" && id === "new") return { name: "contractor", id: null };
  if (head === "contractors" && id) return { name: "contractor", id };
  if (head === "account") return { name: "account" };
  if (head === "more") return { name: "more" };
  return { name: "summary" };
}

function activeNav(route) {
  if (route.name === "summary" || route.name === "house" || route.name === "car") return route.name;
  return "more";
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "for") node.htmlFor = String(value);
    else if (key === "value") node.value = String(value);
    else if (key === "checked" || key === "selected") node[key] = true;
    else if (key === "hidden") node.hidden = true;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
