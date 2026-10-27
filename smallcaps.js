const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TAB_KEY = "moonshot-tab";
const STAGE_ORDER = ["Explorer", "Resource defined", "Study stage", "Developer", "Producer"];
const EXCHANGE_ORDER = ["ASX", "AIM", "Main Market", "Oslo", "London", "Warsaw", "Paris", "NYSE", "Vienna", "Madrid", "Tokyo", "Private/State"];
const MARKET_OPTIONS = ["London", "ASX", "Norway"];
const SECTOR_OPTIONS = ["Oil and gas", "Mining"];
const BAND_ORDER = ["Micro (US$5-100M)", "Main (US$100M-5B)"];
const REACTION_TIP = "Share move minus index move after the event, in %";
const REACTION_CAPTION = "Historical context from the past year of events (27 Oct 2025 to 26 Oct 2026). Medians. Past reactions do not predict future ones.";
const REACTION_HORIZONS = [["1d", "1 day"], ["5d", "5 days"], ["20d", "20 days"], ["60d", "60 days"]];
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
  ["next", "asc", "Next event, soonest"],
  ["next", "desc", "Next event, latest"],
  ["upcoming", "desc", "Upcoming, high to low"],
  ["upcoming", "asc", "Upcoming, low to high"],
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
  ["next", "Next"],
  ["upcoming", "Upcoming"],
  ["setbacks", "Setbacks"],
  ["cash", "Cash flag"],
];

