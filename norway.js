const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CAL_COLUMNS = ["Date", "Event", "Field or licence", "Operator", "Companies", "Type", "Flags", "Source"];

const state = {
  mode: "calendar",
  company: "all",
  type: "all",
  showBackground: false,
  when: "all",
};

let companies = [];
let events = [];
let windowRange = { today: "", start: "", tightEnd: "", end: "" };

function el(tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = String(value);
      else if (key === "hidden") node.hidden = true;
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, String(value));
    }
  }
  for (const child of [].concat(children || [])) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function showText(value) {
  if (value == null) return "—";
  const text = String(value).replaceAll("&", "and").trim();
  return text || "—";
}

function asNumber(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const number = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(number) ? number : null;
}

function formatNum(value) {
  const number = asNumber(value);
  if (number == null) return "—";
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(number);
}

function formatDate(iso) {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return showText(iso);
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return showText(iso);
  return `${Number(match[3])} ${month} ${match[1]}`;
}

function monthLabel(iso) {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})/);
  if (!match) return "Undated";
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : "Undated";
}

function confidenceLabel(value) {
  if (value === "exact") return "exact";
  if (value === "month") return "month estimate";
  if (value === "quarter") return "quarter estimate";
  if (value === "estimated") return "estimate";
  return showText(value);
}

function displayType(value) {
  const text = showText(value);
  if (text === "—") return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function safeUrl(url) {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return parsed.href;
  } catch {
    return "";
  }
}

