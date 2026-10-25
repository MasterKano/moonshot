const DAY = 86400000;
let chartStart = Date.UTC(2026, 3, 25);
let chartEnd = Date.UTC(2027, 3, 25);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PAD_TOP = 28;
const PAD_BOT = 34;
const LANE = 50;
const NS = "http://www.w3.org/2000/svg";

const RISK_LABELS = {
  geology: "Geology",
  engineering: "Engineering",
  "permits-legal": "Permits and legal",
  funding: "Funding",
  execution: "Execution",
  commercial: "Commercial",
};

const RISK_ORDER = ["geology", "engineering", "permits-legal", "funding", "commercial", "execution"];

const SECTOR_LABELS = {
  mining: "Mining",
  oil_gas: "Oil and gas",
  "mining (royalty/stream)": "Royalty and stream",
  renewables: "Renewables",
};

const STAGE_ORDER = ["Discovery", "Resource", "Study", "Permits", "Funded", "Construction", "Production", "Sold", "n/a"];
const MARKET_ORDER = ["Upcoming", "New", "Unreacted", "Recognized", "Orphan"];
const YN_CHOICES = [["all", "All"], ["Y", "Yes"], ["N", "No"]];

const WINDOWS = [
  ["past3", "Past 3 months"],
  ["past6", "Past 6 months"],
  ["next3", "Next 3 months"],
  ["next6", "Next 6 months"],
  ["all", "All"],
];

const SORTS = [
  ["date", "asc", "Date, earliest"],
  ["date", "desc", "Date, latest"],
  ["company", "asc", "Company A to Z"],
  ["company", "desc", "Company Z to A"],
  ["asset", "asc", "Asset A to Z"],
  ["asset", "desc", "Asset Z to A"],
  ["what", "asc", "What happened A to Z"],
  ["what", "desc", "What happened Z to A"],
  ["risk", "asc", "Risk A to Z"],
  ["risk", "desc", "Risk Z to A"],
  ["stage", "asc", "Stage, first to last"],
  ["stage", "desc", "Stage, last to first"],
  ["status", "asc", "Status A to Z"],
  ["status", "desc", "Status Z to A"],
];

const COLUMNS = [
  ["date", "Date", "168px"],
  ["asset", "Asset", "20%"],
  ["what", "What happened", "auto"],
  ["risk", "Risk removed", "150px"],
  ["stage", "Stage", "120px"],
  ["status", "Status", "108px"],
  [null, "Source", "76px"],
];

const state = {
  company: "all",
  sector: "all",
  stage: "all",
  risk: "all",
  status: "all",
  gate: "all",
  market: "all",
  material: "all",
  trap: "all",
  window: "all",
  sortKey: "date",
  sortDir: "asc",
  openId: null,
  pinned: false,
};

let model = null;
let hideTimer = 0;

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = String(text).replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function rowsToObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = (cells[i] ?? "").trim();
    });
    return obj;
  });
}

export function parseWhen(raw) {
  const s = String(raw ?? "").trim();
  if (!s || s.toLowerCase() === "unknown") return { precision: "undated", date: null };
  const match = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!match) return { precision: "undated", date: null };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] ? Number(match[3]) : 15;
  if (month < 1 || month > 12 || day < 1 || day > 31) return { precision: "undated", date: null };
  return {
    precision: match[3] ? "day" : "month",
    date: new Date(Date.UTC(year, month - 1, day)),
  };
}

export function splitList(value) {
  const parts = [];
  let buf = "";
  let depth = 0;
  for (const ch of String(value ?? "")) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      if (buf.trim()) parts.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

export function clean(value) {
  return String(value ?? "").replaceAll("&", "and");
}

function sectorLabel(sector) {
  return SECTOR_LABELS[sector] || clean(sector);
}

function commodityLabel(commodity) {
  const value = clean(commodity);
  if (value.toLowerCase().startsWith("power")) {
    return "Power (solar, battery, wind, data centre sites)";
  }
  return value.replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

function riskLabel(risk) {
  return RISK_LABELS[risk] || clean(risk);
}

function statusLabel(status) {
  if (status === "happened") return "Happened";
  if (status === "expected") return "Expected";
  return clean(status);
}

function yn(value) {
  const flag = String(value ?? "").trim().toUpperCase();
  return flag === "Y" || flag === "N" ? flag : "";
}

function ynLabel(value) {
  if (value === "Y") return "Yes";
  if (value === "N") return "No";
  return "—";
}

function pctLabel(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "—";
  const number = Number(text);
  if (!Number.isFinite(number)) return "—";
  const body = text.replace(/^[+-]/, "");
  return `${number < 0 ? "−" : ""}${body}%`;
}

function confidenceLabel(value) {
  if (value === "low") return "Low";
  if (value === "medium") return "Medium";
  if (value === "high") return "High";
  return "—";
}

function announcedDiffers(event) {
  if (!event.announcedDate || event.announcedPrecision === "undated") return false;
  if (!event.date || event.precision === "undated") return true;
  if (event.announcedPrecision !== event.precision) return true;
  return event.announcedDate.getTime() !== event.date.getTime();
}

function announcedWhen(event) {
  return { precision: event.announcedPrecision, date: event.announcedDate };
}

function trapText(event) {
  if (event.trap !== "Y") return ynLabel(event.trap);
  const reason = clean(event.trapReason);
  return reason ? `Yes. ${reason}` : "Yes";
}

function formatStamp(ms) {
  const date = new Date(ms);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function setChartBounds(events) {
  chartStart = Date.UTC(2026, 3, 25);
  let last = chartStart;
  events.forEach((event) => {
    if (event.date && event.date.getTime() > last) last = event.date.getTime();
  });
  chartEnd = Math.max(Date.UTC(2027, 3, 25), last + 20 * DAY);
}

function chartRange() {
  return `${formatStamp(chartStart)} to ${formatStamp(chartEnd)}`;
}

export function formatWhen(event) {
  if (!event || event.precision === "undated" || !event.date) return "Undated";
  const mon = MONTHS[event.date.getUTCMonth()];
  const year = event.date.getUTCFullYear();
  if (event.precision === "month") return `${mon} ${year}`;
  return `${event.date.getUTCDate()} ${mon} ${year}`;
}

export function todayUtc(now = new Date()) {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function addMonths(date, count) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const first = new Date(Date.UTC(year, month + count, 1));
  const dim = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, dim)));
}

export function inWindow(event, key, today) {
  if (key === "all") return true;
  if (!event || event.precision === "undated" || !event.date) return false;
  const span = key.endsWith("3") ? 3 : 6;
  const forward = key.startsWith("next");
  const start = forward ? today : addMonths(today, -span);
  const end = forward ? addMonths(today, span) : today;
  if (event.precision === "month") {
    const monthStart = Date.UTC(event.date.getUTCFullYear(), event.date.getUTCMonth(), 1);
    const monthEnd = Date.UTC(event.date.getUTCFullYear(), event.date.getUTCMonth() + 1, 0, 23, 59, 59);
    return monthEnd >= start.getTime() && monthStart <= end.getTime();
  }
  const time = event.date.getTime();
  return time >= start.getTime() && time <= end.getTime();
}

