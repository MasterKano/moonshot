const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TAB_KEY = "moonshot-tab";
const STAGE_ORDER = ["Explorer", "Resource defined", "Study stage", "Developer", "Producer"];
const EXCHANGE_ORDER = ["ASX", "AIM", "Main Market", "Nasdaq Stockholm", "Nasdaq Helsinki", "Nasdaq First North Sweden", "Oslo Børs", "Euronext Growth Oslo", "Tel Aviv Stock Exchange", "Euronext Paris", "Euronext Amsterdam", "Euronext Milan", "Frankfurt (Scale)", "Oslo", "London", "Warsaw", "Paris", "NYSE", "Vienna", "Madrid", "Tokyo", "Private/State"];
const MARKET_OPTIONS = ["London", "ASX", "Norway", "Nordic", "Tel Aviv", "Paris", "Frankfurt", "Milan", "Amsterdam", "TSX"];
const PILOT_CODES = ["LUN", "MAU", "FDY", "LUNR", "ORRON", "FWZ", "LUG", "NGEX"];
const SECTOR_OPTIONS = ["Oil and gas", "Mining"];
const CATEGORY_OPTIONS = ["Operational", "Capital and deals", "Corporate"];
const BAND_ORDER = ["Micro (US$5-100M)", "Main (US$100M-5B)"];
const REACTION_TIP = "Share move minus index move after the event, in %";
const REACTION_CAPTION = "Historical context from the past year of events (27 Oct 2025 to 26 Oct 2026). Medians. Past reactions do not predict future ones.";
const REACTION_HORIZONS = [["1d", "1 day"], ["5d", "5 days"], ["20d", "20 days"], ["60d", "60 days"]];
const SORTS = [
  ["name", "asc", "Company A to Z"],
  ["name", "desc", "Company Z to A"],
  ["exchange", "asc", "Exchange A to Z"],
  ["exchange", "desc", "Exchange Z to A"],
  ["type", "asc", "Commodity A to Z"],
  ["type", "desc", "Commodity Z to A"],
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
  ["runway", "asc", "Runway A to Z"],
  ["runway", "desc", "Runway Z to A"],
];
const COLUMN_TIPS = {
  name: "Company name and ticker.",
  exchange: "Where the shares trade.",
  type: "The commodity this company works in.",
  stage: "How far the project has got.",
  cap: "Market value in millions of US dollars.",
  median: "Typical daily trading value.",
  events: "Material events in the last 12 months.",
  latest: "The newest material event.",
  next: "The next guided date. A wide window stays in words.",
  upcoming: "How many guided items are ahead.",
  setbacks: "Setbacks in the last 12 months.",
  cash: "Funding note. Unknown means the figure was not found.",
  runway: "A rough check from public filings. Not advice.",
};
const COLUMNS = [
  ["name", "Company"],
  ["exchange", "Exchange"],
  ["type", "Commodity"],
  ["stage", "Stage"],
  ["cap", "Mkt cap US$m"],
  ["median", "Median daily"],
  ["events", "Material events 12m"],
  ["latest", "Latest material event"],
  ["next", "Next"],
  ["upcoming", "Upcoming"],
  ["setbacks", "Setbacks"],
  ["cash", "Cash flag"],
  ["runway", "Runway"],
];

const capsState = {
  q: "",
  market: "all",
  sector: "all",
  category: "all",
  country: "all",
  exchange: "all",
  band: "all",
  type: "all",
  stage: "all",
  hasUpcoming: false,
  showBackground: false,
  watchOnly: false,
  sortKey: "name",
  sortDir: "asc",
  open: new Set(),
  columns: [],
};

let caps = [];
let readAcross = [];
let slipped = [];
let countryOptions = [];
const countryByCode = new Map();

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

function basisTag(basis) {
  const key = String(basis || "").toLowerCase();
  if (key === "confirmed") return el("span", { class: "basis-tag", title: "The date is fixed on a calendar or in a contract.", text: "Confirmed" });
  if (key === "company target") return el("span", { class: "basis-tag", title: "The company or operator gave this window.", text: "Company target" });
  if (key === "estimate") return el("span", { class: "basis-tag", title: "The date is inferred. No company window is on file.", text: "Estimate" });
  return null;
}

function formatUpcomingDate(item) {
  if (item && item.sort_date_is_proxy && item.date_window_text) return showText(item.date_window_text);
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
  if (net === "tight") return el("span", { class: "chip chip-conf-high", title: "How firmly the date is known. A narrow window.", text: "High" });
  if (net === "loose") return el("span", { class: "chip chip-conf-low", title: "How firmly the date is known. A wide window.", text: "Low" });
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

function venueName(exchange) {
  return exchange === "Oslo Bors" ? "Oslo Børs" : exchange;
}

function isNordicExchange(exchange) {
  const text = String(exchange || "").toLowerCase();
  return ["stockholm", "first north", "helsinki", "oslo børs", "oslo bors", "euronext growth oslo"].some((venue) => text.includes(venue));
}

function listingMarket(exchange) {
  const text = String(exchange || "").toLowerCase();
  if (exchange === "ASX") return "ASX";
  if (isNordicExchange(exchange)) return "Nordic";
  if (text.includes("tel aviv")) return "Tel Aviv";
  if (text.includes("euronext paris") || text.includes("euronext growth paris")) return "Paris";
  if (text.includes("frankfurt") || text.includes("xetra")) return "Frankfurt";
  if (text.includes("euronext milan") || text.includes("borsa italiana")) return "Milan";
  if (text.includes("euronext amsterdam")) return "Amsterdam";
  return "London";
}

function bareCode(code) {
  return String(code || "").replace(/\.(OL|ST|HE)$/i, "");
}

function codesMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return bareCode(a) === bareCode(b);
}