function isoFromLocal(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function shiftMonths(iso, months) {
  const [year, month, day] = iso.split("-").map(Number);
  const cursor = new Date(year, month - 1 + months, 1);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  cursor.setDate(Math.min(day, last));
  return isoFromLocal(cursor);
}

function setWindow(today) {
  windowRange = {
    today,
    start: shiftMonths(today, -12),
    tightEnd: shiftMonths(today, 6),
    end: shiftMonths(today, 12),
  };
}

function inWindow(event) {
  return event.date >= windowRange.start && event.date <= windowRange.end;
}

function isBackground(event) {
  return event.material !== "Y" && event.setback !== "Y" && event.upcoming !== "Y";
}

function isTight(event) {
  return event.upcoming === "Y" && event.date <= windowRange.tightEnd;
}

function eventCount(name) {
  return events.filter((event) => event.companies.includes(name) && inWindow(event) && (state.showBackground || !isBackground(event))).length;
}

function passesFilters(event) {
  if (!inWindow(event)) return false;
  if (state.company !== "all" && !event.companies.includes(state.company)) return false;
  if (state.type !== "all" && event.type !== state.type) return false;
  if (state.when === "upcoming" && event.upcoming !== "Y") return false;
  if (state.when === "past" && event.upcoming === "Y") return false;
  return true;
}

function matches(event) {
  return passesFilters(event) && (state.showBackground || !isBackground(event));
}

function byDate(a, b) {
  return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
}

function visibleEvents() {
  return events.filter(matches).sort(byDate);
}

function badge(text, kind) {
  return el("span", { class: kind ? `no-badge ${kind}` : "no-badge", text });
}

function flags(event) {
  return el("span", {}, [
    event.material === "Y" ? badge("Material") : null,
    event.setback === "Y" ? badge("Setback", "setback") : null,
    event.upcoming === "Y" ? badge("Upcoming", "upcoming") : null,
    event.net === "tight" ? badge("Tight", "tight") : null,
    event.net === "loose" ? badge("Loose", "loose") : null,
  ]);
}

function chips(event) {
  return el("span", { class: "no-chips" }, event.companies.map((name) => el("button", {
    type: "button",
    class: "no-chip",
    "aria-pressed": state.company === name ? "true" : "false",
    onClick: () => focusCompany(name),
    text: showText(name),
  })));
}

function sourceLink(event) {
  const href = safeUrl(event.source_url);
  if (!href) return "—";
  return el("a", { href, target: "_blank", rel: "noopener noreferrer", text: "Source" });
}

function dateCell(event) {
  return el("span", {}, [
    el("span", { class: "cap-name", text: formatDate(event.date) }),
    el("span", { class: "no-conf", text: confidenceLabel(event.date_confidence) }),
  ]);
}

function groupMonths(list, direction) {
  const buckets = new Map();
  list.forEach((event) => {
    const key = event.date.slice(0, 7);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(event);
  });
  const keys = [...buckets.keys()].sort();
  if (direction === "desc") keys.reverse();
  return keys.map((key) => ({ label: monthLabel(`${key}-01`), events: buckets.get(key) }));
}

function sectionLabel(text) {
  const row = el("tr", { class: "group" });
  row.append(el("th", { colspan: String(CAL_COLUMNS.length), scope: "rowgroup", text }));
  return row;
}

function monthLabelRow(text) {
  const row = el("tr", { class: "group" });
  const cell = el("th", { colspan: String(CAL_COLUMNS.length), scope: "rowgroup", text });
  row.append(cell);
  return row;
}

function eventClass(event) {
  const classes = [];
  if (event.upcoming === "Y") classes.push("is-upcoming");
  if (isTight(event)) classes.push("is-tight");
  return classes.join(" ");
}

function eventRow(event) {
  const row = el("tr", { class: eventClass(event) });
  row.append(
    el("td", {}, [dateCell(event)]),
    el("td", { text: showText(event.title) }),
    el("td", { text: showText(event.licence_field) }),
    el("td", { text: showText(event.operator) }),
    el("td", {}, [chips(event)]),
    el("td", { text: displayType(event.type) }),
    el("td", {}, [flags(event)]),
    el("td", {}, [sourceLink(event)]),
  );
  return row;
}

function appendMonths(body, list, direction) {
  groupMonths(list, direction).forEach((group) => {
    body.append(monthLabelRow(group.label));
    group.events.forEach((event) => body.append(eventRow(event)));
  });
}

function bandLabelRow(text) {
  const row = el("tr", { class: "group band" });
  row.append(el("th", { colspan: String(CAL_COLUMNS.length), scope: "rowgroup", text }));
  return row;
}

function appendUpcoming(table, list) {
  if (!list.length) return;
  const tight = list.filter((event) => event.date <= windowRange.tightEnd);
  const loose = list.filter((event) => event.date > windowRange.tightEnd);
  const body = el("tbody");
  body.append(sectionLabel("Upcoming"));
  if (tight.length) {
    body.append(bandLabelRow("Tight 6m"));
    appendMonths(body, tight, "asc");
  }
  if (loose.length) {
    body.append(bandLabelRow("Loose 12m"));
    appendMonths(body, loose, "asc");
  }
  table.append(body);
}

function appendSection(table, title, list, direction) {
  if (!list.length) return;
  const body = el("tbody");
  body.append(sectionLabel(title));
  appendMonths(body, list, direction);
  table.append(body);
}

function renderCalendarTable(rows) {
  const table = el("table", { class: "register norway" });
  const head = el("thead");
  const headRow = el("tr");
  CAL_COLUMNS.forEach((label) => headRow.append(el("th", { scope: "col", text: label })));
  head.append(headRow);
  table.append(head);
  const upcoming = rows.filter((event) => event.upcoming === "Y");
  const past = rows.filter((event) => event.upcoming !== "Y");
  appendUpcoming(table, upcoming);
  appendSection(table, "Past", past, "desc");
  const tableRoot = document.getElementById("norway-cal-table");
  if (rows.length) tableRoot.replaceChildren(table);
  else tableRoot.replaceChildren();
}

function eventCard(event) {
  return el("article", { class: eventClass(event) ? `card ${eventClass(event)}` : "card" }, [
    el("span", { class: "card-top" }, [
      dateCell(event),
      flags(event),
    ]),
    el("h3", { class: "card-asset", text: showText(event.title) }),
    el("p", { class: "card-what", text: `${showText(event.licence_field)} · ${showText(event.operator)}` }),
    el("p", { class: "card-meta", text: displayType(event.type) }),
    chips(event),
    el("p", {}, [sourceLink(event)]),
  ]);
}

function renderCalendarCards(rows) {
  const root = document.getElementById("norway-cal-cards");
  const blocks = [];
  const addMonths = (list, direction) => {
    groupMonths(list, direction).forEach((group) => {
      blocks.push(el("h3", { text: group.label }));
      group.events.forEach((event) => blocks.push(eventCard(event)));
    });
  };
  const upcoming = rows.filter((event) => event.upcoming === "Y");
  const past = rows.filter((event) => event.upcoming !== "Y");
  if (upcoming.length) {
    const tight = upcoming.filter((event) => event.date <= windowRange.tightEnd);
    const loose = upcoming.filter((event) => event.date > windowRange.tightEnd);
    blocks.push(el("h3", { class: "eyebrow", text: "Upcoming" }));
    if (tight.length) {
      blocks.push(el("h3", { class: "band-label", text: "Tight 6m" }));
      addMonths(tight, "asc");
    }
    if (loose.length) {
      blocks.push(el("h3", { class: "band-label", text: "Loose 12m" }));
      addMonths(loose, "asc");
    }
  }
  if (past.length) {
    blocks.push(el("h3", { class: "eyebrow", text: "Past" }));
    addMonths(past, "desc");
  }
  root.replaceChildren(...blocks);
}

function licenceText(company) {
  const held = formatNum(company.licences_active);
  const operated = formatNum(company.licences_operated);
  if (held === "—" && operated === "—") return "—";
  return `${held} held, ${operated} operated`;
}

function companyRow(company) {
  const open = () => focusCompany(company.short_name);
  const row = el("tr", {
    class: "cap-main",
    tabindex: "0",
    role: "button",
    "aria-label": `Show events for ${showText(company.short_name)}`,
    onClick: open,
    onKeydown: (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    },
  });
  row.append(
    el("td", {}, [
      el("span", { class: "cap-name", text: showText(company.name) }),
      el("span", { class: "cap-code", text: showText(company.short_name) }),
    ]),
    el("td", { text: showText(company.ownership_type) }),
    el("td", { text: showText(company.listing_ticker) }),
    el("td", { text: licenceText(company) }),
    el("td", { text: formatNum(company.ncs_net_prod_2025_kboed) }),
    el("td", { text: showText(company.note) }),
    el("td", { text: String(eventCount(company.short_name)) }),
  );
  return row;
}

function renderCompanyTable() {
  const table = el("table", { class: "register norway" });
  const head = el("thead");
  const headRow = el("tr");
  ["Company", "Ownership", "Listing", "Licences", "2025 output, kboe/d", "Note", "Events"].forEach((label) => {
    headRow.append(el("th", { scope: "col", text: label }));
  });
  head.append(headRow);
  table.append(head);
  const body = el("tbody");
  companies.forEach((company) => body.append(companyRow(company)));
  table.append(body);
  document.getElementById("norway-co-table").replaceChildren(table);
}

function renderCompanyCards() {
  const root = document.getElementById("norway-co-cards");
  root.replaceChildren(...companies.map((company) => el("article", { class: "card" }, [
    el("button", {
      type: "button",
      class: "no-card-btn",
      onClick: () => focusCompany(company.short_name),
    }, [
      el("span", { class: "card-top" }, [
        el("span", { class: "cap-name", text: showText(company.name) }),
        el("span", { class: "cap-code", text: showText(company.short_name) }),
      ]),
      el("span", { class: "card-meta", text: showText(company.ownership_type) }),
      el("span", { class: "card-what", text: showText(company.listing_ticker) }),
      el("dl", { class: "cap-facts" }, [
        el("div", {}, [el("dt", { text: "Licences" }), el("dd", { text: licenceText(company) })]),
        el("div", {}, [el("dt", { text: "2025 output, kboe/d" }), el("dd", { text: formatNum(company.ncs_net_prod_2025_kboed) })]),
        el("div", {}, [el("dt", { text: "Events" }), el("dd", { text: String(eventCount(company.short_name)) })]),
      ]),
      el("p", { class: "card-what", text: showText(company.note) }),
    ]),
  ])));
}

function render() {
  const rows = visibleEvents();
  const shown = rows.length;
  const total = events.filter(passesFilters).length;
  document.getElementById("norway-showing").textContent = shown === total
    ? `Showing ${total} events`
    : `Showing ${shown} of ${total} events`;
  document.getElementById("norway-co-showing").textContent = `${companies.length} companies`;
  const empty = document.getElementById("norway-empty");
  const calendar = document.getElementById("norway-cal");
  const companyPane = document.getElementById("norway-cos");
  calendar.hidden = state.mode !== "calendar";
  companyPane.hidden = state.mode !== "companies";
  document.querySelectorAll("#norway-mode [data-norway-mode]").forEach((button) => {
    button.setAttribute("aria-selected", button.dataset.norwayMode === state.mode ? "true" : "false");
  });
  if (!shown) {
    document.getElementById("norway-cal-table").replaceChildren();
    document.getElementById("norway-cal-cards").replaceChildren();
    empty.hidden = false;
    empty.replaceChildren(
      el("strong", { text: "No events match" }),
      el("p", { text: "Turn on Show background, or set the other filters back to All." }),
    );
  } else {
    empty.hidden = true;
    renderCalendarTable(rows);
    renderCalendarCards(rows);
  }
  renderCompanyTable();
  renderCompanyCards();
  const background = document.getElementById("norway-background");
  if (background) background.setAttribute("aria-pressed", state.showBackground ? "true" : "false");
}

function focusCompany(name) {
  state.company = name;
  state.mode = "calendar";
  const select = document.querySelector('select[data-no-filter="company"]');
  if (select) {
    select.value = name;
    select.closest(".field").classList.toggle("active", name !== "all");
  }
  render();
  document.getElementById("norway").scrollIntoView({ block: "start" });
}

function mountFilters() {
  const types = [...new Set(events.map((event) => event.type).filter(Boolean))].sort((a, b) => displayType(a).localeCompare(displayType(b), "en"));
  const names = companies.map((company) => company.short_name);
  const specs = [
    ["company", "Company", [["all", "All"], ...names.map((name) => [name, name])]],
    ["type", "Event type", [["all", "All"], ...types.map((type) => [type, displayType(type)])]],
    ["when", "Timing", [["all", "All"], ["upcoming", "Upcoming"], ["past", "Past"]]],
  ];
  const root = document.getElementById("norway-filters");
  root.replaceChildren(...specs.map(([key, label, choices]) => {
    const select = el("select", { "data-no-filter": key });
    choices.forEach(([value, text]) => select.append(el("option", { value, text })));
    select.value = state[key];
    select.addEventListener("change", () => {
      state[key] = select.value;
      select.closest(".field").classList.toggle("active", select.value !== "all");
      render();
    });
    return el("label", { class: "field" }, [label, select]);
  }));
}

function bindBackground() {
  const button = document.getElementById("norway-background");
  if (!button) return;
  button.addEventListener("click", () => {
    state.showBackground = !state.showBackground;
    render();
  });
}

function bindMode() {
  document.getElementById("norway-mode").addEventListener("click", (event) => {
    const button = event.target.closest("[data-norway-mode]");
    if (!button) return;
    state.mode = button.dataset.norwayMode === "companies" ? "companies" : "calendar";
    render();
  });
}

function showError() {
  const loading = document.getElementById("norway-loading");
  if (loading) loading.hidden = true;
  const empty = document.getElementById("norway-empty");
  empty.hidden = false;
  empty.replaceChildren(el("p", { class: "error", text: "The Norway list could not be loaded. Refresh the page to try again." }));
}

async function load() {
  const [companyResponse, eventResponse] = await Promise.all([
    fetch("data/norway_companies.json", { cache: "no-cache" }),
    fetch("data/norway_events.json", { cache: "no-cache" }),
  ]);
  if (!companyResponse.ok || !eventResponse.ok) throw new Error("norway");
  const companyData = await companyResponse.json();
  const eventData = await eventResponse.json();
  if (!Array.isArray(companyData) || !Array.isArray(eventData)) throw new Error("norway");
  companies = companyData.map((row) => ({
    ...row,
    short_name: row.short_name || row.name,
  })).sort((a, b) => showText(a.short_name).localeCompare(showText(b.short_name), "en"));
  events = eventData.map((row) => ({
    ...row,
    companies: Array.isArray(row.companies) ? row.companies : [],
    upcoming: row.upcoming === "Y" ? "Y" : "N",
    net: row.net === "tight" || row.net === "loose" ? row.net : "",
  }));
  setWindow(isoFromLocal(new Date()));
  const sub = document.getElementById("norway-sub");
  if (sub) sub.textContent = `Norwegian shelf oil and gas. ${formatDate(windowRange.start)} to ${formatDate(windowRange.end)}.`;
  document.getElementById("norway-loading").hidden = true;
  mountFilters();
  bindBackground();
  bindMode();
  render();
  document.body.dataset.norway = String(events.length);
  document.body.dataset.norwayCompanies = String(companies.length);
  document.body.dataset.norwayWindow = `${windowRange.start}:${windowRange.tightEnd}:${windowRange.end}`;
}

function boot() {
  load().catch(showError);
}

if (typeof document !== "undefined") boot();