export function prepare(eventsCsv, companiesCsv) {
  const companies = rowsToObjects(companiesCsv).map((row, index) => {
    const commodities = splitList(row.commodity);
    return {
      company: row.company,
      ticker: row.ticker,
      sector: row.sector,
      sectorLabel: sectorLabel(row.sector),
      commodities,
      commodityLabels: commodities.map(commodityLabel),
      order: index,
    };
  });
  const byTicker = new Map(companies.map((company) => [company.ticker, company]));
  const events = rowsToObjects(eventsCsv).map((row, index) => {
    const when = parseWhen(row.date);
    const announced = parseWhen(row.announced_date);
    const company = byTicker.get(row.ticker);
    return {
      seq: index,
      id: `e${index}`,
      company: row.company,
      ticker: row.ticker,
      asset: row.asset,
      what: row.what_happened,
      risk: row.risk_removed,
      stage: row.stage || "n/a",
      status: row.status,
      sourceUrl: row.source_url,
      announcedPrecision: announced.precision,
      announcedDate: announced.date,
      material: yn(row.material),
      trap: yn(row.trap),
      trapReason: row.trap_reason || "",
      market: row.market_status || "",
      runup60: row.runup_60d || "",
      excess20: row.excess_20d || "",
      excess3m: row.excess_3m || "",
      sizeEst: row.size_est_pct || "",
      confidence: String(row.confidence || "").trim().toLowerCase(),
      exit: yn(row.exit),
      gate: yn(row.gate_pass),
      notes: row.label_notes || "",
      precision: when.precision,
      date: when.date,
      sector: company ? company.sector : "",
      sectorLabel: company ? company.sectorLabel : "",
      commodities: company ? company.commodities : [],
      commodityLabels: company ? company.commodityLabels : [],
      companyOrder: company ? company.order : 1000 + index,
    };
  });
  return { companies, events };
}

export function nextDated(events, today) {
  const upcoming = events.filter((event) => event.precision !== "undated" && event.date && event.date.getTime() >= today.getTime());
  upcoming.sort((a, b) => a.date - b.date || a.seq - b.seq);
  return upcoming[0] || null;
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return parsed.href;
  } catch {
    return "";
  }
}