function normHead(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function headlinesClose(a, b) {
  const left = normHead(a);
  const right = normHead(b);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const words = (text) => new Set(text.split(" ").filter((word) => word.length > 4));
  const leftWords = words(left);
  const rightWords = words(right);
  let shared = 0;
  leftWords.forEach((word) => { if (rightWords.has(word)) shared += 1; });
  return shared >= 3;
}

function isListed(value) {
  return value === true || value === "Y";
}

function indexCountries(files) {
  countryByCode.clear();
  countryOptions = [];
  files.forEach((file) => {
    const name = String(file?.country || "").trim();
    if (!name) return;
    if (!countryOptions.includes(name)) countryOptions.push(name);
    (file.companies || []).forEach((company) => {
      if (!isListed(company.in_dataset) || !company.code) return;
      const code = String(company.code).trim();
      if (!code) return;
      if (!countryByCode.has(code)) countryByCode.set(code, new Set());
      countryByCode.get(code).add(name);
    });
  });
}

function assignCountries(rows) {
  rows.forEach((row) => {
    const names = new Set([...(countryByCode.get(row.code) || [])]);
    row.countries = [...names];
  });
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

function parentPhrase(parent) {
  if (!parent || typeof parent !== "object") return "";
  const name = showText(parent.name).replace(/\s+(ASA|AB|plc|SE|AG|S\.A\.|SA)$/i, "").trim();
  const ticker = showText(parent.ticker);
  if (!name || name === "—") return "";
  return ticker && ticker !== "—" ? `${name} (${ticker})` : name;
}

function identityName(company) {
  const legal = company.name || company.short_name || "";
  const phrase = parentPhrase(company.parent_listed);
  if (company.listing_status === "subsidiary of listed" && phrase) return `${legal}, part of ${phrase}`;
  return legal;
}

function notListedTag(row) {
  const status = String(row.listingStatus || "").toLowerCase();
  if (status !== "private" && status !== "state") return null;
  return el("span", { class: "not-listed", title: "Private or state entity, with no stock-exchange listing.", text: "Not listed" });
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
  return rows.find((row) => {
    if (!nameMatches(company.short_name, row.name)) return false;
    // A different listed ticker is a different company. "TotalEnergies" must not swallow TotalEnergies EP Gabon.
    if (symbol && row.code && String(row.code).toUpperCase() !== symbol) return false;
    return true;
  }) || null;
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
    exchange: venueName(row.exchange),
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
    cashDisplay: row.cash_flag_display || "",
    missing: row.missing_fields && typeof row.missing_fields === "object" ? row.missing_fields : {},
    checked: row.last_checked || "",
    url: row.url,
    events: events.map((event) => (event && typeof event === "object" ? event : {})),
    upcoming: (Array.isArray(row.upcoming) ? row.upcoming : []).filter((item) => item && typeof item === "object").sort((a, b) => String(a.sort_date || a.date).localeCompare(String(b.sort_date || b.date))),
    upcomingCount: asNumber(row.upcoming_count),
    nextDate: row.next_event_date,
    funding: row.funding && typeof row.funding === "object" ? row.funding : null,
    sector: sectorOf(row.type),
    markets: [listingMarket(row.exchange)],
    shelf: false,
    listingStatus: "listed",
    parentListed: null,
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
    category: event.category,
    material_if_delivered: material ? "Y" : "N",
    event_type: event.event_type || "",
    direction: event.direction || "",
    significance: event.significance || "",
    status: event.status || "",
    date_confidence_level: event.date_confidence_level || "",
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
  upcoming.sort((a, b) => String(a.sort_date || a.date).localeCompare(String(b.sort_date || b.date)) || showText(a.headline).localeCompare(showText(b.headline)));
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
  row.nextDate = row.upcoming.length ? (row.upcoming[0].sort_date || row.upcoming[0].date) : null;
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
    name: identityName(company),
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
    cashDisplay: "",
    missing: {},
    checked: "",
    url: "",
    events: pack.past,
    upcoming: pack.upcoming,
    upcomingCount: pack.upcoming.length,
    nextDate: pack.upcoming.length ? (pack.upcoming[0].sort_date || pack.upcoming[0].date) : null,
    sector: "Oil and gas",
    markets: ["Norway"],
    shelf: true,
    listingStatus: company.listing_status || "",
    parentListed: company.parent_listed || null,
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = String(text).replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

function rowsToObjects(text) {
  const table = parseCsv(text);
  if (!table.length) return [];
  const headers = table[0].map((header) => header.trim());
  return table.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((header, i) => { obj[header] = (cells[i] ?? "").trim(); });
    return obj;
  });
}

function pilotSector(sector) {
  const text = String(sector || "").toLowerCase();
  if (text.includes("oil")) return "Oil and gas";
  if (text.includes("renew")) return "Renewables";
  if (text.includes("royalty")) return "Royalty and stream";
  return "Mining";
}

function pilotMarkets(exchange) {
  const text = String(exchange || "").toLowerCase();
  const markets = [];
  if (text.includes("stockholm") || text.includes("helsinki") || text.includes("oslo")) markets.push("Nordic");
  if (text.includes("tsx") || text.includes("toronto")) markets.push("TSX");
  if (text.includes("asx")) markets.push("ASX");
  if (text.includes("london") || /\baim\b/.test(text)) markets.push("London");
  if (text.includes("paris")) markets.push("Paris");
  if (text.includes("frankfurt") || text.includes("xetra")) markets.push("Frankfurt");
  if (text.includes("milan") || text.includes("borsa italiana")) markets.push("Milan");
  if (text.includes("amsterdam")) markets.push("Amsterdam");
  return markets.length ? markets : ["TSX"];
}

function pilotBand(cap) {
  const number = asNumber(cap);
  if (number == null) return null;
  if (number >= 5000) return "Large";
  if (number >= 100) return "Main (US$100M-5B)";
  if (number >= 5) return "Micro (US$5-100M)";
  return null;
}

function mapPilotEvent(event) {
  const monthOnly = /^\d{4}-\d{2}$/.test(String(event.date || ""));
  return {
    date: event.date,
    date_precision: monthOnly ? "month" : "exact",
    type: displayType(event.event_type || event.risk_removed),
    headline: event.what_happened,
    setback: false,
    source_url: event.source_url,
    source_status: event.source_status,
    source_link_level: event.source_link_level,
    last_checked: event.last_checked,
    sources: event.source_url ? [event.source_url] : [],
    category: "",
    material_if_delivered: event.material === "Y" ? "Y" : "N",
    r5: null,
    r20: null,
    r60: null,
    significance: event.significance || "",
    direction: event.direction || "",
    event_type: event.event_type || "",
  };
}

function foldPilots(rows, companies, events) {
  const wanted = new Set(PILOT_CODES);
  companies.forEach((company) => {
    const code = String(company.ticker || "").trim().toUpperCase();
    if (!wanted.has(code)) return;
    if (rows.some((row) => String(row.code).toUpperCase() === code)) return;
    const own = events.filter((event) => String(event.ticker || "").toUpperCase() === code);
    own.sort((a, b) => String(b.date).localeCompare(String(a.date)) || showText(a.what_happened).localeCompare(showText(b.what_happened)));
    const material = own.filter((event) => event.material === "Y");
    const latest = material[0] || own[0];
    const cap = asNumber(company.market_cap_usd_m);
    const commodity = showText(company.commodity);
    rows.push({
      id: `pilot:${code}`,
      code,
      name: company.company,
      exchange: showText(company.exchange).replaceAll(";", ","),
      band: pilotBand(cap),
      type: commodity === "—" ? commodity : commodity.charAt(0).toUpperCase() + commodity.slice(1),
      stage: displayType(company.stage),
      description: company.notes,
      cap,
      median: null,
      currency: company.market_cap_currency,
      asOf: company.mktcap_as_of,
      events12m: material.length,
      latestDate: latest ? latest.date : null,
      latestType: latest ? (latest.event_type || latest.risk_removed) : null,
      latestHeadline: latest ? latest.what_happened : null,
      setbacks: 0,
      cash: null,
      cashDisplay: "",
      missing: ["FWZ", "LUG", "NGEX"].includes(code)
        ? { cash_flag: "not covered", median_daily_value_k: "not covered", guidance: "not covered", next_event_date: "not covered" }
        : { cash_flag: "unknown", guidance: "not covered", next_event_date: "not covered" },
      checked: "",
      url: "",
      events: own.map(mapPilotEvent),
      upcoming: [],
      upcomingCount: 0,
      nextDate: null,
      sector: pilotSector(company.sector),
      markets: pilotMarkets(company.exchange),
      shelf: false,
      listingStatus: "listed",
      parentListed: null,
    });
  });
  return rows;
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
    ...row.events.flatMap((event) => [event.headline, event.type, event.date, event.category]),
    ...row.upcoming.flatMap((item) => [item.headline, item.type, item.date, item.category]),
  ];
  return parts.map((part) => showText(part) === "—" ? "" : showText(part)).join(" ").toLowerCase();
}

