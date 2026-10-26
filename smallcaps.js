const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TAB_KEY = "moonshot-tab";
const STAGE_ORDER = ["Explorer", "Resource defined", "Study stage", "Developer", "Producer"];
const EXCHANGE_ORDER = ["ASX", "AIM", "Main Market"];
const BAND_ORDER = ["Micro (US$5-100M)", "Main (US$100M-5B)"];
const SORTS = [
  ["name", "asc", "Company A to Z"],
  ["name", "desc", "Company Z to A"],
  ["exchange", "asc", "Exchange A to Z"],
  ["exchange", "desc", "Exchange Z to A"],
  ["type", "asc", "Type A to Z"],
  ["type", "desc", "Type Z to A"],
  ["stage", "asc", "Stage, early to late"],
  ["stage", "desc", "Stage, late to early"],
  ["cap", "desc", "Mkt cap, high to low"],
  ["cap", "asc", "Mkt cap, low to high"],
  ["median", "desc", "Median daily, high to low"],
  ["median", "asc", "Median daily, low to high"],
  ["events", "desc", "Material events, high to low"],
  ["events", "asc", "Material events, low to high"],
  ["latest", "desc", "Latest event, newest"],
  ["latest", "asc", "Latest event, oldest"],
  ["setbacks", "desc", "Setbacks, high to low"],
  ["setbacks", "asc", "Setbacks, low to high"],
  ["cash", "asc", "Cash flag A to Z"],
  ["cash", "desc", "Cash flag Z to A"],
];
const COLUMNS = [
  ["name", "Company"],
  ["exchange", "Exchange"],
  ["type", "Type"],
  ["stage", "Stage"],
  ["cap", "Mkt cap US$m"],
  ["median", "Median daily"],
  ["events", "Material events 12m"],
  ["latest", "Latest material event"],
  ["setbacks", "Setbacks"],
  ["cash", "Cash flag"],
];

const capsState = {
  q: "",
  exchange: "all",
  band: "all",
  type: "all",
  stage: "all",
  sortKey: "name",
  sortDir: "asc",
  open: new Set(),
};

let caps = [];

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

function blank(value) {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function asNumber(value) {
  if (blank(value) || typeof value === "boolean") return null;
  const number = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(number) ? number : null;
}

function formatNum(value) {
  const number = asNumber(value);
  if (number == null) return "—";
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(number);
}

function formatMedian(row) {
  if (row.median == null) return "—";
  const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(row.median);
  const currency = showText(row.currency);
  return currency === "—" ? `${number}k` : `${number}k ${currency}`;
}

function dateValue(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, match[3] ? Number(match[3]) : 1);
  return Number.isNaN(time) ? null : time;
}

function formatDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return "—";
  const match = text.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!match) return showText(text);
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return showText(text);
  if (!match[3]) return `${month} ${match[1]}`;
  return `${Number(match[3])} ${month} ${match[1]}`;
}

function stageKey(stage) {
  return String(stage ?? "").replace(/ \(low confidence\)$/, "").trim();
}

function setbackLabel(value) {
  if (blank(value) && value !== false) return "—";
  if (value === true || value === "Y" || value === "yes" || value === "Yes") return "Yes";
  if (value === false || value === "N" || value === "no" || value === "No") return "No";
  return showText(value);
}