function riskColor(risk) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--risk-${risk}`).trim();
  if (raw) return raw;
  const fallback = ["#1d4e89", "#1f7a4d", "#8a5a12", "#0f6f78", "#6d3a78", "#a33b4a"];
  let hash = 0;
  for (const ch of String(risk)) hash = (hash + ch.charCodeAt(0)) % fallback.length;
  return fallback[hash];
}

function eventMatches(event, filters, today) {
  if (filters.company !== "all" && event.ticker !== filters.company) return false;
  if (filters.stage !== "all" && event.stage !== filters.stage) return false;
  if (filters.risk !== "all" && event.risk !== filters.risk) return false;
  if (filters.status !== "all" && event.status !== filters.status) return false;
  if (filters.gate !== "all" && event.gate !== filters.gate) return false;
  if (filters.market !== "all" && event.market !== filters.market) return false;
  if (filters.material !== "all" && event.material !== filters.material) return false;
  if (filters.trap !== "all" && event.trap !== filters.trap) return false;
  if (filters.sector !== "all") {
    const idx = filters.sector.indexOf(":");
    const kind = filters.sector.slice(0, idx);
    const value = filters.sector.slice(idx + 1);
    if (kind === "sector" && event.sector !== value) return false;
    if (kind === "commodity" && !event.commodities.some((item) => item.toLowerCase() === value.toLowerCase())) {
      return false;
    }
  }
  return inWindow(event, filters.window, today);
}

function filtersActive() {
  return ["company", "sector", "stage", "risk", "status", "gate", "market", "material", "trap", "window"].some((key) => state[key] !== "all");
}

function onChart(event) {
  if (event.precision === "undated" || !event.date) return false;
  const time = event.date.getTime();
  return time >= chartStart && time <= chartEnd;
}

function h(tag, props, children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "text") el.textContent = String(value);
      else if (key === "hidden") el.hidden = true;
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
      else el.setAttribute(key, String(value));
    }
  }
  for (const child of [].concat(children || [])) {
    if (child == null || child === false) continue;
    el.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

function svgEl(tag, props) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value != null) el.setAttribute(key, String(value));
  }
  return el;
}

function plural(count, phrase) {
  const parts = phrase.split(" ");
  const noun = parts.pop();
  const irregular = { company: "companies" };
  const word = count === 1 ? noun : (irregular[noun] || `${noun}s`);
  return `${count} ${[...parts, word].join(" ")}`;
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

function orderIndex(order, value) {
  const idx = order.indexOf(value);
  return idx === -1 ? order.length + 1 : idx;
}

function filteredEvents() {
  const today = todayUtc();
  return model.events.filter((event) => eventMatches(event, state, today));
}

function filteredIgnoringWindow() {
  return model.events.filter((event) => eventMatches(event, { ...state, window: "all" }, todayUtc()));
}

function renderStats(events) {
  const root = document.getElementById("stats");
  const today = todayUtc();
  const happened = events.filter((event) => event.status === "happened").length;
  const expected = events.filter((event) => event.status === "expected").length;
  const companies = new Set(events.map((event) => event.ticker)).size;
  const upcoming = nextDated(events, today);
  const narrowed = filtersActive();
  const pct = events.length ? (happened / events.length) * 100 : 0;

  const eventsCard = h("article", { class: "stat stat-total" }, [
    h("p", { class: "stat-label", text: "Total events" }),
    h("p", { class: "num", text: String(events.length) }),
    h("p", { class: "hint", text: narrowed ? `of ${model.events.length} in the register` : "in the register" }),
  ]);

  const split = h("article", { class: "stat stat-split" }, [
    h("p", { class: "stat-label", text: "Happened vs expected" }),
    h("div", { class: "pair" }, [
      h("p", {}, [h("span", { class: "num", text: String(happened) }), h("span", { class: "cap", text: "Happened" })]),
      h("p", {}, [h("span", { class: "num", text: String(expected) }), h("span", { class: "cap", text: "Expected" })]),
    ]),
    h("div", { class: "bar", role: "img", "aria-label": `${happened} happened and ${expected} expected` }, [
      h("span", { style: `width:${pct}%` }),
    ]),
  ]);

  const gateCount = events.filter((event) => event.gate === "Y").length;
  const gateCard = h("article", { class: "stat stat-gate" }, [
    h("p", { class: "stat-label", text: "Gate pass" }),
    h("p", { class: "num", text: String(gateCount) }),
    h("p", { class: "hint", text: narrowed ? "in this view" : "cleared the screen" }),
  ]);

  const companiesCard = h("article", { class: "stat stat-companies" }, [
    h("p", { class: "stat-label", text: "Companies covered" }),
    h("p", { class: "num", text: String(companies) }),
    h("p", { class: "hint", text: narrowed ? "in this view" : "in the register" }),
  ]);

  let nextBody;
  if (upcoming) {
    nextBody = h("button", {
      type: "button",
      class: "next-btn",
      onClick: () => focusEvent(upcoming.id),
    }, [
      h("span", { class: "date-num", text: formatWhen(upcoming) }),
      h("span", { class: "next-co", text: clean(upcoming.company) }),
      h("span", { class: "next-asset", text: clean(upcoming.asset) }),
    ]);
  } else {
    nextBody = h("div", { class: "next-btn" }, [
      h("span", { class: "date-num", text: "None ahead" }),
      h("span", { class: "next-asset", text: "No dated event on or after today is in this view." }),
    ]);
  }

  root.replaceChildren(
    eventsCard,
    split,
    gateCard,
    companiesCard,
    h("article", { class: "stat stat-next" }, [
      h("p", { class: "stat-label", text: "Next dated event" }),
      nextBody,
    ]),
  );
}

function option(value, label) {
  return h("option", { value, text: label });
}

function mountFilters() {
  const windowRoot = document.getElementById("window");
  windowRoot.replaceChildren(...WINDOWS.map(([key, label]) => h("button", {
    type: "button",
    role: "radio",
    "data-window": key,
    "aria-checked": key === state.window ? "true" : "false",
    onClick: () => {
      state.window = key;
      closePopover();
      apply();
    },
  }, label)));

  document.getElementById("fields").replaceChildren(
    selectField("company", "Company", companyChoices()),
    selectField("sector", "Sector / commodity", sectorChoices()),
    selectField("stage", "Stage", orderedChoices(unique(model.events.map((event) => event.stage)), STAGE_ORDER, clean)),
    selectField("risk", "Risk removed", orderedChoices(unique(model.events.map((event) => event.risk)), RISK_ORDER, riskLabel)),
    selectField("status", "Status", [["all", "All"], ["happened", "Happened"], ["expected", "Expected"]]),
    selectField("gate", "Gate pass", YN_CHOICES),
    selectField("market", "Market status", orderedChoices(unique(model.events.map((event) => event.market)), MARKET_ORDER, clean)),
    selectField("material", "Material", YN_CHOICES),
    selectField("trap", "Trap", YN_CHOICES),
  );

  document.getElementById("reset").addEventListener("click", resetFilters);

  const sort = document.getElementById("sortSelect");
  sort.replaceChildren(...SORTS.map(([key, dir, label]) => option(`${key}:${dir}`, label)));
  sort.value = `${state.sortKey}:${state.sortDir}`;
  sort.addEventListener("change", () => {
    const [key, dir] = sort.value.split(":");
    state.sortKey = key;
    state.sortDir = dir;
    renderRegister(filteredEvents());
  });

  mountLegend();
}

function companyChoices() {
  return [["all", "All"], ...model.companies.map((company) => [company.ticker, `${clean(company.company)} (${company.ticker})`])];
}

function sectorChoices() {
  const sectors = unique(model.companies.map((company) => company.sector));
  const commodities = unique(model.companies.flatMap((company) => company.commodities));
  commodities.sort((a, b) => commodityLabel(a).localeCompare(commodityLabel(b), "en"));
  const sectorGroup = h("optgroup", { label: "Sector" });
  sectors.forEach((sector) => sectorGroup.append(option(`sector:${sector}`, sectorLabel(sector))));
  const commodityGroup = h("optgroup", { label: "Commodity" });
  commodities.forEach((commodity) => commodityGroup.append(option(`commodity:${commodity}`, commodityLabel(commodity))));
  return { groups: [sectorGroup, commodityGroup] };
}

function orderedChoices(values, order, labeler) {
  values.sort((a, b) => orderIndex(order, a) - orderIndex(order, b) || String(a).localeCompare(String(b)));
  return [["all", "All"], ...values.map((value) => [value, labeler(value)])];
}

function selectField(key, label, choices) {
  const select = h("select", { "data-filter": key });
  if (choices.groups) {
    select.append(option("all", "All"));
    choices.groups.forEach((group) => select.append(group));
  } else {
    select.replaceChildren(...choices.map(([value, text]) => option(value, text)));
  }
  select.value = state[key];
  select.addEventListener("change", () => {
    state[key] = select.value;
    closePopover();
    apply();
  });
  return h("label", { class: "field", "data-field": key }, [label, select]);
}

function mountLegend() {
  const marks = h("ul", {}, [
    legendItem("happened", "Happened"),
    legendItem("expected", "Expected"),
    legendItem("month", "Month only"),
    legendItem("gate", "Gate pass"),
    legendItem("exit", "Exit"),
  ]);
  const risks = unique(model.events.map((event) => event.risk));
  risks.sort((a, b) => orderIndex(RISK_ORDER, a) - orderIndex(RISK_ORDER, b));
  const riskList = h("ul", {});
  risks.forEach((risk) => {
    const swatch = h("span", { class: "swatch", "aria-hidden": "true" });
    swatch.style.background = riskColor(risk);
    riskList.append(h("li", {}, [swatch, riskLabel(risk)]));
  });
  document.getElementById("legend").replaceChildren(
    h("div", { class: "legend-line" }, [h("span", { class: "legend-k", text: "Mark" }), marks]),
    h("div", { class: "legend-line" }, [h("span", { class: "legend-k", text: "Risk removed" }), riskList]),
  );
}

function legendItem(kind, label) {
  return h("li", {}, [h("span", { class: `swatch ${kind}`, "aria-hidden": "true" }), label]);
}

function updateFilterChrome(events) {
  document.querySelectorAll("#window button").forEach((button) => {
    button.setAttribute("aria-checked", button.dataset.window === state.window ? "true" : "false");
  });
  document.querySelectorAll(".field").forEach((field) => {
    const select = field.querySelector("select");
    field.classList.toggle("active", select.value !== "all");
  });
  document.getElementById("reset").disabled = !filtersActive();

  const hint = document.getElementById("windowHint");
  hint.textContent = state.window === "all"
    ? ""
    : "Month-only events stay in view when their month overlaps this window. Undated events are left out.";

  const chips = document.getElementById("chips");
  const items = [];
  if (state.company !== "all") items.push(chip("company", "Company", companyName(state.company)));
  if (state.sector !== "all") items.push(chip("sector", sectorKindLabel(state.sector), sectorValueLabel(state.sector)));
  if (state.stage !== "all") items.push(chip("stage", "Stage", clean(state.stage)));
  if (state.risk !== "all") items.push(chip("risk", "Risk", riskLabel(state.risk)));
  if (state.status !== "all") items.push(chip("status", "Status", statusLabel(state.status)));
  if (state.gate !== "all") items.push(chip("gate", "Gate pass", ynLabel(state.gate)));
  if (state.market !== "all") items.push(chip("market", "Market status", clean(state.market)));
  if (state.material !== "all") items.push(chip("material", "Material", ynLabel(state.material)));
  if (state.trap !== "all") items.push(chip("trap", "Trap", ynLabel(state.trap)));
  if (state.window !== "all") items.push(chip("window", "Window", windowLabel(state.window)));
  chips.replaceChildren(...items);

  const shown = events.length;
  const total = model.events.length;
  document.getElementById("showing").textContent = shown === total
    ? `Showing ${plural(shown, "event")}`
    : `Showing ${shown} of ${plural(total, "event")}`;
}

function chip(key, name, value) {
  return h("button", {
    type: "button",
    class: "chip",
    "aria-label": `Remove ${name} filter`,
    onClick: () => {
      state[key] = "all";
      const select = document.querySelector(`select[data-filter="${key}"]`);
      if (select) select.value = "all";
      closePopover();
      apply();
    },
  }, [h("span", { text: `${name}: ${value}` }), h("span", { class: "x", "aria-hidden": "true", text: "×" })]);
}

function companyName(ticker) {
  const company = model.companies.find((item) => item.ticker === ticker);
  return company ? clean(company.company) : ticker;
}

function sectorKindLabel(value) {
  return value.startsWith("commodity:") ? "Commodity" : "Sector";
}

function sectorValueLabel(value) {
  const idx = value.indexOf(":");
  const kind = value.slice(0, idx);
  const raw = value.slice(idx + 1);
  return kind === "commodity" ? commodityLabel(raw) : sectorLabel(raw);
}

function windowLabel(key) {
  const found = WINDOWS.find(([id]) => id === key);
  return found ? found[1] : key;
}

function resetFilters() {
  state.company = "all";
  state.sector = "all";
  state.stage = "all";
  state.risk = "all";
  state.status = "all";
  state.gate = "all";
  state.market = "all";
  state.material = "all";
  state.trap = "all";
  state.window = "all";
  document.querySelectorAll("select[data-filter]").forEach((select) => {
    select.value = "all";
  });
  closePopover();
  apply();
}

function renderChart(events) {
  const scroll = document.getElementById("chartScroll");
  const previous = scroll.scrollLeft;
  const dated = events.filter(onChart);
  const lanes = laneModels(dated);
  const narrow = window.matchMedia("(max-width: 820px)").matches;
  const empty = document.getElementById("chartEmpty");

  if (!lanes.length) {
    scroll.replaceChildren();
    scroll.hidden = true;
    empty.hidden = false;
    empty.replaceChildren(
      h("strong", { text: "No dated events in this view" }),
      h("p", { text: "Adjust the filters, or reset them to see the full timeline." }),
      h("button", { type: "button", class: "text-btn", onClick: resetFilters, text: "Reset filters" }),
    );
  } else {
    empty.hidden = true;
    scroll.hidden = false;
    const labels = h("div", { class: "label-col" }, [
      h("div", { class: "axis-spacer" }, [
        h("span", { class: "wide-only", text: "Company" }),
        h("span", { class: "narrow-only", text: "Ticker" }),
      ]),
      ...lanes.map((lane, index) => h("div", {
        class: index % 2 ? "lane alt" : "lane",
        title: `${clean(lane.company)} (${lane.ticker})`,
      }, [
        h("span", { class: "tick", text: lane.ticker }),
        h("span", { class: "name", text: clean(lane.company) }),
      ])),
      h("div", { class: "bottom-spacer" }),
    ]);
    const plot = h("div", { class: "plot-col" });
    const months = (chartEnd - chartStart) / (30.437 * DAY);
    plot.style.minWidth = `${Math.round(Math.max(680, months * 48))}px`;
    scroll.replaceChildren(h("div", { class: "chart-grid" }, [labels, plot]));
    const width = Math.max(1, Math.round(plot.getBoundingClientRect().width));
    plot.append(buildSvg(lanes, dated, width));
    if (scroll.scrollWidth > scroll.clientWidth + 2 && previous < 2) {
      const line = scroll.querySelector(".today-line");
      const x = line ? Number(line.getAttribute("x1")) : 0;
      const labelW = scroll.querySelector(".label-col").getBoundingClientRect().width;
      const visiblePlot = Math.max(1, scroll.clientWidth - labelW);
      scroll.scrollLeft = Math.max(0, x - visiblePlot * 0.42);
    } else {
      scroll.scrollLeft = previous;
    }
  }

  const companyCount = new Set(dated.map((event) => event.ticker)).size;
  document.getElementById("chartMeta").textContent = lanes.length
    ? `${plural(companyCount, "company")} · ${plural(dated.length, "dated event")}`
    : "No dated events";

  renderUndated(events);
  const range = chartRange();
  scroll.setAttribute("aria-label", narrow
    ? `Company timeline from ${range}. Scroll sideways for later months.`
    : `Company timeline from ${range}.`);
}

function laneModels(dated) {
  const map = new Map();
  dated.forEach((event) => {
    if (!map.has(event.ticker)) {
      map.set(event.ticker, {
        ticker: event.ticker,
        company: event.company,
        order: event.companyOrder,
      });
    }
  });
  return [...map.values()].sort((a, b) => a.order - b.order);
}

function xFor(time, width) {
  const pad = 16;
  const span = Math.max(width - pad * 2, 1);
  const ratio = (time - chartStart) / (chartEnd - chartStart);
  return pad + Math.min(1, Math.max(0, ratio)) * span;
}

function buildSvg(lanes, dated, width) {
  const height = PAD_TOP + lanes.length * LANE + PAD_BOT;
  const root = svgEl("svg", {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
  });
  const laneIndex = new Map(lanes.map((lane, index) => [lane.ticker, index]));

  lanes.forEach((lane, index) => {
    if (index % 2) {
      root.append(svgEl("rect", {
        x: 0,
        y: PAD_TOP + index * LANE,
        width,
        height: LANE,
        fill: "#f6f8fb",
      }));
    }
    if (index > 0) {
      const y = PAD_TOP + index * LANE + 0.5;
      root.append(svgEl("line", { x1: 0, x2: width, y1: y, y2: y, stroke: "#e2e8ef" }));
    }
  });
  root.append(svgEl("line", {
    x1: 0,
    x2: width,
    y1: PAD_TOP + 0.5,
    y2: PAD_TOP + 0.5,
    stroke: "#d5dde6",
  }));
  const base = PAD_TOP + lanes.length * LANE + 0.5;
  root.append(svgEl("line", { x1: 0, x2: width, y1: base, y2: base, stroke: "#d5dde6" }));

  monthTicks(width).forEach((tick) => {
    if (tick.line != null) {
      root.append(svgEl("line", {
        x1: tick.line,
        x2: tick.line,
        y1: PAD_TOP,
        y2: PAD_TOP + lanes.length * LANE,
        stroke: "#e6edf3",
      }));
    }
    if (tick.show) {
      const label = svgEl("text", {
        x: tick.labelX,
        y: PAD_TOP + lanes.length * LANE + 20,
        "text-anchor": "middle",
        class: "month-label",
      });
      label.textContent = tick.text;
      root.append(label);
    }
  });

  const today = todayUtc().getTime();
  if (today >= chartStart && today <= chartEnd) {
    const x = xFor(today, width);
    root.append(svgEl("line", {
      x1: x,
      x2: x,
      y1: PAD_TOP,
      y2: PAD_TOP + lanes.length * LANE,
      class: "today-line",
    }));
    const tagW = 52;
    let tagX = x - tagW / 2;
    tagX = Math.max(4, Math.min(tagX, width - tagW - 4));
    root.append(svgEl("rect", {
      x: tagX,
      y: 5,
      width: tagW,
      height: 18,
      rx: 9,
      fill: "#ffffff",
      stroke: "#c5d4e6",
    }));
    const todayText = svgEl("text", {
      x: tagX + tagW / 2,
      y: 17.5,
      "text-anchor": "middle",
      class: "today-label",
    });
    todayText.textContent = "Today";
    root.append(todayText);
  }

  const dots = dated.map((event) => ({
    event,
    x: xFor(event.date.getTime(), width),
    y: PAD_TOP + laneIndex.get(event.ticker) * LANE + LANE / 2,
    xOff: 0,
    yOff: 0,
  }));
  spreadDots(dots);
  dots.forEach((dot) => root.append(drawDot(dot)));
  return root;
}

function monthTicks(width) {
  const ticks = [];
  let first = true;
  const origin = new Date(chartStart);
  for (let cursor = Date.UTC(origin.getUTCFullYear(), origin.getUTCMonth(), 1); cursor <= chartEnd; cursor = Date.UTC(new Date(cursor).getUTCFullYear(), new Date(cursor).getUTCMonth() + 1, 1)) {
    const monthDate = new Date(cursor);
    const next = Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1);
    const visibleStart = Math.max(cursor, chartStart);
    const visibleEnd = Math.min(next, chartEnd);
    const visibleDays = (visibleEnd - visibleStart) / DAY;
    const show = visibleDays >= 18;
    const year = monthDate.getUTCFullYear();
    const name = MONTHS[monthDate.getUTCMonth()];
    const withYear = first || monthDate.getUTCMonth() === 0;
    ticks.push({
      line: cursor >= chartStart && cursor <= chartEnd ? xFor(cursor, width) : null,
      labelX: xFor((visibleStart + visibleEnd) / 2, width),
      show,
      text: show && withYear ? `${name} ’${String(year).slice(2)}` : name,
    });
    if (show) first = false;
  }
  return ticks;
}

function spreadDots(dots) {
  const byLane = new Map();
  dots.forEach((dot) => {
    const key = dot.event.ticker;
    if (!byLane.has(key)) byLane.set(key, []);
    byLane.get(key).push(dot);
  });
  byLane.forEach((list) => {
    list.sort((a, b) => a.x - b.x || a.event.seq - b.event.seq);
    let cluster = [];
    const flush = () => {
      const count = cluster.length;
      if (count > 1) {
        const sameX = Math.abs(cluster[0].x - cluster[count - 1].x) < 2;
        cluster.forEach((dot, index) => {
          const shift = (index - (count - 1) / 2) * 18;
          if (sameX) dot.xOff = shift;
          else dot.yOff = shift;
        });
      }
      cluster = [];
    };
    list.forEach((dot) => {
      if (cluster.length && dot.x - cluster[cluster.length - 1].x > 18) flush();
      cluster.push(dot);
    });
    flush();
  });
}

function drawDot(dot) {
  const event = dot.event;
  const color = riskColor(event.risk);
  const group = svgEl("g", {
    class: state.openId === event.id ? "dot is-open" : "dot",
    tabindex: "0",
    role: "button",
    "data-id": event.id,
    "data-precision": event.precision,
    "data-gate": event.gate,
    "data-exit": event.exit,
    "data-date": event.date ? event.date.toISOString().slice(0, 10) : "",
    "aria-label": dotLabel(event),
  });
  group.append(svgEl("circle", {
    cx: dot.x + dot.xOff,
    cy: dot.y + dot.yOff,
    r: 14,
    fill: "transparent",
  }));
  const cx = dot.x + dot.xOff;
  const cy = dot.y + dot.yOff;
  group.append(svgEl("circle", {
    class: "halo",
    cx,
    cy,
    r: 11,
  }));
  if (event.gate === "Y") {
    group.append(svgEl("circle", {
      class: "gate-ring",
      cx,
      cy,
      r: 9.6,
      fill: "none",
      stroke: "#0c2f57",
      "stroke-width": 1.15,
      "stroke-opacity": "0.62",
    }));
  }
  const paint = {
    class: "mark",
    fill: event.status === "happened" ? color : "#ffffff",
    stroke: color,
    "stroke-width": 2,
  };
  const mark = event.exit === "Y"
    ? svgEl("polygon", { ...paint, points: `${cx},${cy - 7.2} ${cx + 7.2},${cy} ${cx},${cy + 7.2} ${cx - 7.2},${cy}` })
    : svgEl("circle", { ...paint, cx, cy, r: 6.5 });
  if (event.precision === "month") mark.setAttribute("stroke-dasharray", "2.2 1.8");
  group.append(mark);
  group.addEventListener("mouseenter", () => preview(event.id));
  group.addEventListener("mouseleave", scheduleHide);
  group.addEventListener("click", (clickEvent) => {
    clickEvent.stopPropagation();
    togglePin(event.id);
  });
  group.addEventListener("keydown", (keyEvent) => {
    if (keyEvent.key === "Enter" || keyEvent.key === " ") {
      keyEvent.preventDefault();
      togglePin(event.id, { focus: true });
    }
  });
  group.addEventListener("focus", () => {
    if (!state.pinned) preview(event.id);
  });
  return group;
}

function dotLabel(event) {
  const when = event.precision === "month" ? `${formatWhen(event)}, month only` : formatWhen(event);
  const bits = [
    when,
    clean(event.company),
    clean(event.asset),
    clean(event.what),
    `Stage ${clean(event.stage)}`,
    `Status ${statusLabel(event.status)}`,
    `Risk removed ${riskLabel(event.risk)}`,
    `Market ${clean(event.market) || "—"}`,
    `Gate pass ${ynLabel(event.gate)}`,
  ];
  if (event.exit === "Y") bits.push("Exit");
  return `${bits.join(". ")}.`;
}

function renderUndated(events) {
  const root = document.getElementById("undated");
  const undated = events.filter((event) => event.precision === "undated");
  const hiddenByWindow = state.window !== "all"
    && filteredIgnoringWindow().some((event) => event.precision === "undated");

  if (!undated.length && !hiddenByWindow) {
    root.replaceChildren();
    return;
  }

  const head = h("div", {}, [
    h("h3", { text: "Undated" }),
    h("p", {
      class: "panel-sub",
      text: undated.length
        ? "No date is given in the register, so these sit outside the timeline."
        : "A time window is on, so undated events are not listed. Choose All to bring them back.",
    }),
  ]);

  if (!undated.length) {
    root.replaceChildren(h("div", { class: "undated" }, [head]));
    return;
  }

  const items = undated
    .slice()
    .sort((a, b) => a.companyOrder - b.companyOrder || a.seq - b.seq)
    .map((event) => {
      const link = sourceLink(event, "Source");
      return h("article", { class: "u-item", "data-row": event.id }, [
        h("span", { class: "rdot", "aria-hidden": "true", style: `background:${riskColor(event.risk)}` }),
        h("div", {}, [
          h("div", { class: "u-top" }, [
            h("div", {}, [
              h("span", { class: "u-co", text: clean(event.company) }),
              h("span", { class: "u-ticker", text: event.ticker }),
            ]),
            pill(event.status),
          ]),
          h("div", { class: "u-asset", text: clean(event.asset) }),
          h("p", { class: "u-what", text: clean(event.what) }),
          h("div", { class: "u-meta" }, [
            h("span", { class: "risk" }, [
              h("span", { class: "rdot", "aria-hidden": "true", style: `background:${riskColor(event.risk)}` }),
              riskLabel(event.risk),
            ]),
            h("span", { text: clean(event.stage) }),
            link,
          ]),
          cardFlags(event),
        ]),
      ]);
    });
  root.replaceChildren(h("div", { class: "undated" }, [head, ...items]));
}

function pill(status) {
  return h("span", { class: `pill ${status === "happened" ? "happened" : "expected"}`, text: statusLabel(status) });
}

function sourceLink(event, label) {
  const href = safeUrl(event.sourceUrl);
  if (!href) return h("span", { class: "muted", text: "No source" });
  return h("a", {
    class: "source",
    href,
    target: "_blank",
    rel: "noopener noreferrer",
    "aria-label": `Source for ${clean(event.company)}, ${formatWhen(event)}. Opens in a new tab.`,
    text: label,
  });
}

function dateCmp(a, b, dir) {
  const aUndated = a.precision === "undated";
  const bUndated = b.precision === "undated";
  if (aUndated || bUndated) {
    if (aUndated && bUndated) return a.seq - b.seq;
    return aUndated ? 1 : -1;
  }
  const delta = a.date.getTime() - b.date.getTime();
  return delta === 0 ? a.seq - b.seq : delta * dir;
}

function sortValue(event) {
  if (state.sortKey === "asset") return event.asset;
  if (state.sortKey === "what") return event.what;
  if (state.sortKey === "risk") return riskLabel(event.risk);
  if (state.sortKey === "stage") return event.stage;
  if (state.sortKey === "status") return statusLabel(event.status);
  return event.company;
}

function sortItems(items) {
  const copy = items.slice();
  if (state.sortKey === "company") {
    copy.sort((a, b) => dateCmp(a, b, 1));
    return copy;
  }
  const dir = state.sortDir === "asc" ? 1 : -1;
  copy.sort((a, b) => {
    if (state.sortKey === "date") return dateCmp(a, b, dir);
    if (state.sortKey === "stage") {
      const cmp = orderIndex(STAGE_ORDER, a.stage) - orderIndex(STAGE_ORDER, b.stage);
      return cmp === 0 ? a.seq - b.seq : cmp * dir;
    }
    const cmp = String(sortValue(a)).localeCompare(String(sortValue(b)), "en", { sensitivity: "base", numeric: true });
    return cmp === 0 ? a.seq - b.seq : cmp * dir;
  });
  return copy;
}

function grouped(events) {
  const map = new Map();
  events.forEach((event) => {
    if (!map.has(event.ticker)) map.set(event.ticker, []);
    map.get(event.ticker).push(event);
  });
  const groups = [...map.entries()].map(([ticker, items]) => ({
    ticker,
    company: items[0].company,
    order: items[0].companyOrder,
    sectorLabel: items[0].sectorLabel,
    commodityLabels: items[0].commodityLabels,
    items: sortItems(items),
  }));
  groups.sort((a, b) => {
    if (state.sortKey === "company") {
      const cmp = a.company.localeCompare(b.company, "en", { sensitivity: "base" });
      return state.sortDir === "asc" ? cmp : -cmp;
    }
    return a.order - b.order;
  });
  return groups;
}

function sortCaption() {
  if (state.sortKey === "company") {
    return state.sortDir === "asc"
      ? "Companies from A to Z, events in date order."
      : "Companies from Z to A, events in date order.";
  }
  if (state.sortKey === "date") {
    return state.sortDir === "asc"
      ? "Grouped by company, events in date order."
      : "Grouped by company, latest events first.";
  }
  if (state.sortKey === "stage") {
    return state.sortDir === "asc"
      ? "Grouped by company, stage from Discovery toward Sold."
      : "Grouped by company, stage from Sold back toward Discovery.";
  }
  const names = {
    asset: "asset",
    what: "what happened",
    risk: "risk removed",
    stage: "stage",
    status: "status",
  };
  const direction = state.sortDir === "asc" ? "A to Z" : "Z to A";
  return `Grouped by company, sorted by ${names[state.sortKey] || "column"}, ${direction}.`;
}

function renderRegister(events) {
  document.getElementById("sortCaption").textContent = sortCaption();
  const sort = document.getElementById("sortSelect");
  const sortValueKey = `${state.sortKey}:${state.sortDir}`;
  if ([...sort.options].some((item) => item.value === sortValueKey)) sort.value = sortValueKey;

  const empty = document.getElementById("tableEmpty");
  const tableWrap = document.getElementById("tableWrap");
  const cards = document.getElementById("cards");
  if (!events.length) {
    empty.hidden = false;
    empty.replaceChildren(
      h("strong", { text: "Nothing in this view" }),
      h("p", { text: "No events match these filters." }),
      h("button", { type: "button", class: "text-btn", onClick: resetFilters, text: "Reset filters" }),
    );
    tableWrap.replaceChildren();
    cards.replaceChildren();
    return;
  }
  empty.hidden = true;
  const groups = grouped(events);
  tableWrap.replaceChildren(renderTable(groups));
  cards.replaceChildren(...groups.map(renderCardGroup));
}

function renderTable(groups) {
  const table = h("table", { class: "register" });
  const caption = h("caption", { class: "sr-only", text: "De-risking events grouped by company" });
  caption.style.position = "absolute";
  caption.style.width = "1px";
  caption.style.height = "1px";
  caption.style.overflow = "hidden";
  caption.style.clip = "rect(0 0 0 0)";
  table.append(caption);
  const colgroup = h("colgroup");
  COLUMNS.forEach(([, , width]) => colgroup.append(h("col", { style: `width:${width}` })));
  table.append(colgroup);

  const head = h("thead");
  const headRow = h("tr");
  COLUMNS.forEach(([key, label]) => {
    const th = h("th", { scope: "col" });
    if (!key) {
      th.textContent = label;
    } else {
      if (state.sortKey === key) th.setAttribute("aria-sort", state.sortDir === "asc" ? "ascending" : "descending");
      const button = h("button", {
        type: "button",
        "data-active": state.sortKey === key ? "true" : "false",
        onClick: () => {
          if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
          else {
            state.sortKey = key;
            state.sortDir = "asc";
          }
          renderRegister(filteredEvents());
        },
      }, [
        label,
        h("span", { class: "arrow", "aria-hidden": "true", text: state.sortKey === key ? (state.sortDir === "asc" ? "↑" : "↓") : "" }),
      ]);
      th.append(button);
    }
    headRow.append(th);
  });
  head.append(headRow);
  table.append(head);

  groups.forEach((group) => {
    const body = h("tbody");
    const groupRow = h("tr", { class: "group" });
    const groupCell = h("th", { colspan: String(COLUMNS.length), scope: "rowgroup" });
    groupCell.append(
      document.createTextNode(clean(group.company)),
      h("span", { class: "co-ticker", text: group.ticker }),
      h("span", { class: "co-extra", text: groupMeta(group) }),
      h("span", { class: "co-count", text: plural(group.items.length, "event") }),
    );
    groupRow.append(groupCell);
    body.append(groupRow);
    table.append(body);
    group.items.forEach((event) => {
      const block = h("tbody", {
        class: state.openId === event.id ? "event-block is-selected" : "event-block",
        "data-row": event.id,
      });
      block.append(eventRow(event), labelRow(event));
      table.append(block);
    });
  });
  return table;
}

function groupMeta(group) {
  const commodities = group.commodityLabels.join(", ");
  return commodities ? `${group.sectorLabel} · ${commodities}` : group.sectorLabel;
}

function eventRow(event) {
  const row = h("tr", { class: "event" });
  row.append(
    dateCell(event),
    h("td", { class: "asset", text: clean(event.asset) }),
    h("td", { class: "what", text: clean(event.what) }),
    h("td", {}, [riskSpan(event)]),
    h("td", { text: clean(event.stage) }),
    h("td", {}, [pill(event.status)]),
    h("td", {}, [sourceLink(event, "Source")]),
  );
  return row;
}

function labelRow(event) {
  const row = h("tr", { class: "labels" });
  const cell = h("td", { colspan: String(COLUMNS.length) });
  cell.append(labelBlock(event));
  row.append(cell);
  return row;
}

function fact(key, value, extra) {
  return h("span", { class: extra ? `fact ${extra}` : "fact" }, [
    h("span", { class: "k", text: key }),
    document.createTextNode(value),
  ]);
}

function labelBlock(event) {
  const strip = h("div", { class: "label-strip" }, [
    fact("Market", clean(event.market) || "—"),
    fact("Gate", ynLabel(event.gate), event.gate === "Y" ? "is-gate" : ""),
    fact("Material", ynLabel(event.material)),
    fact("Trap", trapText(event), event.trap === "Y" && event.trapReason ? "is-long" : ""),
    fact("60-day run-up", pctLabel(event.runup60)),
    fact("20-day excess", pctLabel(event.excess20)),
    fact("3-month excess", pctLabel(event.excess3m)),
    fact("Size estimate", pctLabel(event.sizeEst)),
    fact("Confidence", confidenceLabel(event.confidence), event.confidence === "low" ? "flag-low" : ""),
  ]);
  if (event.exit === "Y") strip.append(fact("Exit", "Yes", "is-exit"));
  if (announcedDiffers(event)) strip.append(fact("Announced", formatWhen(announcedWhen(event))));
  const block = h("div", { class: "label-block" }, [strip]);
  if (event.notes) block.append(h("p", { class: "label-notes", text: clean(event.notes) }));
  return block;
}

function dateCell(event) {
  const cell = h("td", { class: "date" });
  cell.append(document.createTextNode(formatWhen(event)));
  if (event.precision === "month") cell.append(h("span", { class: "precision", text: "Month" }));
  return cell;
}

function riskSpan(event) {
  return h("span", { class: "risk" }, [
    h("span", { class: "rdot", "aria-hidden": "true", style: `background:${riskColor(event.risk)}` }),
    riskLabel(event.risk),
  ]);
}

function renderCardGroup(group) {
  return h("section", { class: "co-block" }, [
    h("h3", { class: "co-head" }, [
      document.createTextNode(clean(group.company)),
      h("span", { class: "co-ticker", text: group.ticker }),
      h("span", { class: "co-extra", text: `${groupMeta(group)} · ${plural(group.items.length, "event")}` }),
    ]),
    ...group.items.map((event) => h("article", {
      class: state.openId === event.id ? "card is-selected" : "card",
      "data-row": event.id,
    }, [
      h("div", { class: "card-top" }, [
        h("time", {
        datetime: event.date ? event.date.toISOString().slice(0, 10) : null,
        text: formatWhen(event),
      }),
        pill(event.status),
      ]),
      event.precision === "month" ? h("div", {}, [h("span", { class: "precision", text: "Month" })]) : null,
      h("h4", { class: "card-asset", text: clean(event.asset) }),
      h("p", { class: "card-what", text: clean(event.what) }),
      cardFlags(event),
      h("div", { class: "card-meta" }, [
        riskSpan(event),
        h("span", { text: clean(event.stage) }),
        sourceLink(event, "Source"),
      ]),
      cardDetails(event),
    ])),
  ]);
}

function cardFlags(event) {
  const flags = [h("span", { class: "mini", text: clean(event.market) || "—" })];
  if (event.gate === "Y") flags.push(h("span", { class: "mini is-gate", text: "Gate pass" }));
  if (event.exit === "Y") flags.push(h("span", { class: "mini is-exit", text: "Exit" }));
  if (event.confidence === "low") flags.push(h("span", { class: "mini flag-low", text: "Low confidence" }));
  return h("div", { class: "card-flags" }, flags);
}

function moreLine(key, value, extra) {
  return h("p", { class: extra ? `more-line ${extra}` : "more-line" }, [
    h("span", { class: "k", text: key }),
    document.createTextNode(value),
  ]);
}

function cardDetails(event) {
  const body = h("div", { class: "more-body" }, [
    moreLine("Material", ynLabel(event.material)),
    moreLine("Trap", trapText(event)),
    moreLine("Exit", ynLabel(event.exit)),
    moreLine("60-day run-up", pctLabel(event.runup60)),
    moreLine("20-day excess", pctLabel(event.excess20)),
    moreLine("3-month excess", pctLabel(event.excess3m)),
    moreLine("Size estimate", pctLabel(event.sizeEst)),
    moreLine("Confidence", confidenceLabel(event.confidence), event.confidence === "low" ? "flag-low" : ""),
  ]);
  if (announcedDiffers(event)) body.append(moreLine("Announced", formatWhen(announcedWhen(event))));
  if (event.notes) body.append(h("p", { class: "label-notes", text: clean(event.notes) }));
  return h("details", { class: "more" }, [
    h("summary", { text: "Label detail" }),
    body,
  ]);
}

function findEvent(id) {
  return model.events.find((event) => event.id === id) || null;
}

function preview(id) {
  if (state.pinned) return;
  openPopover(id, { pin: false, focus: false });
}

function scheduleHide() {
  clearTimeout(hideTimer);
  if (state.pinned) return;
  hideTimer = setTimeout(() => {
    const pop = document.getElementById("popover");
    if (state.pinned || pop.matches(":hover")) return;
    closePopover();
  }, 200);
}

function togglePin(id, { focus = false } = {}) {
  if (state.pinned && state.openId === id) {
    closePopover();
    return;
  }
  openPopover(id, { pin: true, focus });
}

function openPopover(id, { pin, focus }) {
  const event = findEvent(id);
  if (!event) return;
  clearTimeout(hideTimer);
  state.openId = id;
  state.pinned = pin;
  const pop = document.getElementById("popover");
  pop.replaceChildren(
    h("div", { class: "pop-head" }, [
      h("div", { class: "pop-kicker", text: `${event.ticker} · ${clean(event.company)}` }),
      h("button", {
        type: "button",
        class: "pop-close",
        onClick: (clickEvent) => {
          clickEvent.stopPropagation();
          closePopover();
        },
        text: "Close",
      }),
    ]),
    h("div", { class: "pop-date" }, [
      h("span", { text: formatWhen(event) }),
      event.precision === "month" ? h("span", { class: "precision", text: "Month only" }) : null,
      pill(event.status),
    ]),
    h("div", { class: "pop-asset", id: "pop-title", text: clean(event.asset) }),
    h("p", { class: "pop-what", text: clean(event.what) }),
    popRows(event),
    event.notes ? h("p", { class: "pop-notes", text: clean(event.notes) }) : null,
    sourceLink(event, "Source"),
  );
  pop.setAttribute("aria-labelledby", "pop-title");
  pop.hidden = false;
  positionPopover();
  pop.classList.add("open");
  syncScrim();
  markOpenDot();
  if (focus) {
    const link = pop.querySelector("a");
    (link || pop).focus();
  }
}

function popRows(event) {
  const rows = [
    ["Market status", clean(event.market) || "—", ""],
    ["Gate pass", ynLabel(event.gate), ""],
    ["Material", ynLabel(event.material), ""],
    ["Trap", trapText(event), ""],
    ["Stage", clean(event.stage) || "—", ""],
    ["Risk removed", riskLabel(event.risk), ""],
    ["Exit", ynLabel(event.exit), ""],
    ["60-day run-up", pctLabel(event.runup60), ""],
    ["20-day excess", pctLabel(event.excess20), ""],
    ["3-month excess", pctLabel(event.excess3m), ""],
    ["Size estimate", pctLabel(event.sizeEst), ""],
    ["Confidence", confidenceLabel(event.confidence), event.confidence === "low" ? "flag-low" : ""],
  ];
  if (announcedDiffers(event)) rows.push(["Announced", formatWhen(announcedWhen(event)), ""]);
  const dl = h("dl", { class: "pop-rows" });
  rows.forEach(([key, value, extra]) => {
    dl.append(
      h("dt", { text: key }),
      h("dd", extra ? { class: extra, text: value } : { text: value }),
    );
  });
  return dl;
}

function positionPopover() {
  const pop = document.getElementById("popover");
  const narrow = window.matchMedia("(max-width: 820px)").matches;
  if (narrow) {
    pop.style.left = "12px";
    pop.style.right = "12px";
    pop.style.top = "auto";
    pop.style.bottom = "calc(12px + env(safe-area-inset-bottom))";
    return;
  }
  const anchor = document.querySelector(`.dot[data-id="${CSS.escape(state.openId || "")}"]`);
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  let top = rect.bottom + 10;
  if (top + height > window.innerHeight - 12) top = rect.top - height - 10;
  if (top < 12) top = 12;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.right = "auto";
  pop.style.bottom = "auto";
}

function syncScrim() {
  const narrow = window.matchMedia("(max-width: 820px)").matches;
  document.getElementById("scrim").hidden = !(state.pinned && narrow && state.openId);
}

function markOpenDot() {
  document.querySelectorAll(".dot").forEach((dot) => {
    dot.classList.toggle("is-open", dot.dataset.id === state.openId);
  });
  document.querySelectorAll("[data-row]").forEach((row) => {
    row.classList.toggle("is-selected", row.dataset.row === state.openId);
  });
}

function closePopover() {
  clearTimeout(hideTimer);
  state.openId = null;
  state.pinned = false;
  const pop = document.getElementById("popover");
  pop.classList.remove("open");
  pop.hidden = true;
  pop.replaceChildren();
  syncScrim();
  markOpenDot();
}

function focusEvent(id) {
  const event = findEvent(id);
  if (!event) return;
  if (onChart(event) && filteredEvents().some((item) => item.id === id)) {
    const dot = document.querySelector(`.dot[data-id="${CSS.escape(id)}"]`);
    if (dot) {
      dot.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
      togglePin(id);
      return;
    }
  }
  const row = document.querySelector(`#cards [data-row="${CSS.escape(id)}"], #tableWrap [data-row="${CSS.escape(id)}"]`);
  if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
}