const capsState = {
  q: "",
  market: "all",
  sector: "all",
  exchange: "all",
  band: "all",
  type: "all",
  stage: "all",
  hasUpcoming: false,
  showBackground: false,
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

function formatUpcomingDate(item) {
  const text = String(item?.date ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return showText(text);
  const year = match[1];
  const monthIndex = Number(match[2]) - 1;
  const month = MONTHS[monthIndex];
  if (!month) return showText(text);
  if (item.date_precision === "year") return year;
  if (item.date_precision === "quarter") return `Q${Math.floor(monthIndex / 3) + 1} ${year}`;
  if (item.date_precision === "half") return `${monthIndex < 6 ? "H1" : "H2"} ${year}`;
  if (item.date_precision === "month") return `${month} ${year}`;
  return formatDate(text);
}

function netBadge(net) {
  if (net === "tight") return el("span", { class: "no-badge tight", text: "Tight" });
  if (net === "loose") return el("span", { class: "no-badge loose", text: "Loose" });
  return null;
}

function stageKey(stage) {
  return String(stage ?? "").replace(/ \(low confidence\)$/, "").trim();
}

// Sector is coarser than Type. "Oil and gas", with or without a low-confidence
// suffix, is Oil and gas. Every other commodity, including Helium and Coal, is Mining.
function sectorOf(type) {
  return stageKey(type) === "Oil and gas" ? "Oil and gas" : "Mining";
}

function listingMarket(exchange) {
  return exchange === "ASX" ? "ASX" : "London";
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

function norwayWindow() {
  const today = isoFromLocal(new Date());
  return { today, start: shiftMonths(today, -12), end: shiftMonths(today, 12) };
}

function tickerSymbol(company) {
  const ticker = String(company.listing_ticker || "").trim();
  if (!ticker.includes(":")) return "";
  const symbol = ticker.split(":").pop().trim();
  if (!symbol || symbol.includes(",") || symbol.includes("(") || symbol.length > 8) return "";
  return symbol;
}

function venueOf(ticker) {
  const text = String(ticker || "").trim();
  if (!text || /^unlisted\b/i.test(text)) return "Private/State";
  let head = text.split(":")[0].trim().split(/\s+and\s+/i)[0].trim();
  if (/^london\b/i.test(head)) return "London";
  if (/^oslo\b/i.test(head)) return "Oslo";
  return head || "Private/State";
}

function screenCode(company) {
  return tickerSymbol(company) || String(company.short_name || "").trim();
}

function nameMatches(shortName, companyName) {
  const short = String(shortName || "").trim().toLowerCase();
  const name = String(companyName || "").trim().toLowerCase();
  if (!short || !name) return false;
  if (name.split(/[^a-z0-9]+/).includes(short)) return true;
  return name === short || name.startsWith(`${short} `);
}

function findScreenRow(company, rows) {
  const symbol = tickerSymbol(company).toUpperCase();
  if (symbol) {
    const byCode = rows.find((row) => String(row.code).toUpperCase() === symbol);
    if (byCode) return byCode;
  }
  return rows.find((row) => nameMatches(company.short_name, row.name)) || null;
}

function displayType(value) {
  const text = showText(value);
  if (text === "—") return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
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
    upcoming: (Array.isArray(row.upcoming) ? row.upcoming : []).filter((item) => item && typeof item === "object"),
    upcomingCount: asNumber(row.upcoming_count),
    nextDate: row.next_event_date,
    sector: sectorOf(row.type),
    markets: [listingMarket(row.exchange)],
    shelf: false,
  };
}

function mapNorwayEvent(event) {
  const upcoming = event.upcoming === "Y";
  const material = event.material === "Y";
  const setback = event.setback === "Y";
  return {
    date: event.date,
    date_precision: event.date_confidence || "exact",
    type: displayType(event.type),
    headline: event.title,
    setback,
    source_url: event.source_url,
    net: event.net === "tight" || event.net === "loose" ? event.net : "",
    material_if_delivered: material ? "Y" : "N",
    r5: null,
    r20: null,
    r60: null,
    norway: true,
    background: !material && !setback && !upcoming,
  };
}

function norwayPack(shortName, events, range) {
  const past = [];
  const upcoming = [];
  events.forEach((event) => {
    if (!event || event.date < range.start || event.date > range.end) return;
    const names = Array.isArray(event.companies) ? event.companies : [];
    if (!names.includes(shortName) && event.operator !== shortName) return;
    const mapped = mapNorwayEvent(event);
    if (event.upcoming === "Y") upcoming.push(mapped);
    else past.push(mapped);
  });
  past.sort((a, b) => String(b.date).localeCompare(String(a.date)) || showText(a.headline).localeCompare(showText(b.headline)));
  upcoming.sort((a, b) => String(a.date).localeCompare(String(b.date)) || showText(a.headline).localeCompare(showText(b.headline)));
  return { past, upcoming };
}

function applyNorwayStats(row, pack, today) {
  const material = pack.past.filter((event) => event.material_if_delivered === "Y" && event.date <= today);
  const setbacks = pack.past.filter((event) => event.setback && event.date <= today);
  row.events12m = (row.events12m || 0) + material.length;
  row.setbacks = (row.setbacks || 0) + setbacks.length;
  const latest = material[0];
  if (latest && (!row.latestDate || latest.date > row.latestDate)) {
    row.latestDate = latest.date;
    row.latestType = latest.type;
    row.latestHeadline = latest.headline;
  }
  row.events = [...row.events, ...pack.past].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  row.upcoming = [...row.upcoming, ...pack.upcoming].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  row.upcomingCount = row.upcoming.length;
  row.nextDate = row.upcoming.length ? row.upcoming[0].date : null;
  if (!row.markets.includes("Norway")) row.markets.push("Norway");
  row.shelf = true;
}

function norwayRow(company, pack, range) {
  const code = screenCode(company);
  const pastMaterial = pack.past.filter((event) => event.material_if_delivered === "Y" && event.date <= range.today);
  const latest = pastMaterial[0];
  return {
    id: `no:${code}`,
    code,
    name: company.name,
    exchange: venueOf(company.listing_ticker),
    band: null,
    type: "Oil and gas",
    stage: null,
    description: company.note,
    cap: null,
    median: null,
    currency: null,
    asOf: company.as_of,
    events12m: pastMaterial.length,
    latestDate: latest ? latest.date : null,
    latestType: latest ? latest.type : null,
    latestHeadline: latest ? latest.headline : null,
    setbacks: pack.past.filter((event) => event.setback && event.date <= range.today).length,
    cash: null,
    url: "",
    events: pack.past,
    upcoming: pack.upcoming,
    upcomingCount: pack.upcoming.length,
    nextDate: pack.upcoming.length ? pack.upcoming[0].date : null,
    sector: "Oil and gas",
    markets: ["Norway"],
    shelf: true,
  };
}

function foldNorway(rows, companies, events) {
  const range = norwayWindow();
  const extras = [];
  companies.forEach((company) => {
    const shortName = String(company.short_name || "").trim();
    if (!shortName) return;
    const pack = norwayPack(shortName, events, range);
    const existing = findScreenRow(company, rows);
    if (existing) {
      applyNorwayStats(existing, pack, range.today);
      return;
    }
    extras.push(norwayRow(company, pack, range));
  });
  extras.sort((a, b) => showText(a.name).localeCompare(showText(b.name), "en", { sensitivity: "base" }));
  return rows.concat(extras);
}

function searchBlob(row) {
  const parts = [
    row.name, row.code, row.exchange, row.band, row.type, row.stage, row.description,
    row.cash, row.currency, row.latestHeadline, row.latestType,
    ...row.events.flatMap((event) => [event.headline, event.type, event.date]),
    ...row.upcoming.flatMap((item) => [item.headline, item.type, item.date]),
  ];
  return parts.map((part) => showText(part) === "—" ? "" : showText(part)).join(" ").toLowerCase();
}

function matches(row) {
  if (capsState.market !== "all" && !row.markets.includes(capsState.market)) return false;
  if (capsState.sector !== "all" && row.sector !== capsState.sector) return false;
  if (capsState.exchange !== "all" && showText(row.exchange) !== capsState.exchange) return false;
  if (capsState.band !== "all" && showText(row.band) !== capsState.band) return false;
  if (capsState.type !== "all" && showText(row.type) !== capsState.type) return false;
  if (capsState.stage !== "all" && stageKey(row.stage) !== capsState.stage) return false;
  if (capsState.hasUpcoming && !(row.upcomingCount > 0)) return false;
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
      if (key === "upcoming") return row.upcomingCount;
      if (key === "next") return dateValue(row.nextDate);
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

function headlineLink(item) {
  const href = safeUrl(item.source_url);
  const text = showText(item.headline);
  if (!href) return el("span", { text });
  return el("a", { href, target: "_blank", rel: "noopener noreferrer", text });
}

function eventDate(event) {
  if (event.date_precision && event.date_precision !== "exact") return formatUpcomingDate(event);
  return formatDate(event.date);
}

function reactionText(value) {
  const number = asNumber(value);
  if (number == null) return { text: "-", tone: "flat" };
  const body = Math.abs(number).toFixed(1);
  if (number < 0) return { text: `−${body}`, tone: "down" };
  if (number > 0) return { text: body, tone: "up" };
  return { text: body, tone: "flat" };
}

function reactionNode(event) {
  return el("span", { class: "reacts", title: REACTION_TIP }, ["r5", "r20", "r60"].map((key) => {
    const bit = reactionText(event[key]);
    return el("span", { class: bit.tone, text: `${key} ${bit.text}` });
  }));
}

function visibleEvents(row) {
  return row.events.filter((event) => capsState.showBackground || !event.background);
}

function expandBody(row) {
  const listed = visibleEvents(row);
  const hidden = row.events.length - listed.length;
  const events = listed.length
    ? el("ul", { class: "cap-events" }, listed.map((event) => el("li", { class: "cap-event" }, [
      el("span", { class: "cap-date", text: eventDate(event) }),
      el("span", { text: showText(event.type) }),
      el("span", { text: showText(event.headline) }),
      el("span", { text: `Setback: ${setbackLabel(event.setback)}` }),
      reactionNode(event),
    ])))
    : el("p", { class: "cap-desc", text: hidden ? "Background events are hidden." : "No events listed." });
  const upcoming = row.upcoming.length
    ? [
      el("p", { class: "eyebrow", text: "Upcoming" }),
      el("ul", { class: "cap-events" }, row.upcoming.map((item) => el("li", { class: "cap-event" }, [
        el("span", { class: "cap-date", text: formatUpcomingDate(item) }),
        el("span", { text: showText(item.type) }),
        headlineLink(item),
        el("span", {}, [
          netBadge(item.net),
          item.material_if_delivered === "Y" ? el("span", { class: "no-badge", text: "Material" }) : null,
        ]),
      ]))),
    ]
    : [];
  const href = safeUrl(row.url);
  const link = href
    ? el("a", { href, target: "_blank", rel: "noopener noreferrer", text: "Exchange page" })
    : el("span", { text: "—" });
  return el("div", { class: "cap-expand" }, [
    el("p", { class: "cap-desc", text: showText(row.description) }),
    el("p", { class: "eyebrow", text: "Events" }),
    events,
    ...upcoming,
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
      el("td", { text: blank(row.nextDate) ? "" : formatDate(row.nextDate) }),
      el("td", { text: row.upcomingCount == null ? "" : formatNum(row.upcomingCount) }),
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
        ...(row.upcomingCount == null && blank(row.nextDate) ? [] : [
          fact("Next", blank(row.nextDate) ? "" : formatDate(row.nextDate)),
          fact("Upcoming", row.upcomingCount == null ? "" : formatNum(row.upcomingCount)),
        ]),
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
      el("p", { text: "Clear the search, turn off Has upcoming, or set every filter back to All." }),
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
    capsState.sortDir = ["cap", "median", "events", "latest", "setbacks", "upcoming"].includes(key) ? "desc" : "asc";
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
    ["market", "Market", MARKET_OPTIONS],
    ["sector", "Sector", SECTOR_OPTIONS],
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
  }), el("label", { class: "field" }, [
    "Upcoming",
    el("button", {
      type: "button",
      class: "toggle-btn",
      id: "smallcaps-upcoming",
      "aria-pressed": capsState.hasUpcoming ? "true" : "false",
      onClick: (event) => {
        capsState.hasUpcoming = !capsState.hasUpcoming;
        event.currentTarget.setAttribute("aria-pressed", capsState.hasUpcoming ? "true" : "false");
        renderLists();
      },
      text: "Has upcoming",
    }),
  ]), el("label", { class: "field" }, [
    "Background",
    el("button", {
      type: "button",
      class: "toggle-btn",
      id: "smallcaps-background",
      "aria-pressed": capsState.showBackground ? "true" : "false",
      onClick: (event) => {
        capsState.showBackground = !capsState.showBackground;
        event.currentTarget.setAttribute("aria-pressed", capsState.showBackground ? "true" : "false");
        renderLists();
      },
      text: "Show background",
    }),
  ]));
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
  const mapped = tab === "norway" ? "smallcaps" : tab;
  const allowed = ["events", "smallcaps", "coming"];
  const next = allowed.includes(mapped) ? mapped : "events";
  document.documentElement.dataset.view = next;
  document.body.dataset.view = next;
  ["smallcaps", "coming"].forEach((id) => {
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
    const target = next === "smallcaps" ? ["#smallcaps", "Skip to screen"] : next === "coming" ? ["#coming", "Skip to coming up"] : ["#timeline", "Skip to timeline"];
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

function formatMove(value) {
  const number = asNumber(value);
  if (number == null) return "—";
  const body = Math.abs(number).toFixed(1);
  return number < 0 ? `−${body}` : body;
}

function formatShare(value) {
  const number = asNumber(value);
  if (number == null) return "—";
  const rounded = Math.round(number * 10) / 10;
  const body = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${body}%`;
}

function reactionCell(stat) {
  const dim = !stat || stat.n < 10;
  return el("td", { class: dim ? "react-dim" : "" }, [
    el("span", { class: "react-med", text: stat ? formatMove(stat.median) : "—" }),
    el("span", { class: "react-hit", text: stat ? `${formatShare(stat.hit_rate)} positive` : "" }),
    el("span", { class: "react-n", text: stat ? `n ${stat.n}` : "" }),
  ]);
}

function reactionGroup(label, block) {
  const stats = REACTION_HORIZONS.map(([key]) => block?.[key]);
  const dim = stats.every((stat) => !stat || stat.n < 10);
  const row = el("tr", { class: dim ? "react-dim" : "" });
  row.append(el("th", { scope: "row", text: label }));
  stats.forEach((stat) => row.append(reactionCell(stat)));
  return row;
}

function reactionTable(groups) {
  const table = el("table", { class: "react-table" });
  const head = el("tr");
  head.append(el("th", { scope: "col", text: "" }));
  REACTION_HORIZONS.forEach(([, label]) => head.append(el("th", { scope: "col", text: label })));
  table.append(el("thead", {}, [head]));
  const body = el("tbody");
  groups.forEach(([label, block]) => body.append(reactionGroup(label, block)));
  table.append(body);
  return el("div", { class: "react-scroll" }, [table]);
}

function renderReactions(summary) {
  const panel = document.getElementById("react-panel");
  const body = document.getElementById("react-body");
  const caption = document.getElementById("react-caption");
  if (!panel || !body || !caption || !summary || typeof summary !== "object") return;
  const tiers = summary.by_tier || {};
  const types = summary.by_type || {};
  caption.textContent = REACTION_CAPTION;
  body.replaceChildren(
    el("p", { class: "eyebrow", text: "By tier" }),
    reactionTable([
      ["Material", tiers.material],
      ["Background", tiers.background],
      ["Setback", tiers.setback],
    ]),
    el("p", { class: "eyebrow", text: "By event type" }),
    reactionTable(Object.entries(types)),
  );
  panel.hidden = false;
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(path);
  return response.json();
}

async function loadCaps() {
  const [data, companies, events, summary] = await Promise.all([
    loadJson("data/smallcaps.json"),
    loadJson("data/norway_companies.json"),
    loadJson("data/norway_events.json"),
    loadJson("data/smallcaps_reaction_summary.json"),
  ]);
  if (!Array.isArray(data) || !Array.isArray(companies) || !Array.isArray(events)) throw new Error("smallcaps");
  caps = foldNorway(data.map(normalize), companies, events);
  document.getElementById("smallcaps-loading").hidden = true;
  renderReactions(summary);
  mountFilters();
  mountSort();
  bindSearch();
  renderLists();
  document.body.dataset.caps = String(caps.length);
  document.body.dataset.shelf = String(caps.filter((row) => row.shelf).length);
  if (pendingScreen) {
    const code = pendingScreen;
    pendingScreen = "";
    revealScreen(code);
  }
}

let pendingScreen = "";

function resetScreenFilters() {
  capsState.q = "";
  capsState.market = "all";
  capsState.sector = "all";
  capsState.exchange = "all";
  capsState.band = "all";
  capsState.type = "all";
  capsState.stage = "all";
  capsState.hasUpcoming = false;
  capsState.showBackground = false;
  const search = document.getElementById("smallcaps-search");
  if (search) {
    search.value = "";
    search.closest(".field").classList.toggle("active", false);
  }
  document.querySelectorAll("#smallcaps-filters select").forEach((select) => {
    select.value = "all";
    select.closest(".field").classList.toggle("active", false);
  });
  const upcoming = document.getElementById("smallcaps-upcoming");
  if (upcoming) upcoming.setAttribute("aria-pressed", "false");
  const background = document.getElementById("smallcaps-background");
  if (background) background.setAttribute("aria-pressed", "false");
}

function revealScreen(code) {
  const row = caps.find((item) => String(item.code) === String(code));
  if (!row) return;
  resetScreenFilters();
  capsState.open = new Set([row.id]);
  renderLists();
  const node = document.querySelector(`#smallcaps [data-cap-id="${CSS.escape(row.id)}"]`);
  if (node) node.scrollIntoView({ block: "center" });
}

function openScreenCompany(code) {
  applyTab("smallcaps", true);
  if (!caps.length) {
    pendingScreen = code;
    return;
  }
  revealScreen(code);
}

function boot() {
  bindTabs();
  window.moonshotApplyTab = applyTab;
  window.moonshotOpenScreen = openScreenCompany;
  const view = document.documentElement.dataset.view;
  const initial = view === "norway" ? "smallcaps" : view;
  applyTab(initial === "smallcaps" || initial === "coming" ? initial : "events", false);
  loadCaps().catch(showCapsError);
}

if (typeof document !== "undefined") boot();