function safeUrl(url) {
  try {
    const parsed = new URL(String(url), window.location.origin);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    if (!/^https?:/i.test(String(url))) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

function orderIndex(order, value) {
  const idx = order.indexOf(value);
  return idx === -1 ? order.length + 1 : idx;
}

function normalize(raw, index) {
  const row = raw && typeof raw === "object" ? raw : {};
  const events = Array.isArray(row.events) ? row.events : [];
  return {
    id: `${index}:${showText(row.code)}`,
    code: row.code,
    name: row.name,
    exchange: row.exchange,
    band: row.band,
    type: row.type,
    stage: row.stage,
    description: row.description,
    cap: asNumber(row.mkt_cap_usd_m),
    median: asNumber(row.median_daily_value_k),
    currency: row.currency,
    asOf: row.as_of,
    events12m: asNumber(row.material_events_12m),
    latestDate: row.latest_event_date,
    latestType: row.latest_event_type,
    latestHeadline: row.latest_event_headline,
    setbacks: asNumber(row.setbacks_12m),
    cash: row.cash_flag,
    url: row.url,
    events: events.map((event) => (event && typeof event === "object" ? event : {})),
  };
}

function searchBlob(row) {
  const parts = [
    row.name, row.code, row.exchange, row.band, row.type, row.stage, row.description,
    row.cash, row.currency, row.latestHeadline, row.latestType,
    ...row.events.flatMap((event) => [event.headline, event.type, event.date]),
  ];
  return parts.map((part) => showText(part) === "—" ? "" : showText(part)).join(" ").toLowerCase();
}

function matches(row) {
  if (capsState.exchange !== "all" && showText(row.exchange) !== capsState.exchange) return false;
  if (capsState.band !== "all" && showText(row.band) !== capsState.band) return false;
  if (capsState.type !== "all" && showText(row.type) !== capsState.type) return false;
  if (capsState.stage !== "all" && stageKey(row.stage) !== capsState.stage) return false;
  const query = capsState.q.trim().toLowerCase();
  if (query && !searchBlob(row).includes(query)) return false;
  return true;
}

function compareMissing(aMissing, bMissing) {
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return null;
}

function directed(cmp) {
  if (!cmp) return 0;
  return capsState.sortDir === "desc" ? -cmp : cmp;
}

function compareRows(a, b) {
  const key = capsState.sortKey;
  let cmp = 0;
  if (key === "name") cmp = directed(showText(a.name).localeCompare(showText(b.name), "en", { sensitivity: "base" }));
  else if (key === "exchange") cmp = directed(showText(a.exchange).localeCompare(showText(b.exchange), "en", { sensitivity: "base" }));
  else if (key === "type") cmp = directed(showText(a.type).localeCompare(showText(b.type), "en", { sensitivity: "base" }));
  else if (key === "stage") {
    let stageCmp = orderIndex(STAGE_ORDER, stageKey(a.stage)) - orderIndex(STAGE_ORDER, stageKey(b.stage));
    if (!stageCmp) stageCmp = stageKey(a.stage).localeCompare(stageKey(b.stage), "en", { sensitivity: "base" });
    cmp = directed(stageCmp);
  } else if (key === "cash") {
    const miss = compareMissing(blank(a.cash), blank(b.cash));
    cmp = miss == null ? directed(showText(a.cash).localeCompare(showText(b.cash), "en", { sensitivity: "base" })) : miss;
  } else {
    const value = (row) => {
      if (key === "cap") return row.cap;
      if (key === "median") return row.median;
      if (key === "events") return row.events12m;
      if (key === "setbacks") return row.setbacks;
      return dateValue(row.latestDate);
    };
    const av = value(a);
    const bv = value(b);
    const miss = compareMissing(av == null, bv == null);
    cmp = miss == null ? directed(av - bv) : miss;
  }
  if (cmp) return cmp;
  return showText(a.name).localeCompare(showText(b.name), "en", { sensitivity: "base" })
    || showText(a.code).localeCompare(showText(b.code), "en");
}

function visibleRows() {
  return caps.filter(matches).sort(compareRows);
}

function choiceList(values, order) {
  const unique = [...new Set(values.filter((value) => value && value !== "—"))];
  unique.sort((a, b) => orderIndex(order, a) - orderIndex(order, b) || a.localeCompare(b, "en", { sensitivity: "base" }));
  return unique;
}

function stageNode(stage) {
  const text = showText(stage);
  if (text === "—") return "—";
  const suffix = " (low confidence)";
  if (!text.endsWith(suffix)) return text;
  return el("span", { class: "cap-stage" }, [
    stageKey(text),
    el("span", { class: "mini flag-low", text: "Low confidence" }),
  ]);
}

function latestNode(row) {
  const headline = showText(row.latestHeadline);
  const date = formatDate(row.latestDate);
  if (headline === "—" && date === "—") return "—";
  return el("span", { class: "cap-latest" }, [
    el("span", { text: headline }),
    el("span", { class: "cap-date", text: date }),
  ]);
}

function companyNode(row) {
  return el("span", {}, [
    el("span", { class: "cap-name", text: showText(row.name) }),
    el("span", { class: "cap-code", text: showText(row.code) }),
  ]);
}

function expandBody(row) {
  const events = row.events.length
    ? el("ul", { class: "cap-events" }, row.events.map((event) => el("li", { class: "cap-event" }, [
      el("span", { class: "cap-date", text: formatDate(event.date) }),
      el("span", { text: showText(event.type) }),
      el("span", { text: showText(event.headline) }),
      el("span", { text: `Setback: ${setbackLabel(event.setback)}` }),
    ])))
    : el("p", { class: "cap-desc", text: "No events listed." });
  const href = safeUrl(row.url);
  const link = href
    ? el("a", { href, target: "_blank", rel: "noopener noreferrer", text: "Exchange page" })
    : el("span", { text: "—" });
  return el("div", { class: "cap-expand" }, [
    el("p", { class: "cap-desc", text: showText(row.description) }),
    el("p", { class: "eyebrow", text: "Events" }),
    events,
    el("p", {}, [el("span", { class: "eyebrow", text: "Exchange" }), " ", link]),
  ]);
}

function onRowKey(event, id) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  toggle(id);
}

function toggle(id) {
  if (capsState.open.has(id)) capsState.open.delete(id);
  else capsState.open.add(id);
  renderLists();
  const nodes = [...document.querySelectorAll(`[data-cap-id="${CSS.escape(id)}"]`)];
  const visible = nodes.find((node) => node.getClientRects().length > 0);
  if (visible) visible.focus();
}

function renderTable(rows) {
  const table = el("table", { class: "register caps" });
  const head = el("thead");
  const headRow = el("tr");
  COLUMNS.forEach(([key, label]) => {
    const active = capsState.sortKey === key;
    const th = el("th", { scope: "col", "aria-sort": active ? (capsState.sortDir === "asc" ? "ascending" : "descending") : "none" });
    th.append(el("button", {
      type: "button",
      "data-active": active ? "true" : "false",
      onClick: () => setSort(key),
    }, [
      label,
      el("span", { class: "arrow", "aria-hidden": "true", text: active ? (capsState.sortDir === "asc" ? "↑" : "↓") : "" }),
    ]));
    headRow.append(th);
  });
  head.append(headRow);
  table.append(head);
  rows.forEach((row) => {
    const open = capsState.open.has(row.id);
    const body = el("tbody", { class: open ? "is-open" : "" });
    const main = el("tr", {
      class: "cap-main",
      tabindex: "0",
      role: "button",
      "aria-expanded": open ? "true" : "false",
      "data-cap-id": row.id,
      onClick: () => toggle(row.id),
      onKeydown: (event) => onRowKey(event, row.id),
    });
    main.append(
      el("td", {}, [companyNode(row)]),
      el("td", { text: showText(row.exchange) }),
      el("td", { text: showText(row.type) }),
      el("td", {}, [stageNode(row.stage)]),
      el("td", { text: formatNum(row.cap) }),
      el("td", { text: formatMedian(row) }),
      el("td", { text: formatNum(row.events12m) }),
      el("td", {}, [latestNode(row)]),
      el("td", { text: formatNum(row.setbacks) }),
      el("td", { text: showText(row.cash) }),
    );
    body.append(main);
    if (open) {
      const detail = el("tr", { class: "cap-detail" });
      detail.append(el("td", { colspan: String(COLUMNS.length) }, [expandBody(row)]));
      body.append(detail);
    }
    table.append(body);
  });
  document.getElementById("smallcaps-table").replaceChildren(table);
}

function fact(label, value) {
  return el("div", {}, [
    el("dt", { text: label }),
    el("dd", {}, [value]),
  ]);
}

function renderCards(rows) {
  const root = document.getElementById("smallcaps-cards");
  root.replaceChildren(...rows.map((row) => {
    const open = capsState.open.has(row.id);
    const button = el("button", {
      type: "button",
      class: "cap-card-btn",
      "aria-expanded": open ? "true" : "false",
      "data-cap-id": row.id,
      onClick: () => toggle(row.id),
    }, [
      el("span", { class: "card-top" }, [
        el("span", { class: "cap-name", text: showText(row.name) }),
        el("span", { class: "cap-code", text: showText(row.code) }),
      ]),
      el("span", { class: "card-meta", text: [showText(row.exchange), showText(row.band), showText(row.type)].join(" · ") }),
      el("span", { class: "cap-stage" }, [stageNode(row.stage)]),
      el("dl", { class: "cap-facts" }, [
        fact("Mkt cap US$m", formatNum(row.cap)),
        fact("Median daily", formatMedian(row)),
        fact("Material events 12m", formatNum(row.events12m)),
        fact("Setbacks", formatNum(row.setbacks)),
        fact("Cash flag", showText(row.cash)),
      ]),
      el("span", { class: "cap-latest" }, [
        el("span", { class: "eyebrow", text: "Latest material event" }),
        latestNode(row),
      ]),
    ]);
    const card = el("article", { class: open ? "card cap-card is-open" : "card cap-card" }, [button]);
    if (open) card.append(el("div", { class: "cap-expand" }, [expandBody(row)]));
    return card;
  }));
}

function renderLists() {
  const rows = visibleRows();
  const shown = rows.length;
  const total = caps.length;
  const noun = total === 1 ? "company" : "companies";
  document.getElementById("smallcaps-showing").textContent = `Showing ${shown} of ${total} ${noun}`;
  const empty = document.getElementById("smallcaps-empty");
  const tableWrap = document.getElementById("smallcaps-table");
  const cards = document.getElementById("smallcaps-cards");
  if (!shown) {
    tableWrap.replaceChildren();
    cards.replaceChildren();
    empty.hidden = false;
    empty.replaceChildren(
      el("strong", { text: "No companies match" }),
      el("p", { text: "Clear the search or set every filter back to All." }),
    );
    return;
  }
  empty.hidden = true;
  renderTable(rows);
  renderCards(rows);
}

function setSort(key) {
  if (capsState.sortKey === key) capsState.sortDir = capsState.sortDir === "asc" ? "desc" : "asc";
  else {
    capsState.sortKey = key;
    capsState.sortDir = ["cap", "median", "events", "latest", "setbacks"].includes(key) ? "desc" : "asc";
  }
  const sort = document.getElementById("smallcaps-sort");
  if (sort) sort.value = `${capsState.sortKey}:${capsState.sortDir}`;
  renderLists();
}

function mountSort() {
  const sort = document.getElementById("smallcaps-sort");
  sort.replaceChildren(...SORTS.map(([key, dir, label]) => el("option", { value: `${key}:${dir}`, text: label })));
  sort.value = `${capsState.sortKey}:${capsState.sortDir}`;
  sort.addEventListener("change", () => {
    const [key, dir] = sort.value.split(":");
    capsState.sortKey = key;
    capsState.sortDir = dir === "desc" ? "desc" : "asc";
    renderLists();
  });
}

function mountFilters() {
  const filters = [
    ["exchange", "Exchange", choiceList(caps.map((row) => showText(row.exchange)), EXCHANGE_ORDER)],
    ["band", "Band", choiceList(caps.map((row) => showText(row.band)), BAND_ORDER)],
    ["type", "Type", choiceList(caps.map((row) => showText(row.type)), [])],
    ["stage", "Stage", choiceList(caps.map((row) => stageKey(row.stage)), STAGE_ORDER)],
  ];
  document.getElementById("smallcaps-filters").replaceChildren(...filters.map(([key, label, values]) => {
    const select = el("select", { "data-cap-filter": key });
    select.append(el("option", { value: "all", text: "All" }), ...values.map((value) => el("option", { value, text: value })));
    select.value = capsState[key] || "all";
    select.addEventListener("change", () => {
      capsState[key] = select.value;
      select.closest(".field").classList.toggle("active", select.value !== "all");
      renderLists();
    });
    return el("label", { class: "field" }, [label, select]);
  }));
}

function bindSearch() {
  const input = document.getElementById("smallcaps-search");
  input.addEventListener("input", () => {
    capsState.q = input.value;
    input.closest(".field").classList.toggle("active", input.value.trim() !== "");
    renderLists();
  });
}

function applyTab(tab, persist) {
  const allowed = ["events", "smallcaps", "norway"];
  const next = allowed.includes(tab) ? tab : "events";
  document.documentElement.dataset.view = next;
  document.body.dataset.view = next;
  ["smallcaps", "norway"].forEach((id) => {
    const panel = document.getElementById(id);
    if (panel) panel.hidden = next !== id;
  });
  document.querySelectorAll(".view-tabs [role='tab']").forEach((button) => {
    const on = button.dataset.view === next;
    button.setAttribute("aria-selected", on ? "true" : "false");
    button.tabIndex = on ? 0 : -1;
  });
  const skip = document.querySelector(".skip");
  if (skip) {
    const target = next === "smallcaps" ? ["#smallcaps", "Skip to screen"] : next === "norway" ? ["#norway", "Skip to Norway"] : ["#timeline", "Skip to timeline"];
    skip.href = target[0];
    skip.textContent = target[1];
  }
  if (persist) {
    try { localStorage.setItem(TAB_KEY, next); } catch (err) {}
  }
}

function bindTabs() {
  const tabs = document.querySelector(".view-tabs");
  if (!tabs) return;
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[role='tab']");
    if (!button) return;
    applyTab(button.dataset.view, true);
  });
  tabs.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const buttons = [...tabs.querySelectorAll("[role='tab']")];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const shift = event.key === "ArrowRight" ? 1 : -1;
    const next = buttons[(index + shift + buttons.length) % buttons.length];
    next.focus();
    applyTab(next.dataset.view, true);
  });
}

function showCapsError() {
  const loading = document.getElementById("smallcaps-loading");
  if (loading) loading.hidden = true;
  const empty = document.getElementById("smallcaps-empty");
  empty.hidden = false;
  empty.replaceChildren(el("p", { class: "error", text: "The screen could not be loaded. Refresh the page to try again." }));
}

async function loadCaps() {
  const response = await fetch("data/smallcaps.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("smallcaps");
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("smallcaps");
  caps = data.map(normalize);
  document.getElementById("smallcaps-loading").hidden = true;
  mountFilters();
  mountSort();
  bindSearch();
  renderLists();
  document.body.dataset.caps = String(caps.length);
}

function boot() {
  bindTabs();
  const view = document.documentElement.dataset.view;
  const initial = view === "smallcaps" || view === "norway" ? view : "events";
  applyTab(initial, false);
  loadCaps().catch(showCapsError);
}

if (typeof document !== "undefined") boot();