function matches(row) {
  if (capsState.watchOnly && !(window.moonshotWatch && window.moonshotWatch.has(row.code))) return false;
  if (capsState.market !== "all" && !row.markets.includes(capsState.market)) return false;
  if (capsState.sector !== "all" && row.sector !== capsState.sector) return false;
  if (capsState.country !== "all" && !(row.countries || []).includes(capsState.country)) return false;
  if (!categoryHits(row)) return false;
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
  } else if (key === "runway") {
    cmp = directed(runwayLabel(a).localeCompare(runwayLabel(b), "en", { sensitivity: "base" }));
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

const RUNWAY_LABELS = {
  "appears funded to next catalyst": ["Appears funded to next catalyst", "positive"],
  "funding needed before next catalyst": ["Funding needed before next catalyst", "setback"],
  unclear: ["Unclear", "neutral"],
  "not covered": ["Not covered", "background"],
};

function runwayLabel(row) {
  const key = String(row.funding && row.funding.runway_check || "not covered").trim().toLowerCase();
  return (RUNWAY_LABELS[key] || RUNWAY_LABELS["not covered"])[0];
}

function runwayChip(check) {
  const key = String(check || "not covered").trim().toLowerCase();
  const pair = RUNWAY_LABELS[key] || RUNWAY_LABELS["not covered"];
  return el("span", {
    class: `chip chip-${pair[1]} chip-runway`,
    title: "A rough check from public filings. Not advice.",
    text: pair[0],
  });
}

function catalystRunwayChip(row, item) {
  const block = row.funding;
  if (!block || !item || !item.id || String(block.next_catalyst_id || "") !== String(item.id)) return null;
  return runwayChip(block.runway_check);
}

function plainValue(value) {
  if (value == null) return "";
  const text = showText(value);
  if (!text || text === "—" || text === "-") return "";
  return text;
}

function moneyText(amount, currency, unit) {
  const number = asNumber(amount);
  if (number == null) return "";
  const parts = [];
  const cur = plainValue(currency);
  if (cur) parts.push(cur);
  parts.push(formatNum(number));
  const unitText = unit === "million" ? "million" : plainValue(unit);
  if (unitText) parts.push(unitText);
  return parts.join(" ");
}

function runwayBlock(row) {
  const block = row.funding;
  const lines = [
    el("p", { class: "eyebrow", text: "Funding runway" }),
    el("p", { class: "label-notes", text: "A rough check from public filings. Not advice." }),
    runwayChip(block && block.runway_check),
  ];
  if (!block) return el("div", { class: "runway-block" }, lines);
  const reason = plainValue(block.runway_reason);
  if (reason) lines.push(el("p", { text: reason }));
  const cash = moneyText(block.cash, block.cash_currency, block.amount_unit);
  const cashDate = formatDate(block.cash_date);
  const href = safeUrl(block.cash_source_url);
  if (cash) {
    lines.push(el("p", {}, [
      el("span", { class: "k", text: "Cash. " }),
      `${cash}${cashDate !== "—" ? ` as of ${cashDate}` : ""}.`,
      href ? " " : null,
      href ? el("a", {
        href,
        target: "_blank",
        rel: "noopener noreferrer",
        onClick: (event) => event.stopPropagation(),
        text: "Source",
      }) : null,
    ]));
  }
  const burn = moneyText(block.quarterly_burn, block.cash_currency, block.amount_unit);
  const basis = plainValue(block.burn_basis);
  if (burn || basis) {
    lines.push(el("p", {}, [
      el("span", { class: "k", text: "Burn. " }),
      burn ? `${burn} a quarter.` : "",
      basis ? ` ${basis}` : "",
    ]));
  }
  const debt = plainValue(block.debt_or_facilities_note);
  if (debt) lines.push(el("p", {}, [el("span", { class: "k", text: "Debt or facilities. " }), debt]));
  const checked = formatDate(block.last_checked);
  if (checked !== "—") lines.push(el("p", { class: "label-notes", text: `Checked ${checked}.` }));
  return el("div", { class: "runway-block" }, lines);
}

function nextNode(row) {
  const item = (row.upcoming || [])[0];
  if (!item && blank(row.nextDate)) return "—";
  const text = item && item.sort_date_is_proxy && item.date_window_text
    ? showText(item.date_window_text)
    : formatDate(item && (item.sort_date || item.date) || row.nextDate);
  return el("span", { class: "date-stack" }, [
    el("span", { text }),
    basisTag(item && item.date_basis),
    catalystRunwayChip(row, item),
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

const COLUMN_STORE = "moonshot-screen-columns";
const DEFAULT_COLUMN_KEYS = ["name", "exchange", "type", "latest", "next", "cash"];

function storedColumns() {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLUMN_STORE) || "");
    const known = new Set(COLUMNS.map(([key]) => key));
    if (Array.isArray(parsed)) {
      const keys = parsed.filter((key) => known.has(key));
      if (!keys.includes("name")) keys.unshift("name");
      if (keys.length) return keys;
    }
  } catch (err) { /* keep the compact set */ }
  return DEFAULT_COLUMN_KEYS.slice();
}

function saveColumns(keys) {
  capsState.columns = keys;
  try { localStorage.setItem(COLUMN_STORE, JSON.stringify(keys)); } catch (err) { /* ignore */ }
}

function activeColumns() {
  const chosen = new Set(capsState.columns.length ? capsState.columns : DEFAULT_COLUMN_KEYS);
  chosen.add("name");
  return COLUMNS.filter(([key]) => chosen.has(key));
}

function gapNode(kind) {
  const key = String(kind || "unknown").toLowerCase();
  const text = key === "not applicable" ? "n/a" : key === "not covered" ? "Not covered" : "Unknown";
  const tip = key === "not applicable"
    ? "This field does not apply."
    : key === "not covered"
      ? "This field is not tracked for this group."
      : "Covered, but the value was not found.";
  return el("span", { class: "missing-value", title: tip, text });
}

function emptyGap(row, field) {
  const kind = row.missing && row.missing[field];
  if (kind) return gapNode(kind);
  if (row.shelf || String(row.listingStatus || "").toLowerCase() === "private" || String(row.listingStatus || "").toLowerCase() === "state") {
    if (field === "cash_flag" || field === "mkt_cap_usd_m" || field === "median_daily_value_k" || field === "stage" || field === "guidance" || field === "next_event_date") return gapNode("not covered");
  }
  return gapNode("unknown");
}

function cashNode(row) {
  const display = String(row.cashDisplay || row.cash || "").trim();
  const lowered = display.toLowerCase();
  if (!display || lowered === "unknown" || lowered === "no data" || lowered === "—") {
    return emptyGap(row, "cash_flag");
  }
  return el("span", { class: "cash-note", title: row.checked ? `Checked ${formatDate(row.checked)}` : "", text: showText(display) });
}

function cellFor(row, key) {
  if (key === "name") return companyNode(row);
  if (key === "exchange") return showText(row.exchange);
  if (key === "type") return showText(row.type);
  if (key === "stage") return stageNode(row.stage) === "—" ? emptyGap(row, "stage") : stageNode(row.stage);
  if (key === "cap") return formatNum(row.cap) === "—" ? emptyGap(row, "mkt_cap_usd_m") : formatNum(row.cap);
  if (key === "median") return formatMedian(row) === "—" ? emptyGap(row, "median_daily_value_k") : formatMedian(row);
  if (key === "latest") {
    const node = latestNode(row);
    return node === "—" ? emptyGap(row, "latest_event") : node;
  }
  if (key === "next") {
    const node = nextNode(row);
    return node === "—" ? emptyGap(row, "next_event_date") : node;
  }
  if (key === "events") return formatNum(row.events12m);
  if (key === "upcoming") return row.upcomingCount == null ? emptyGap(row, "guidance") : formatNum(row.upcomingCount);
  if (key === "setbacks") return formatNum(row.setbacks);
  if (key === "cash") return cashNode(row);
  if (key === "runway") return runwayChip(row.funding && row.funding.runway_check);
  return emptyGap(row, key);
}

function companyNode(row) {
  const name = el("span", {}, [
    el("span", { class: "cap-name", title: showText(row.name), text: showText(row.name) }),
    el("span", { class: "cap-code", text: showText(row.code) }),
    notListedTag(row),
  ]);
  const star = window.moonshotWatch ? window.moonshotWatch.star(row.code, row.name) : null;
  if (!star) return name;
  return el("span", { class: "co-with-star" }, [star, name]);
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

function categoryTag(value) {
  const text = showText(value);
  if (text === "—") return null;
  return el("span", { class: "cat-tag", text });
}

function sameCategory(event) {
  if (capsState.category === "all") return true;
  return showText(event.category) === capsState.category;
}

function categoryHits(row) {
  if (capsState.category === "all") return true;
  const events = row.events.some((event) => (capsState.showBackground || !eventIsBackground(event)) && sameCategory(event));
  const upcoming = row.upcoming.some((item) => sameCategory(item));
  return events || upcoming;
}

function reactionNode(event, row) {
  const missing = ["r5", "r20", "r60"].every((key) => asNumber(event[key]) == null);
  const nordicOnly = row.markets.includes("Nordic") && row.markets.every((market) => market === "Nordic");
  if (nordicOnly && missing) return null;
  return el("span", { class: "reacts", title: REACTION_TIP }, ["r5", "r20", "r60"].map((key) => {
    const bit = reactionText(event[key]);
    return el("span", { class: bit.tone, text: `${key} ${bit.text}` });
  }));
}

function linksFor(row, event) {
  const dated = readAcross.filter((item) => codesMatch(item.source_code, row.code) && item.date === event.date);
  const close = dated.filter((item) => headlinesClose(item.headline, event.headline));
  if (close.length) return close;
  const sameDay = [...row.events, ...row.upcoming].filter((item) => item.date === event.date);
  return dated.length && sameDay.length === 1 ? dated : [];
}

function screenCodeFor(code) {
  if (caps.some((row) => row.code === code)) return code;
  const bare = bareCode(code);
  const hit = caps.find((row) => row.code === bare);
  return hit ? hit.code : code;
}

function alsoAffects(row, event) {
  const hits = linksFor(row, event);
  if (!hits.length) return null;
  const codes = [...new Set(hits.flatMap((item) => (item.affected_codes || []).map((code) => screenCodeFor(code))))];
  if (!codes.length) return null;
  return el("span", { class: "also-tag", text: `Also affects: ${codes.join(", ")}` });
}

function partnerEvents(row) {
  return readAcross.filter((item) => (item.affected_codes || []).some((code) => codesMatch(code, row.code)));
}

function dateHasPassed(item) {
  const date = String(item?.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const precision = item.date_precision || "exact";
  if (precision === "quarter" || precision === "half" || precision === "year" || precision === "undated") return false;
  const today = isoFromLocal(new Date());
  if (precision === "month") return date.slice(0, 7) < today.slice(0, 7);
  return date < today;
}

function slippedRecord(code, headline) {
  return slipped.find((item) => codesMatch(item.code, code) && headlinesClose(item.item_headline, headline)) || null;
}

function slipTitle(record) {
  if (!record) return "This guided date has passed.";
  return `Originally guided: ${showText(record.originally_guided)}. Checked ${formatDate(record.checked_date)}.`;
}

function slipTag(code, item) {
  const record = slippedRecord(code, item.headline);
  if (!record && !dateHasPassed(item)) return null;
  return el("span", { class: "slip-tag", title: slipTitle(record), text: "Past guided date" });
}

function unmatchedSlipped(row) {
  return slipped.filter((item) => codesMatch(item.code, row.code) && !row.upcoming.some((upcoming) => headlinesClose(item.item_headline, upcoming.headline)));
}

function upcomingTrend(item) {
  const key = String(item.guidance_trend || "").toLowerCase();
  if (item.status === "overdue") return el("span", { class: "slip-tag", text: "Overdue" });
  if (item.status === "slipped" || key.includes("slipped")) return el("span", { class: "slip-tag", title: "The guided window moved later.", text: "Slipped" });
  if (key === "no update found") return el("span", { class: "chip chip-trend-none", title: "The guided window has not moved in the notes on file.", text: "No update found" });
  return null;
}

function guidanceLines(item) {
  const history = Array.isArray(item.guidance_history) ? item.guidance_history : [];
  if (!history.length) return null;
  return el("ul", { class: "guidance-list" }, history.map((entry) => el("li", {}, [
    el("span", { class: "cap-date", text: showText(entry.date_seen) }),
    el("span", { text: showText(entry.window_text) }),
  ])));
}

function eventIsBackground(event) {
  if (event.significance) return event.significance === "background";
  return !!event.background;
}

function screenChips(event) {
  const direction = event.direction || (event.setback ? "negative" : "");
  const significance = event.significance || (eventIsBackground(event) ? "background" : "material");
  const confidence = event.date_confidence_level || (["high", "medium", "low"].includes(String(event.date_confidence || "")) ? event.date_confidence : "");
  return el("span", { class: "chip-row" }, [
    direction === "positive" ? chip("Positive", "positive", "The event moved the asset forward.") : null,
    direction === "neutral" ? chip("Neutral", "neutral", "The event does not clearly help or hurt.") : null,
    direction === "negative" ? chip("Setback", "setback", "A dry hole, a delay, or another step backward.") : null,
    significance === "material" ? chip("Material", "material", "Large enough to matter for the company.") : null,
    significance === "background" ? chip("Background", "background", "A routine item, or too small to change the story.") : null,
    statusChip(event.status),
    confidenceChip(confidence),
  ]);
}

function chip(text, kind, title) {
  return el("span", { class: `chip chip-${kind}`, title: title || "", text });
}

function statusChip(status) {
  const labels = { upcoming: "Upcoming", overdue: "Overdue", slipped: "Slipped", done: "Done" };
  const key = String(status || "").toLowerCase();
  if (!labels[key]) return null;
  return chip(labels[key], key, "Where this guided item stands.");
}

function confidenceChip(level) {
  const labels = { high: "High", medium: "Medium", low: "Low" };
  const key = String(level || "").toLowerCase();
  if (!labels[key]) return null;
  return chip(labels[key], `conf-${key}`, "How firmly the date is known.");
}

function visibleEvents(row) {
  return row.events.filter((event) => (capsState.showBackground || !eventIsBackground(event)) && sameCategory(event));
}

function expandBody(row) {
  const listed = visibleEvents(row);
  const hidden = row.events.length - listed.length;
  const events = listed.length
    ? el("ul", { class: "cap-events" }, listed.map((event) => el("li", { class: "cap-event" }, [
      el("span", { class: "cap-date", text: eventDate(event) }),
      el("span", { class: "cap-kind" }, [showText(event.type), categoryTag(event.category)]),
      el("span", { class: "cap-line" }, [showText(event.headline), alsoAffects(row, event), screenChips(event)]),
      reactionNode(event, row),
    ])))
    : el("p", { class: "cap-desc", text: hidden ? "Background events are hidden." : "No events listed." });
  const upcomingItems = row.upcoming.filter((item) => sameCategory(item));
  const upcoming = upcomingItems.length
    ? [
      el("p", { class: "eyebrow", text: "Upcoming" }),
      el("ul", { class: "cap-events" }, upcomingItems.map((item) => el("li", { class: "cap-event" }, [
        el("span", { class: "cap-date date-stack" }, [el("span", { text: formatUpcomingDate(item) }), basisTag(item.date_basis), upcomingTrend(item)]),
        el("span", { class: "cap-kind" }, [showText(item.type), categoryTag(item.category)]),
        el("span", { class: "cap-line" }, [headlineLink(item), alsoAffects(row, item)]),
        el("span", { class: "chip-row" }, [
          screenChips(item),
          slipTag(row.code, item),
          catalystRunwayChip(row, item),
        ]),
        guidanceLines(item),
      ]))),
    ]
    : [];
  const extraSlipped = unmatchedSlipped(row);
  const slippedBlock = extraSlipped.length
    ? [
      el("p", { class: "eyebrow", text: "Past guided date" }),
      el("ul", { class: "cap-events" }, extraSlipped.map((item) => el("li", { class: "cap-event" }, [
        el("span", { class: "cap-date", text: showText(item.originally_guided) }),
        el("span", { text: showText(item.item_headline) }),
        el("span", { class: "slip-tag", title: slipTitle(item), text: "Past guided date" }),
      ]))),
    ]
    : [];
  const partners = partnerEvents(row);
  const partnerBlock = partners.length
    ? [
      el("p", { class: "eyebrow", text: "Related events from partners" }),
      el("ul", { class: "cap-events" }, partners.map((item) => {
        const source = screenCodeFor(item.source_code);
        return el("li", { class: "cap-event" }, [
          el("span", { class: "cap-date", text: formatDate(item.date) }),
          el("button", {
            type: "button",
            class: "co-link",
            onClick: () => openScreenCompany(source),
            text: source,
          }),
          el("span", { text: showText(item.headline) }),
          el("span", { class: "place-label", text: showText(item.relation) }),
          item.note ? el("span", { class: "cap-date", text: showText(item.note) }) : null,
        ]);
      })),
    ]
    : [];
  const href = safeUrl(row.url);
  const link = href
    ? el("a", { href, target: "_blank", rel: "noopener noreferrer", text: "Exchange page" })
    : el("span", { text: "—" });
  return el("div", { class: "cap-expand" }, [
    el("p", { class: "cap-desc", text: showText(row.description) }),
    runwayBlock(row),
    el("p", { class: "eyebrow", text: "Events" }),
    events,
    ...upcoming,
    ...slippedBlock,
    ...partnerBlock,
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
  const visible = nodes.find((node) => node.tagName === "BUTTON" && node.getClientRects().length > 0);
  if (visible) visible.focus();
}

function renderTable(rows) {
  const columns = activeColumns();
  const table = el("table", { class: "register caps" });
  const head = el("thead");
  const headRow = el("tr");
  columns.forEach(([key, label]) => {
    const active = capsState.sortKey === key;
    const th = el("th", { scope: "col", title: COLUMN_TIPS[key] || "", "aria-sort": active ? (capsState.sortDir === "asc" ? "ascending" : "descending") : "none" });
    th.append(el("button", {
      type: "button",
      title: COLUMN_TIPS[key] || "",
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
      "data-cap-id": row.id,
      onClick: (event) => {
        if (event.target.closest("a, button, summary, input, select, label")) return;
        toggle(row.id);
      },
    });
    columns.forEach(([key], index) => {
      const cell = el("td", {}, [cellFor(row, key)]);
      if (index === 0) {
        cell.append(el("button", {
          type: "button",
          class: "detail-toggle",
          "data-cap-id": row.id,
          "aria-expanded": open ? "true" : "false",
          onClick: (event) => {
            event.stopPropagation();
            toggle(row.id);
          },
          text: open ? "Close" : "Details",
        }));
      }
      main.append(cell);
    });
    body.append(main);
    if (open) {
      const detail = el("tr", { class: "cap-detail" });
      detail.append(el("td", { colspan: String(columns.length) }, [expandBody(row)]));
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
      el("dl", { class: "cap-facts" }, activeColumns().filter(([key]) => key !== "name" && key !== "latest").map(([key, label]) => fact(label, cellFor(row, key)))),
      el("span", { class: "cap-latest" }, [
        el("span", { class: "eyebrow", text: "Latest material event" }),
        latestNode(row),
      ]),
    ]);
    const star = window.moonshotWatch ? window.moonshotWatch.star(row.code, row.name) : null;
    const card = el("article", { class: open ? "card cap-card is-open" : "card cap-card", "data-cap-id": row.id }, [
      star ? el("div", { class: "card-star" }, [star]) : null,
      button,
    ]);
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
    const pinned = window.moonshotWatch ? window.moonshotWatch.codes().length : 0;
    const title = capsState.watchOnly && !pinned ? "No companies pinned" : capsState.watchOnly ? "No pinned companies" : "No companies match";
    const detail = capsState.watchOnly && !pinned
      ? "Star a company to build a watchlist."
      : capsState.watchOnly
        ? "No pinned companies in this view."
        : "Clear the search, turn off Has upcoming, or set every filter back to All.";
    empty.replaceChildren(el("strong", { text: title }), el("p", { text: detail }));
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

function filterField(key, label, values, tip) {
  const select = el("select", { "data-cap-filter": key });
  select.append(el("option", { value: "all", text: "All" }), ...values.map((value) => el("option", { value, text: value })));
  select.value = capsState[key] || "all";
  select.addEventListener("change", () => {
    capsState[key] = select.value;
    select.closest(".field").classList.toggle("active", select.value !== "all");
    renderLists();
  });
  const field = el("label", { class: "field", title: tip || "" }, [label, select]);
  field.classList.toggle("active", (capsState[key] || "all") !== "all");
  return field;
}

function toggleField(id, label, key, text) {
  return el("label", { class: capsState[key] ? "field active" : "field" }, [
    label,
    el("button", {
      type: "button",
      class: "toggle-btn",
      id,
      "aria-pressed": capsState[key] ? "true" : "false",
      onClick: (event) => {
        capsState[key] = !capsState[key];
        event.currentTarget.setAttribute("aria-pressed", capsState[key] ? "true" : "false");
        event.currentTarget.closest(".field").classList.toggle("active", capsState[key]);
        renderLists();
      },
      text,
    }),
  ]);
}

function mountColumns() {
  const host = document.getElementById("smallcaps-columns");
  if (!host) return;
  const menu = el("div", { class: "columns-menu" });
  COLUMNS.forEach(([key, label]) => {
    const input = el("input", { type: "checkbox", value: key });
    input.checked = activeColumns().some(([column]) => column === key);
    input.disabled = key === "name";
    input.addEventListener("change", () => {
      const keys = [...menu.querySelectorAll("input:checked")].map((box) => box.value);
      if (!keys.includes("name")) keys.unshift("name");
      saveColumns(keys);
      renderLists();
    });
    menu.append(el("label", {}, [input, label]));
  });
  host.replaceChildren(el("details", { class: "columns-picker" }, [
    el("summary", { text: "Columns" }),
    menu,
  ]));
}

function mountFilters() {
  const keyFilters = [
    ["sector", "Sector", SECTOR_OPTIONS, "Oil and gas, mining, or another sector."],
    ["market", "Market", MARKET_OPTIONS, "Where the shares trade."],
    ["country", "Country", countryOptions, "Country of the project."],
  ];
  const moreFilters = [
    ["category", "Category", CATEGORY_OPTIONS, "Operational, capital and deals, or corporate."],
    ["exchange", "Exchange", choiceList(caps.map((row) => showText(row.exchange)), EXCHANGE_ORDER), "The listing venue."],
    ["band", "Market-cap band", choiceList(caps.map((row) => showText(row.band)), BAND_ORDER), "Size group from market value."],
    ["type", "Commodity", choiceList(caps.map((row) => showText(row.type)), []), "The commodity this company works in."],
    ["stage", "Stage", choiceList(caps.map((row) => stageKey(row.stage)), STAGE_ORDER), "How far the project has got."],
  ];
  document.getElementById("smallcaps-filters").replaceChildren(
    ...keyFilters.map((entry) => filterField(...entry)),
    toggleField("smallcaps-watch", "Watchlist", "watchOnly", "Watchlist"),
  );
  const more = document.getElementById("smallcaps-more");
  if (more) {
    more.replaceChildren(el("details", { class: "more-filters" }, [
      el("summary", { text: "More filters" }),
      el("div", { class: "fields" }, [
        ...moreFilters.map((entry) => filterField(...entry)),
        toggleField("smallcaps-upcoming", "Upcoming", "hasUpcoming", "Has upcoming"),
        toggleField("smallcaps-background", "Background", "showBackground", "Show background"),
      ]),
    ]));
  }
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
  const allowed = ["events", "smallcaps", "coming", "countries", "watchlist"];
  const next = allowed.includes(mapped) ? mapped : "events";
  document.documentElement.dataset.view = next;
  document.body.dataset.view = next;
  ["smallcaps", "coming", "countries", "watchlist"].forEach((id) => {
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
    const target = next === "smallcaps" ? ["#smallcaps", "Skip to screen"] : next === "coming" ? ["#coming", "Skip to coming up"] : next === "countries" ? ["#countries", "Skip to countries"] : next === "watchlist" ? ["#watchlist", "Skip to watchlist"] : ["#timeline", "Skip to timeline"];
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

async function loadText(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(path);
  return response.text();
}

async function loadCaps() {
  const [data, companies, events, summary, across, slippedRows, pilotCompanies, pilotEvents, falklands, namibia, guyana, southAfrica, gabon, angola, colombia] = await Promise.all([
    loadJson("data/smallcaps.json"),
    loadJson("data/norway_companies.json"),
    loadJson("data/norway_events.json"),
    loadJson("data/smallcaps_reaction_summary.json"),
    loadJson("data/read_across.json"),
    loadJson("data/slipped.json"),
    loadText("data/companies.csv"),
    loadText("data/events.csv"),
    loadJson("data/falklands.json"),
    loadJson("data/namibia.json"),
    loadJson("data/guyana.json"),
    loadJson("data/south_africa.json"),
    loadJson("data/gabon.json"),
    loadJson("data/angola.json"),
    loadJson("data/colombia.json"),
  ]);
  if (!Array.isArray(data) || !Array.isArray(companies) || !Array.isArray(events)) throw new Error("smallcaps");
  readAcross = Array.isArray(across) ? across : [];
  slipped = Array.isArray(slippedRows) ? slippedRows : [];
  indexCountries([falklands, namibia, guyana, southAfrica, gabon, angola, colombia]);
  caps = foldPilots(foldNorway(data.map(normalize), companies, events), rowsToObjects(pilotCompanies), rowsToObjects(pilotEvents));
  assignCountries(caps);
  document.getElementById("smallcaps-loading").hidden = true;
  renderReactions(summary);
  capsState.columns = storedColumns();
  mountFilters();
  mountColumns();
  mountSort();
  if (window.moonshotWireDisclosures) window.moonshotWireDisclosures(document.getElementById("smallcaps"));
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
  capsState.category = "all";
  capsState.country = "all";
  capsState.exchange = "all";
  capsState.band = "all";
  capsState.type = "all";
  capsState.stage = "all";
  capsState.hasUpcoming = false;
  capsState.showBackground = false;
  capsState.watchOnly = false;
  const search = document.getElementById("smallcaps-search");
  if (search) {
    search.value = "";
    search.closest(".field").classList.toggle("active", false);
  }
  document.querySelectorAll("#smallcaps-filters select, #smallcaps-more select").forEach((select) => {
    select.value = "all";
    select.closest(".field").classList.toggle("active", false);
  });
  const upcoming = document.getElementById("smallcaps-upcoming");
  if (upcoming) upcoming.setAttribute("aria-pressed", "false");
  const background = document.getElementById("smallcaps-background");
  if (background) background.setAttribute("aria-pressed", "false");
  const watch = document.getElementById("smallcaps-watch");
  if (watch) {
    watch.setAttribute("aria-pressed", "false");
    const field = watch.closest(".field");
    if (field) field.classList.remove("active");
  }
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
  applyTab(initial === "smallcaps" || initial === "coming" || initial === "countries" || initial === "watchlist" ? initial : "events", false);
  if (window.moonshotWatch) {
    window.moonshotWatch.subscribe(() => {
      if (!caps.length) return;
      renderLists();
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const active = document.activeElement;
    if (!active || !active.closest || !active.closest("#smallcaps")) return;
    const host = active.closest("[data-cap-id]");
    if (!host) return;
    const id = host.getAttribute("data-cap-id");
    if (!id || !capsState.open.has(id)) return;
    event.preventDefault();
    toggle(id);
  });
  loadCaps().catch(showCapsError);
}

if (typeof document !== "undefined") boot();
