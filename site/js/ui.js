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
import { loginAccount, logoutAccount, registerAccount } from "./sync.js";

const FORM_ROUTES = new Set(["job", "asset", "contractor"]);
const jobsFilter = { query: "", assetId: "", status: "", categoryId: "" };
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
      banner.className = "banner warn";
      banner.append(
        el("p", {}, ["Not signed in. This log stays on this device only."]),
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
    const current = navKey(parseRoute(location.hash));
    const items = [
      ["#/summary", "summary", "Summary", "summary"],
      ["#/upcoming", "upcoming", "Upcoming", "upcoming"],
      ["#/jobs", "jobs", "Jobs", "jobs"],
      ["#/more", "more", "More", "more"],
    ];
    nav.replaceChildren(
      ...items.map(([href, name, label, iconName]) =>
        el("a", { class: "nav-link", href, "aria-current": current === name ? "page" : "false" }, [icon(iconName), label]),
      ),
    );
  }

  function renderMain() {
    const route = parseRoute(location.hash);
    main.dataset.screen = route.name;
    const view = {
      summary: () => renderSummary(),
      upcoming: () => renderUpcoming(),
      jobs: () => renderJobs(),
      job: () => renderJob(route),
      assets: () => renderAssets(),
      asset: () => renderAsset(route),
      contractors: () => renderContractors(),
      contractor: () => renderContractor(route),
      account: () => renderAccount(),
      more: () => renderMore(),
    }[route.name];
    main.replaceChildren(view ? view() : renderSummary());
    // preventScroll: focusing <main> otherwise scrolls the page heading under the sticky header on phones.
    main.focus?.({ preventScroll: true });
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
      el("h1", {}, ["Upcoming"]),
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
      el("h1", {}, ["Jobs"]),
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
    }

    function selectedType() {
      return state.records[assetSelect.value]?.payload?.assetType || "home";
    }

    function fillAssets() {
      assetSelect.replaceChildren(...assets.map((asset) => new Option(asset.payload.name, asset.id)));
      const preferred = payload.assetId && assets.some((asset) => asset.id === payload.assetId) ? payload.assetId : assets[0].id;
      assetSelect.value = preferred;
    }

    function fillCategories(preferred) {
      const options = categoriesFor(state.records, selectedType());
      categorySelect.replaceChildren(
        ...options.map((category) => new Option(category.name, category.id)),
        new Option("Add a category…", "__new"),
      );
      categorySelect.value = options.some((category) => category.id === preferred) ? preferred : options[0]?.id || "__new";
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
      go("#/jobs");
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
    go("#/jobs");
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
    const payload = existing?.payload || { assetType: "car", name: "" };
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
        return;
      }
      saveRecord(state, record);
      sync.schedule();
      go("#/assets");
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
          go("#/assets");
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
    if (state.session) {
      blocks.push(
        el("div", { class: "panel stack" }, [
          el("p", { class: "lede" }, [`Signed in as ${state.session.email}.`]),
          el("p", { class: "meta" }, [state.syncError || formatSynced(state.lastSyncedAt)]),
          el("p", { class: "fine" }, ["There is no password reset. Signing out keeps this log on the device."]),
        ]),
        el("button", { type: "button", class: "button", onClick: () => void sync.syncNow("manual") }, [icon("sync"), "Sync now"]),
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
    const ack = el("input", { type: "checkbox", id: "ack" });
    const signinTab = el("button", { type: "button", "aria-pressed": accountMode === "signin" ? "true" : "false" }, ["I have an account"]);
    const createTab = el("button", { type: "button", "aria-pressed": accountMode === "create" ? "true" : "false" }, ["New account"]);
    signinTab.addEventListener("click", () => { accountMode = "signin"; renderMain(); });
    createTab.addEventListener("click", () => { accountMode = "create"; renderMain(); });
    const form = el("form", { class: "stack" });
    form.append(
      labeled("Email or username", login),
      labeled("Password", password),
    );
    if (accountMode === "create") {
      form.append(
        labeled("Confirm password", confirm),
        el("div", { class: "callout warn" }, [
          el("strong", {}, ["There is no password reset and no email confirmation."]),
          el("p", { class: "lede" }, ["If you forget this password, the account cannot be recovered. Store it somewhere safe before you continue."]),
        ]),
        el("label", { class: "check" }, [ack, "I understand I must remember this password. It cannot be recovered."]),
      );
    }
    form.append(el("button", { type: "submit", class: "button" }, [accountMode === "create" ? "Create account" : "Sign in"]));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitAuth({
        mode: accountMode,
        email: login.value.trim(),
        password: password.value,
        confirm: confirm.value,
        ack: ack.checked,
      });
    });
    blocks.push(el("div", { class: "segment" }, [signinTab, createTab]), form);
    return wrap(blocks);
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
  }

  async function submitAuth(entry) {
    if (!entry.email) return showAccountError("Enter an email or username.");
    if (entry.password.length < 8) return showAccountError("Use at least 8 characters.");
    if (entry.mode === "create") {
      if (!entry.ack) return showAccountError("Check the box to confirm you can remember this password. It cannot be reset.");
      if (entry.password !== entry.confirm) return showAccountError("Those passwords do not match.");
    }
    setFlash("pending", entry.mode === "create" ? "Creating account…" : "Signing in…");
    const result = entry.mode === "create"
      ? await registerAccount(syncUrl, entry.email, entry.password)
      : await loginAccount(syncUrl, entry.email, entry.password);
    if (!result.ok) return setFlash("error", result.error);
    setSession(state, { token: result.token, email: result.email });
    const success = entry.mode === "create"
      ? `Account created. You're signed in as ${result.email}. There is no way to reset this password — keep it somewhere safe.`
      : `Signed in as ${result.email}. This device's log was merged with the server. Nothing was deleted just because one side was empty.`;
    setFlash("success", success);
    const synced = await sync.syncNow("auth");
    if (!synced.ok && state.session) {
      setFlash("success", `${success} Sync hasn't finished: ${synced.error}`);
    }
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

function parseRoute(hash) {
  const [head, id, extra] = String(hash || "").replace(/^#\/?/, "").split("/").filter(Boolean);
  if (!head || head === "summary") return { name: "summary" };
  if (head === "upcoming") return { name: "upcoming" };
  if (head === "jobs" && !id) return { name: "jobs" };
  if (head === "jobs" && id === "new") return { name: "job", id: null };
  if (head === "jobs" && id) return { name: "job", id, markDone: extra === "done" };
  if (head === "assets" && !id) return { name: "assets" };
  if (head === "assets" && id === "new") return { name: "asset", id: null };
  if (head === "assets" && id) return { name: "asset", id };
  if (head === "contractors" && !id) return { name: "contractors" };
  if (head === "contractors" && id === "new") return { name: "contractor", id: null };
  if (head === "contractors" && id) return { name: "contractor", id };
  if (head === "account") return { name: "account" };
  if (head === "more") return { name: "more" };
  return { name: "summary" };
}

function navKey(route) {
  if (route.name === "summary" || route.name === "upcoming" || route.name === "jobs" || route.name === "job") {
    return route.name === "job" ? "jobs" : route.name;
  }
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