function syncRangeCopy() {
  const range = chartRange();
  const lede = document.getElementById("lede");
  if (lede) lede.textContent = `De-risking events for listed resource companies. The timeline runs from ${range}.`;
  const sub = document.getElementById("timelineSub");
  if (sub) sub.textContent = `One row per company, ${range}.`;
}

function apply() {
  syncRangeCopy();
  const events = filteredEvents();
  if (state.openId && !events.some((event) => event.id === state.openId && onChart(event))) closePopover();
  renderStats(events);
  updateFilterChrome(events);
  renderChart(events);
  renderRegister(events);
  if (state.openId) {
    const anchor = document.querySelector(`.dot[data-id="${CSS.escape(state.openId)}"]`);
    if (anchor) positionPopover();
    else closePopover();
    markOpenDot();
  }
}

function showError() {
  document.getElementById("loading").hidden = true;
  const note = h("p", { class: "error", text: "The register could not be loaded. Refresh the page to try again." });
  document.getElementById("main").prepend(note);
}

async function main() {
  try {
    const [eventsCsv, companiesCsv] = await Promise.all([
      fetch("data/events.csv", { cache: "no-cache" }).then((response) => {
        if (!response.ok) throw new Error("events");
        return response.text();
      }),
      fetch("data/companies.csv", { cache: "no-cache" }).then((response) => {
        if (!response.ok) throw new Error("companies");
        return response.text();
      }),
    ]);
    model = prepare(eventsCsv, companiesCsv);
    setChartBounds(model.events);
    document.getElementById("loading").hidden = true;
    document.getElementById("app").hidden = false;
    mountFilters();
    apply();
    document.body.dataset.ready = "true";
    document.body.dataset.events = String(model.events.length);
  } catch {
    showError();
  }
}

function bindChrome() {
  document.addEventListener("click", (event) => {
    if (!state.pinned) return;
    if (event.target.closest(".popover, .dot, .next-btn, .scrim")) return;
    closePopover();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.openId) {
      const id = state.openId;
      closePopover();
      const dot = document.querySelector(`.dot[data-id="${CSS.escape(id)}"]`);
      if (dot) dot.focus();
    }
  });

  window.addEventListener("resize", () => {
    if (!model) return;
    const activeId = document.activeElement && document.activeElement.dataset
      ? document.activeElement.dataset.id
      : null;
    renderChart(filteredEvents());
    if (state.openId) positionPopover();
    if (activeId) {
      const next = document.querySelector(`.dot[data-id="${CSS.escape(activeId)}"]`);
      if (next) next.focus();
    }
  });

  document.getElementById("chartScroll").addEventListener("scroll", () => {
    if (state.openId && !window.matchMedia("(max-width: 820px)").matches) positionPopover();
  }, { passive: true });

  document.getElementById("popover").addEventListener("mouseenter", () => clearTimeout(hideTimer));
  document.getElementById("popover").addEventListener("mouseleave", scheduleHide);
  document.getElementById("popover").addEventListener("click", (event) => event.stopPropagation());
  document.getElementById("scrim").addEventListener("click", (event) => {
    event.stopPropagation();
    closePopover();
  });
}

if (typeof document !== "undefined") {
  bindChrome();
  main();
}
