const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PAGE = 100;
const RANGES = [["30", "Last 30 days"], ["90", "Last 90 days"], ["12m", "Last 12 months"], ["all", "All"], ["upcoming", "Upcoming"]];
const BANDS = [
  ["all", "All"],
  ["micro", "Micro (US$5-100M)"],
  ["main", "Main (US$100M-5B)"],
  ["large", "Large"],
  ["private", "Private"],
];
const MARKETS = ["London", "ASX", "Norway", "Nordic", "Tel Aviv", "Paris", "Frankfurt", "Milan", "Amsterdam", "TSX"];
const SCREEN_PILOTS = new Set(["LUN", "MAU", "FDY", "LUNR", "ORRON", "FWZ", "LUG", "NGEX"]);
const CATEGORIES = ["Operational", "Capital and deals", "Corporate"];
const SECTOR_ORDER = ["Oil and gas", "Mining", "Royalty and stream", "Renewables"];
const RISK_LABELS = {
  geology: "Geology",
  engineering: "Engineering",
  "permits-legal": "Permits and legal",
  funding: "Funding",
  execution: "Execution",
  commercial: "Commercial",
};
const PILOT_SECTORS = {
  mining: "Mining",
  oil_gas: "Oil and gas",
  "mining (royalty/stream)": "Royalty and stream",
  renewables: "Renewables",
};

const state = {
  q: "",
  significance: "material",
  direction: "all",
  status: "all",
  confidence: "all",
  range: "12m",
  band: "all",
  types: [],
  sector: "all",
  market: "all",
  category: "all",
  country: "all",
  background: false,
  watchOnly: false,
  chartAll: false,
  chartFocus: "",
  chartOpen: true,
  chartSort: "next",
  briefKey: "",
  briefIds: null,
  shown: PAGE,
  open: new Set(),
};

let events = [];
let upcoming = [];
let fundingByCode = new Map();
let screenProfiles = [];
let typeOptions = [];
let sectorOptions = [];
let countryOptions = [];
let screenCodes = new Set();
let linkCodes = new Set();
let across = [];
let chartRows = [];
let nextCatalyst = new Map();
let latestMaterial = new Map();
let chartTimer = 0;
let chartDirty = false;
let chartStamp = "";

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
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((header, i) => { obj[header] = (cells[i] ?? "").trim(); });
    return obj;
  });
}

function nameKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll("&", "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(incorporated|corporation|corp|limited|ltd|plc|inc|asa|ab|lp|llc|oyj|se|sa|ag|nv)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesClose(a, b) {
  const left = nameKey(a);
  const right = nameKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (shorter.length < 6) return false;
  return ` ${longer} `.includes(` ${shorter} `);
}

function bareCode(code) {
  return String(code || "").replace(/\.(OL|ST|HE)$/i, "");
}

let splitRoots = new Set();

function rememberSplitRoots(profiles) {
  const forms = new Map();
  profiles.forEach((profile) => {
    const full = String(profile.code || "").trim();
    const root = bareCode(full).toUpperCase();
    if (!root) return;
    if (!forms.has(root)) forms.set(root, new Set());
    forms.get(root).add(full.toUpperCase());
  });
  splitRoots = new Set();
  forms.forEach((fulls, root) => {
    if (fulls.size > 1) splitRoots.add(root);
  });
}

function codesMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const left = bareCode(a);
  const right = bareCode(b);
  if (!left || left !== right) return false;
  if (splitRoots.has(left.toUpperCase())) return false;
  return true;
}

function normHead(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function headlineScore(a, b) {
  const left = normHead(a);
  const right = normHead(b);
  if (!left || !right) return 0;
  if (left === right) return 100;
  if (left.includes(right) || right.includes(left)) return 80;
  const words = (text) => new Set(text.split(" ").filter((word) => word.length > 4));
  const leftWords = words(left);
  const rightWords = words(right);
  let shared = 0;
  leftWords.forEach((word) => { if (rightWords.has(word)) shared += 1; });
  return shared >= 3 ? shared : 0;
}

function displayType(value) {
  const text = showText(value);
  if (text === "—") return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function sectorOfType(type) {
  const text = String(type || "").replace(/ \(low confidence\)$/, "").trim();
  return text === "Oil and gas" ? "Oil and gas" : "Mining";
}

function listingMarket(exchange) {
  const text = String(exchange || "").toLowerCase();
  if (exchange === "ASX") return "ASX";
  if (text.includes("tel aviv")) return "Tel Aviv";
  if (["stockholm", "first north", "helsinki", "oslo børs", "oslo bors", "euronext growth oslo"].some((venue) => text.includes(venue))) return "Nordic";
  if (text.includes("euronext paris") || text.includes("euronext growth paris")) return "Paris";
  if (text.includes("frankfurt") || text.includes("xetra")) return "Frankfurt";
  if (text.includes("euronext milan") || text.includes("borsa italiana")) return "Milan";
  if (text.includes("euronext amsterdam")) return "Amsterdam";
  return "London";
}

function bandKeyFromLabel(label) {
  const text = String(label || "");
  if (text.startsWith("Micro")) return "micro";
  if (text.startsWith("Main")) return "main";
  return "";
}

function bandFromCap(cap) {
  const number = Number(cap);
  if (!Number.isFinite(number)) return "";
  if (number >= 5000) return "large";
  if (number >= 100) return "main";
  if (number >= 5) return "micro";
  return "";
}

function norwayBand(company) {
  const own = String(company.ownership_type || "").toLowerCase();
  const listing = String(company.listing_ticker || "").toLowerCase();
  if (own.startsWith("private") || own === "state" || listing.includes("unlisted")) return "private";
  return "large";
}

function tickerFromListing(listing) {
  const text = String(listing || "").trim();
  if (!text || /unlisted/i.test(text) || !text.includes(":")) return "";
  const symbol = text.split(":").pop().trim();
  if (!symbol || symbol.includes(",") || symbol.includes("(") || symbol.length > 8) return "";
  if (!/^[A-Za-z0-9.]+$/.test(symbol)) return "";
  return symbol.toUpperCase();
}

function precisionOf(raw, confidence) {
  const conf = String(confidence || "").toLowerCase();
  if (conf === "month" || conf === "quarter" || conf === "half" || conf === "year") return conf;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw || "").trim())) return "month";
  return "day";
}

function parseDate(raw, confidence) {
  const match = String(raw || "").trim().match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!match) return null;
  const day = match[3] || "15";
  return {
    precision: precisionOf(raw, confidence),
    sort: `${match[1]}-${match[2]}-${day.padStart(2, "0")}`,
  };
}

function formatSort(sort, precision) {
  const match = String(sort || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "—";
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return "—";
  if (precision === "year") return match[1];
  if (precision === "half") return `${Number(match[2]) <= 6 ? "H1" : "H2"} ${match[1]}`;
  if (precision === "quarter") return `Q${Math.floor((Number(match[2]) - 1) / 3) + 1} ${match[1]}`;
  if (precision === "month") return `${month} ${match[1]}`;
  return `${Number(match[3])} ${month} ${match[1]}`;
}

function datesClose(sort, precision, other) {
  const parsed = parseDate(other, "");
  if (!parsed || !sort) return false;
  if (precision === "month" || parsed.precision === "month") return sort.slice(0, 7) === parsed.sort.slice(0, 7);
  return sort === parsed.sort;
}

function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function shiftDays(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shiftMonths(iso, months) {
  const [year, month, day] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const dim = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const date = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, dim)));
  return date.toISOString().slice(0, 10);
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
  return `${number < 0 ? "−" : ""}${text.replace(/^[+-]/, "")}%`;
}

function moveNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function moveSet(event) {
  if (!event) return null;
  const moves = { r5: moveNumber(event.r5), r20: moveNumber(event.r20), r60: moveNumber(event.r60) };
  if (moves.r5 == null && moves.r20 == null && moves.r60 == null) return null;
  return moves;
}

function reactionText(event, market) {
  const values = [event.r5, event.r20, event.r60];
  const numeric = values.map((value) => (value == null || value === "" ? null : Number(value)));
  if (!numeric.some((value) => Number.isFinite(value))) return "";
  if (market === "Nordic" && numeric.every((value) => value == null || !Number.isFinite(value))) return "";
  const cell = (value) => (value == null || value === "" || !Number.isFinite(Number(value)) ? "-" : pctLabel(value));
  return `5-day ${cell(event.r5)}. 20-day ${cell(event.r20)}. 60-day ${cell(event.r60)}.`;
}

function indexCountries(files) {
  const map = new Map();
  files.forEach((file) => {
    const country = file && file.country;
    if (!country) return;
    (file.companies || []).forEach((company) => {
      const codes = [];
      if (company.code) codes.push(company.code);
      (company.interests || []).forEach((interest) => {
        if (interest && interest.code) codes.push(interest.code);
      });
      codes.forEach((code) => {
        const key = String(code).trim();
        if (!key) return;
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(country);
      });
    });
  });
  return map;
}

function profileNamed(profile, name) {
  if (!name) return false;
  return [profile.shortName, profile.name, profile.label].some((value) => namesClose(value, name));
}

function profileByCode(profiles, code, name) {
  const wanted = String(code || "").trim();
  if (!wanted) return null;
  const root = bareCode(wanted).toUpperCase();
  const family = profiles.filter((profile) => bareCode(profile.code).toUpperCase() === root);
  if (!family.length) return null;
  if (family.length === 1) return family[0];
  const named = name ? family.find((profile) => profileNamed(profile, name)) : null;
  if (named) return named;
  return family.find((profile) => profile.code === wanted) || null;
}

function findProfile(profiles, name) {
  const key = nameKey(name);
  if (!key) return null;
  const exact = profiles.find((profile) => [profile.shortName, profile.name, profile.label].some((value) => nameKey(value) === key));
  if (exact) return exact;
  for (const profile of profiles) {
    if (namesClose(profile.name, name) || namesClose(profile.label, name) || namesClose(profile.shortName, name)) return profile;
  }
  return null;
}

function parentPhrase(parent) {
  if (!parent || typeof parent !== "object") return "";
  const name = showText(parent.name).replace(/\s+(ASA|AB|plc|SE|AG|S\.A\.|SA)$/i, "").trim();
  const ticker = showText(parent.ticker);
  if (!name || name === "—") return "";
  return ticker && ticker !== "—" ? `${name} (${ticker})` : name;
}

function withIdentity(profile, listingStatus, parentListed, legalName) {
  profile.listingStatus = listingStatus || profile.listingStatus || "";
  profile.parentListed = parentListed || profile.parentListed || null;
  const phrase = parentPhrase(profile.parentListed);
  if (String(profile.listingStatus).toLowerCase() === "subsidiary of listed" && phrase && legalName) {
    profile.label = `${legalName}, part of ${phrase}`;
  }
  return profile;
}

function blankProfile(name) {
  return {
    name,
    label: name,
    code: "",
    band: "",
    markets: [],
    sector: "",
    countries: [],
    onScreen: false,
  };
}

function assignCountries(profiles, countryIndex) {
  profiles.forEach((profile) => {
    const found = countryIndex.get(profile.code);
    profile.countries = found ? [...found] : [];
  });
}

function buildProfiles(screen, norwayCompanies, countryIndex) {
  const profiles = screen.map((row) => ({
    name: row.name,
    shortName: row.name,
    label: row.name,
    code: row.code || "",
    band: bandKeyFromLabel(row.band),
    markets: [listingMarket(row.exchange)],
    sector: sectorOfType(row.type),
    countries: [],
    onScreen: true,
    listingStatus: "listed",
    parentListed: null,
  }));
  norwayCompanies.forEach((company) => {
    const listedCode = tickerFromListing(company.listing_ticker);
    const code = listedCode || String(company.short_name || "").trim();
    const existing = (listedCode && (profileByCode(profiles, listedCode, company.short_name) || profileByCode(profiles, listedCode, company.name)))
      || (!listedCode && (findProfile(profiles, company.short_name) || findProfile(profiles, company.name)));
    if (existing) {
      if (!existing.markets.includes("Norway")) existing.markets.push("Norway");
      if (!existing.band) existing.band = norwayBand(company);
      if (!existing.code) existing.code = code;
      if (!existing.shortName) existing.shortName = company.short_name || "";
      return;
    }
    const profile = {
      name: company.name,
      shortName: company.short_name || company.name,
      label: company.short_name || company.name,
      code,
      band: norwayBand(company),
      markets: ["Norway"],
      sector: "Oil and gas",
      countries: [],
      onScreen: true,
      listingStatus: company.listing_status || "",
      parentListed: company.parent_listed || null,
    };
    profiles.push(withIdentity(profile, company.listing_status, company.parent_listed, company.name));
  });
  assignCountries(profiles, countryIndex);
  rememberSplitRoots(profiles);
  return profiles;
}

function classify(material, setback, isUpcoming) {
  const flags = { material: !!material, setback: !!setback, background: false };
  flags.background = !flags.material && !flags.setback && !isUpcoming;
  return flags;
}

function labelFields(raw) {
  const record = raw && typeof raw === "object" ? raw : {};
  const level = String(record.date_confidence_level || record.dateConfidence || "").toLowerCase();
  const rawConfidence = String(record.date_confidence || "").toLowerCase();
  const confidence = ["high", "medium", "low"].includes(level)
    ? level
    : (["high", "medium", "low"].includes(rawConfidence) ? rawConfidence : "");
  return {
    eventType: record.event_type || record.eventType || "",
    direction: String(record.direction || "").toLowerCase(),
    significance: String(record.significance || "").toLowerCase(),
    significanceReason: record.significance_reason || record.significanceReason || "",
    status: String(record.status || "").toLowerCase(),
    dateConfidence: confidence,
  };
}

function sourceFields(raw) {
  const record = raw && typeof raw === "object" ? raw : {};
  const list = [];
  const add = (url) => {
    const text = String(url || "").trim();
    if (text && !list.includes(text)) list.push(text);
  };
  if (Array.isArray(record.sources)) {
    record.sources.forEach((entry) => {
      if (typeof entry === "string") add(entry);
      else if (entry && typeof entry === "object") add(entry.url || entry.href);
    });
  }
  add(record.source_url);
  add(record.sourceUrl);
  const revisions = Array.isArray(record.revisions)
    ? record.revisions.filter((entry) => entry && typeof entry === "object")
    : [];
  const status = String(record.source_status || record.sourceStatus || "").trim().toLowerCase();
  const level = String(record.source_link_level || record.sourceLevel || "").trim().toLowerCase();
  return {
    sourceUrl: list[0] || "",
    sources: list,
    sourceStatus: status || (list.length ? "primary" : "missing"),
    sourceLevel: level || (list.length ? "document" : "none"),
    lastChecked: record.last_checked || record.lastChecked || "",
    revisions,
    rawId: record.id || record.rawId || "",
  };
}

function rowShell(id, when, companies, fields) {
  const packed = sourceFields(fields);
  return {
    id,
    sort: when.sort,
    precision: when.precision,
    companies,
    type: fields.type || "",
    category: fields.category || "",
    headline: fields.headline || "",
    sourceUrl: fields.sourceUrl || packed.sourceUrl,
    sources: fields.sources || packed.sources,
    sourceStatus: fields.sourceStatus || packed.sourceStatus,
    sourceLevel: fields.sourceLevel || packed.sourceLevel,
    lastChecked: fields.lastChecked || packed.lastChecked,
    revisions: fields.revisions || packed.revisions,
    rawId: fields.rawId || packed.rawId,
    affects: [],
    pilots: [],
    reaction: fields.reaction || "",
    moves: fields.moves || null,
    note: fields.note || "",
    slip: "",
    eventType: fields.eventType || "",
    direction: fields.direction || "",
    significance: fields.significance || "",
    significanceReason: fields.significanceReason || "",
    status: fields.status || "",
    dateConfidence: fields.dateConfidence || "",
    whatChanged: fields.whatChanged || null,
    guidanceHistory: fields.guidanceHistory || [],
    guidanceTrend: fields.guidanceTrend || "",
    ...classify(fields.material, fields.setback, fields.upcoming),
  };
}

function affectsFor(readAcross, companies, sort, precision, headline) {
  const codes = [];
  readAcross.forEach((item) => {
    const hit = companies.some((company) => codesMatch(company.code, item.source_code));
    if (!hit || !datesClose(sort, precision, item.date) || !headlineScore(headline, item.headline)) return;
    (item.affected_codes || []).forEach((code) => {
      const shown = String(code || "").trim();
      if (shown && !codes.includes(shown)) codes.push(shown);
    });
  });
  return codes;
}

function slipTitle(slipped, companies, headline, sort, precision) {
  const record = slipped.find((item) => companies.some((company) => codesMatch(company.code, item.code)) && headlineScore(item.item_headline, headline));
  if (record) return `Originally guided: ${showText(record.originally_guided)}. Checked ${formatSort(parseDate(record.checked_date, "exact")?.sort, "day")}.`;
  if ((precision === "day" || precision === "exact") && sort < todayIso()) return "This guided date has passed.";
  if (precision === "month" && sort.slice(0, 7) < todayIso().slice(0, 7)) return "This guided date has passed.";
  return "";
}

function buildTimeline(screen, norwayEvents, norwayCompanies, pilotRows, pilotCompanies, countryFiles, readAcross, slipped, coming) {
  const countryIndex = indexCountries(countryFiles);
  const profiles = buildProfiles(screen, norwayCompanies, countryIndex);
  const byTicker = new Map(pilotCompanies.map((company) => [company.ticker, company]));
  const rows = [];

  screen.forEach((company) => {
    const profile = profileByCode(profiles, company.code, company.name) || (!company.code && findProfile(profiles, company.name)) || blankProfile(company.name);
    (company.events || []).forEach((event, index) => {
      const when = parseDate(event.date, "exact");
      if (!when) return;
      const setback = event.setback === true || event.setback === "Y";
      rows.push(rowShell(`s:${company.code}:${event.date}:${index}`, when, [profile], {
        type: displayType(event.type),
        category: event.category || "",
        headline: event.headline || "",
        material: !setback,
        setback,
        reaction: reactionText(event, profile.markets[0]),
        moves: moveSet(event),
        ...sourceFields(event),
        ...labelFields(event),
        whatChanged: event.what_changed || null,
      }));
    });
  });

  norwayEvents.forEach((event) => {
    const when = parseDate(event.date, event.date_confidence || "exact");
    if (!when) return;
    const names = [];
    const pushName = (name) => {
      const text = String(name || "").trim();
      if (text && !names.some((item) => namesClose(item, text))) names.push(text);
    };
    (event.companies || []).forEach(pushName);
    pushName(event.operator);
    const companies = names.map((name) => findProfile(profiles, name) || { ...blankProfile(name), markets: ["Norway"], sector: "Oil and gas" });
    const upcomingFlag = event.upcoming === "Y";
    rows.push(rowShell(`n:${event.id || event.date}`, when, companies, {
      type: displayType(event.type),
      category: event.category || "",
      headline: event.title || "",
      material: event.material === "Y",
      setback: event.setback === "Y",
      upcoming: upcomingFlag,
      note: event.note || "",
      ...sourceFields(event),
      ...labelFields(event),
      whatChanged: event.what_changed || null,
    }));
  });

  pilotRows.forEach((row, index) => {
    const when = parseDate(row.date, row.date && /^\d{4}-\d{2}$/.test(row.date) ? "month" : "exact");
    if (!when) return;
    const meta = byTicker.get(row.ticker);
    let profile = profileByCode(profiles, row.ticker, row.company) || (!row.ticker && findProfile(profiles, row.company));
    if (!profile) {
      const exchange = meta && meta.exchange;
      const markets = [];
      const venue = String(exchange || "").toLowerCase();
      if (venue.includes("stockholm") || venue.includes("oslo") || venue.includes("helsinki")) markets.push("Nordic");
      if (venue.includes("tsx") || venue.includes("toronto")) markets.push("TSX");
      if (venue.includes("london") || venue.includes("aim")) markets.push("London");
      if (venue.includes("asx")) markets.push("ASX");
      profile = {
        name: row.company,
        shortName: row.company,
        label: row.company,
        code: row.ticker,
        band: bandFromCap(meta && meta.market_cap_usd_m),
        markets,
        sector: PILOT_SECTORS[meta && meta.sector] || "",
        countries: [],
        onScreen: SCREEN_PILOTS.has(row.ticker),
        listingStatus: "listed",
        parentListed: null,
      };
      profiles.push(profile);
    }
    const pilot = {
      asset: row.asset || "",
      risk: RISK_LABELS[row.risk_removed] || displayType(row.risk_removed),
      stage: row.stage || "",
      status: row.status === "happened" ? "Happened" : row.status === "expected" ? "Expected" : displayType(row.status),
      market: row.market_status || "",
      material: row.material === "Y" ? "Y" : "N",
      trap: row.trap === "Y" ? "Y" : "N",
      trapReason: row.trap_reason || "",
      gate: row.gate_pass === "Y" ? "Y" : "N",
      exit: row.exit === "Y" ? "Y" : "N",
      runup60: row.runup_60d || "",
      excess20: row.excess_20d || "",
      excess3m: row.excess_3m || "",
      sizeEst: row.size_est_pct || "",
      confidence: String(row.confidence || "").toLowerCase(),
      announced: row.announced_date || "",
      notes: row.label_notes || "",
      sourceUrl: row.source_url || "",
    };
    let host = null;
    let best = 0;
    rows.forEach((item) => {
      const sameCompany = item.companies.includes(profile);
      if (!sameCompany || !datesClose(item.sort, item.precision, row.date)) return;
      const score = headlineScore(item.headline, row.what_happened);
      if (score > best) { host = item; best = score; }
    });
    if (host) {
      host.pilots.push(pilot);
      if (!host.sourceUrl && pilot.sourceUrl) host.sourceUrl = pilot.sourceUrl;
      if ((!host.sources || !host.sources.length) && row.source_url) Object.assign(host, sourceFields(row));
      return;
    }
    const made = rowShell(`p:${row.ticker}:${row.date}:${index}`, when, [profile], {
      type: pilot.risk,
      headline: row.what_happened || "",
      material: row.material === "Y",
      setback: String(row.direction || "").toLowerCase() === "negative",
      ...sourceFields(row),
      ...labelFields(row),
    });
    made.pilots.push(pilot);
    rows.push(made);
  });

  rememberSplitRoots(profiles);
  screenProfiles = profiles.filter((profile) => profile.onScreen || (profile.code && screenCodes.has(profile.code)));
  rows.forEach((item) => {
    item.affects = affectsFor(readAcross, item.companies, item.sort, item.precision, item.headline);
  });
  rows.sort((a, b) => b.sort.localeCompare(a.sort) || showText(a.companies[0] && a.companies[0].label).localeCompare(showText(b.companies[0] && b.companies[0].label)) || a.id.localeCompare(b.id));

  const forward = (coming.items || []).map((item) => {
    const sortRaw = item.sort_date || item.anchor;
    const when = parseDate(sortRaw, item.precision || "exact");
    if (!when) return null;
    const profile = profileByCode(profiles, item.company_code, item.company_name) || findProfile(profiles, item.company_name) || {
      ...blankProfile(item.company_name || item.company_code || "Company"),
      code: item.company_code || "",
      markets: item.market ? [item.market] : [],
      sector: item.sector || "",
      onScreen: screenCodes.has(item.company_code) || linkCodes.has(item.company_code),
    };
    if (!profile.countries.length) {
      const found = countryIndex.get(profile.code);
      if (found) profile.countries = [...found];
    }
    const row = rowShell(`u:${item.id}`, when, [profile], {
      type: displayType(item.type),
      category: item.category || "",
      headline: item.headline || "",
      material: item.material === "Y",
      setback: false,
      upcoming: true,
      ...sourceFields(item),
      ...labelFields(item),
    });
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(item.sort_date || ""))) row.sort = item.sort_date;
    row.dateBasis = item.date_basis || "";
    row.proxy = item.sort_date_is_proxy === true;
    row.windowText = item.date_window_text || "";
    row.affects = affectsFor(readAcross, row.companies, row.sort, row.precision, row.headline);
    row.slip = slipTitle(slipped, row.companies, row.headline, row.sort, item.precision || row.precision);
    row.label = row.proxy && row.windowText ? row.windowText : (item.date_label || formatSort(row.sort, row.precision));
    row.guidanceHistory = Array.isArray(item.guidance_history) ? item.guidance_history : [];
    row.guidanceTrend = item.guidance_trend || "";
    return row;
  }).filter(Boolean);
  forward.sort((a, b) => a.sort.localeCompare(b.sort) || a.id.localeCompare(b.id));

  const types = new Set();
  const sectors = new Set();
  rows.concat(forward).forEach((item) => {
    const kind = item.eventType || item.type;
    if (kind) types.add(kind);
    item.companies.forEach((company) => { if (company.sector) sectors.add(company.sector); });
  });
  const catalyst = new Map();
  forward.forEach((item) => {
    item.companies.forEach((company) => {
      const key = companyKey(company);
      const prev = catalyst.get(key);
      if (!prev || item.sort < prev) catalyst.set(key, item.sort);
    });
  });
  const materialDates = new Map();
  rows.forEach((item) => {
    const material = item.significance === "material" || item.material || item.setback || item.direction === "negative";
    if (!material) return;
    item.companies.forEach((company) => {
      const key = companyKey(company);
      const prev = materialDates.get(key);
      if (!prev || item.sort > prev) materialDates.set(key, item.sort);
    });
  });
  nextCatalyst = catalyst;
  latestMaterial = materialDates;
  return {
    events: rows,
    upcoming: forward,
    types: [...types].sort((a, b) => a.localeCompare(b, "en")),
    sectors: [...sectors].sort((a, b) => {
      const left = SECTOR_ORDER.indexOf(a);
      const right = SECTOR_ORDER.indexOf(b);
      return (left === -1 ? 99 : left) - (right === -1 ? 99 : right) || a.localeCompare(b);
    }),
    countries: countryFiles.map((file) => file.country).filter(Boolean),
  };
}

function dateOk(item, today) {
  if (!item.sort) return false;
  if (item.sort > today) return state.range === "all";
  if (state.range === "all") return true;
  if (state.range === "30") return item.sort >= shiftDays(today, -30);
  if (state.range === "90") return item.sort >= shiftDays(today, -90);
  return item.sort >= shiftMonths(today, -12);
}

function significanceOk(item) {
  const significance = item.significance || (item.background ? "background" : "material");
  const setback = item.direction === "negative" || item.setback;
  if (state.significance === "background") return significance === "background";
  if (state.significance === "all" || state.background) return true;
  return significance === "material" || setback;
}

function directionOk(item) {
  if (state.direction === "all") return true;
  const direction = item.direction || (item.setback ? "negative" : "");
  return direction === state.direction;
}

function statusOk(item) {
  if (state.status === "all") return true;
  return item.status === state.status;
}

function confidenceOk(item) {
  if (state.confidence === "all") return true;
  return item.dateConfidence === state.confidence;
}

function filtered() {
  const today = todayIso();
  const query = state.q.trim().toLowerCase();
  if (state.briefIds && state.briefIds.size) {
    return events.concat(upcoming).filter((item) => state.briefIds.has(item.rawId));
  }
  const source = state.range === "upcoming" ? upcoming : events;
  return source.filter((item) => {
    if (!significanceOk(item)) return false;
    if (!directionOk(item)) return false;
    if (!statusOk(item)) return false;
    if (!confidenceOk(item)) return false;
    if (state.range !== "upcoming" && !dateOk(item, today)) return false;
    if (state.band !== "all" && !item.companies.some((company) => company.band === state.band)) return false;
    const kind = item.eventType || item.type;
    if (state.types.length && !state.types.includes(kind)) return false;
    if (state.sector !== "all" && !item.companies.some((company) => company.sector === state.sector)) return false;
    if (state.market !== "all" && !item.companies.some((company) => company.markets.includes(state.market))) return false;
    if (state.category !== "all" && item.category !== state.category) return false;
    if (state.country !== "all" && !item.companies.some((company) => (company.countries || []).includes(state.country))) return false;
    if (state.watchOnly && !item.companies.some((company) => company.code && window.moonshotWatch && window.moonshotWatch.has(company.code))) return false;
    if (query) {
      const blob = [item.headline, ...item.companies.flatMap((company) => [company.label, company.name, company.code])].join(" ").replaceAll("&", "and").toLowerCase();
      if (!blob.includes(query)) return false;
    }
    return true;
  });
}

function isDefault() {
  return !state.q.trim() && !state.briefIds && state.significance === "material" && state.direction === "all" && state.status === "all" && state.confidence === "all" && state.range === "12m" && state.band === "all" && !state.types.length && state.sector === "all" && state.market === "all" && state.category === "all" && state.country === "all" && !state.background && !state.watchOnly;
}

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  state.q = params.get("q") || "";
  const significance = params.get("sig");
  const tier = params.get("tier");
  if (significance === "material" || significance === "background" || significance === "all") state.significance = significance;
  else if (tier === "background") state.significance = "background";
  else if (params.get("bg") === "1") state.significance = "all";
  else state.significance = "material";
  const direction = params.get("dir");
  state.direction = direction === "positive" || direction === "neutral" || direction === "negative" ? direction : (tier === "setback" ? "negative" : "all");
  const status = params.get("status");
  state.status = ["upcoming", "overdue", "slipped", "done"].includes(status) ? status : "all";
  const confidence = params.get("confidence");
  state.confidence = confidence === "high" || confidence === "medium" || confidence === "low" ? confidence : "all";
  state.background = state.significance === "all";
  const range = params.get("range");
  state.range = RANGES.some(([value]) => value === range) ? range : "12m";
  const band = params.get("band");
  state.band = BANDS.some(([value]) => value === band) ? band : "all";
  state.types = params.getAll("type").filter((type) => typeOptions.includes(type));
  const sector = params.get("sector");
  state.sector = sectorOptions.includes(sector) ? sector : "all";
  const market = params.get("market");
  state.market = MARKETS.includes(market) ? market : "all";
  const category = params.get("category");
  state.category = CATEGORIES.includes(category) ? category : "all";
  const country = params.get("country");
  state.country = countryOptions.includes(country) ? country : "all";
  state.shown = PAGE;
}

function writeUrl() {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.significance !== "material") params.set("sig", state.significance);
  if (state.direction !== "all") params.set("dir", state.direction);
  if (state.status !== "all") params.set("status", state.status);
  if (state.confidence !== "all") params.set("confidence", state.confidence);
  if (state.range !== "12m") params.set("range", state.range);
  if (state.band !== "all") params.set("band", state.band);
  state.types.forEach((type) => params.append("type", type));
  if (state.sector !== "all") params.set("sector", state.sector);
  if (state.market !== "all") params.set("market", state.market);
  if (state.category !== "all") params.set("category", state.category);
  if (state.country !== "all") params.set("country", state.country);
  if (state.background) params.set("bg", "1");
  const query = params.toString();
  const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  const current = window.location.pathname + window.location.search;
  if (next !== current) window.history.replaceState(null, "", next);
}

function fieldDefault(key) {
  if (key === "range") return "12m";
  if (key === "significance") return "material";
  return "all";
}

function selectField(key, label, choices, current, tip) {
  const select = el("select", { "data-filter": key, "aria-label": label, title: tip || "" });
  choices.forEach(([value, text]) => select.append(el("option", { value, text })));
  select.value = current;
  select.addEventListener("change", () => {
    state[key] = select.value;
    if (key === "significance") {
      state.background = state.significance === "all";
      const button = document.getElementById("events-background");
      if (button) {
        button.setAttribute("aria-pressed", state.background ? "true" : "false");
        const field = button.closest(".field");
        if (field) field.classList.toggle("active", state.background);
      }
    }
    state.shown = PAGE;
    state.chartAll = false;
    select.closest(".field").classList.toggle("active", select.value !== fieldDefault(key));
    writeUrl();
    render();
    paintMoreBadge();
  });
  const field = el("label", { class: "field", title: tip || "" }, [label, select]);
  field.classList.toggle("active", current !== fieldDefault(key));
  return field;
}

function typeSummary() {
  if (!state.types.length) return "All types";
  if (state.types.length === 1) return state.types[0];
  return `${state.types[0]} +${state.types.length - 1}`;
}

function mountFilters() {
  const search = el("input", {
    id: "event-search",
    type: "search",
    placeholder: "Company or headline",
    autocomplete: "off",
    enterkeyhint: "search",
    value: state.q,
  });
  search.addEventListener("input", () => {
    state.q = search.value;
    state.shown = PAGE;
    state.chartAll = false;
    search.closest(".field").classList.toggle("active", search.value.trim() !== "");
    writeUrl();
    render();
  });
  const searchField = el("label", { class: "field search" }, ["Search", search]);
  searchField.classList.toggle("active", state.q.trim() !== "");

  const summary = el("summary", { id: "type-summary", text: typeSummary() });
  const menu = el("div", { class: "multi-menu" });
  typeOptions.forEach((type) => {
    const input = el("input", { type: "checkbox", value: type });
    input.checked = state.types.includes(type);
    input.addEventListener("change", () => {
      state.types = [...menu.querySelectorAll("input:checked")].map((box) => box.value);
      state.chartAll = false;
      summary.textContent = typeSummary();
      menu.closest(".field").classList.toggle("active", state.types.length > 0);
      state.shown = PAGE;
      writeUrl();
      render();
      paintMoreBadge();
    });
    menu.append(el("label", {}, [input, type]));
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const boxes = [...menu.querySelectorAll("input")];
    const index = boxes.indexOf(document.activeElement);
    if (!boxes.length) return;
    event.preventDefault();
    const shift = event.key === "ArrowDown" ? 1 : -1;
    const next = boxes[(index + shift + boxes.length) % boxes.length];
    next.focus();
  });
  const typeField = el("div", { class: state.types.length ? "field type active" : "field type", title: "The kind of event." }, [
    "Event type",
    el("details", { class: "multi" }, [summary, menu]),
  ]);

  const background = el("button", {
    type: "button",
    class: "toggle-btn",
    id: "events-background",
    "aria-pressed": state.background ? "true" : "false",
    onClick: (event) => {
      state.background = !state.background;
      state.significance = state.background ? "all" : "material";
      state.chartAll = false;
      const significance = document.querySelector("[data-filter='significance']");
      if (significance) {
        significance.value = state.significance;
        significance.closest(".field").classList.toggle("active", state.significance !== "material");
      }
      event.currentTarget.setAttribute("aria-pressed", state.background ? "true" : "false");
      event.currentTarget.closest(".field").classList.toggle("active", state.background);
      state.shown = PAGE;
      writeUrl();
      render();
      paintMoreBadge();
    },
    text: "Show background",
  });

  const moreCount = hiddenFilterCount();
  document.getElementById("event-bar").replaceChildren(
    searchField,
    selectField("significance", "Significance", [["material", "Material"], ["all", "All"], ["background", "Background"]], state.significance, "Material events, or the routine background ones."),
    selectField("direction", "Direction", [["all", "All"], ["positive", "Positive"], ["neutral", "Neutral"], ["negative", "Setback"]], state.direction, "Whether the event helped, was neutral, or was a setback."),
    selectField("range", "Date", RANGES, state.range, "How far back, or the coming window."),
    selectField("sector", "Sector", [["all", "All"], ...sectorOptions.map((value) => [value, value])], state.sector),
    selectField("country", "Country", [["all", "All"], ...countryOptions.map((value) => [value, value])], state.country),
    el("label", { class: state.watchOnly ? "field active" : "field" }, [
      "Watchlist",
      el("button", {
        type: "button",
        class: "toggle-btn",
        id: "events-watch",
        "aria-pressed": state.watchOnly ? "true" : "false",
        onClick: (event) => {
          state.watchOnly = !state.watchOnly;
          state.chartAll = false;
          event.currentTarget.setAttribute("aria-pressed", state.watchOnly ? "true" : "false");
          event.currentTarget.closest(".field").classList.toggle("active", state.watchOnly);
          state.shown = PAGE;
          render();
        },
        text: "Watchlist",
      }),
    ]),
    el("details", { class: "more-filters", id: "events-more", open: moreCount ? true : undefined }, [
      el("summary", {}, [
        "More filters",
        moreCount ? el("span", { class: "filter-count", text: String(moreCount) }) : null,
      ]),
      el("div", { class: "fields event-more-fields" }, [
        selectField("status", "Status", [["all", "All"], ["upcoming", "Upcoming"], ["overdue", "Overdue"], ["slipped", "Slipped"], ["done", "Done"]], state.status, "Where a guided item stands."),
        selectField("confidence", "Date confidence", [["all", "All"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]], state.confidence, "How firmly the date is known. High, medium, or low."),
        selectField("band", "Market-cap band", BANDS, state.band, "Size group from market value."),
        typeField,
        selectField("market", "Market", [["all", "All"], ...MARKETS.map((value) => [value, value])], state.market),
        selectField("category", "Category", [["all", "All"], ...CATEGORIES.map((value) => [value, value])], state.category),
        el("label", { class: state.background ? "field active" : "field" }, ["Background", background]),
      ]),
    ]),
  );
  wireDisclosures(document.getElementById("event-bar"));
}

function hiddenFilterCount() {
  let count = 0;
  if (state.status !== "all") count += 1;
  if (state.confidence !== "all") count += 1;
  if (state.band !== "all") count += 1;
  if (state.types.length) count += 1;
  if (state.market !== "all") count += 1;
  if (state.category !== "all") count += 1;
  if (state.background) count += 1;
  return count;
}

function paintMoreBadge() {
  const summary = document.querySelector("#events-more summary");
  if (!summary) return;
  const count = hiddenFilterCount();
  summary.replaceChildren(document.createTextNode("More filters"));
  if (count) summary.append(el("span", { class: "filter-count", text: String(count) }));
}

function clearFilters() {
  state.q = "";
  state.briefKey = "";
  state.briefIds = null;
  const briefList = document.getElementById("briefingList");
  if (briefList) {
    briefList.hidden = true;
    briefList.replaceChildren();
  }
  document.querySelectorAll(".brief-hit").forEach((node) => node.classList.remove("is-on"));
  state.significance = "material";
  state.direction = "all";
  state.status = "all";
  state.confidence = "all";
  state.range = "12m";
  state.band = "all";
  state.types = [];
  state.sector = "all";
  state.market = "all";
  state.category = "all";
  state.country = "all";
  state.background = false;
  state.watchOnly = false;
  state.chartAll = false;
  state.chartFocus = "";
  state.shown = PAGE;
  state.open.clear();
  mountFilters();
  writeUrl();
  render();
}

function notListedTag(company) {
  const status = String(company.listingStatus || "").toLowerCase();
  if (status !== "private" && status !== "state") return null;
  return el("span", { class: "not-listed", title: "Private or state entity, with no stock-exchange listing.", text: "Not listed" });
}

function companyNode(company) {
  const body = [
    el("span", { class: "cap-name", text: showText(company.label || company.name) }),
    company.code ? el("span", { class: "co-ticker", text: showText(company.code) }) : null,
    notListedTag(company),
  ];
  if (!company.code || !(company.onScreen || linkCodes.has(company.code))) return el("span", { class: "tl-plain" }, body);
  return el("button", {
    type: "button",
    class: "co-link",
    onClick: (event) => {
      event.stopPropagation();
      if (typeof window.moonshotOpenScreen === "function") window.moonshotOpenScreen(company.code);
    },
  }, body);
}

function chip(text, kind, title, label) {
  return el("span", { class: `chip chip-${kind}`, title: title || "", "aria-label": label || text, text });
}

function directionChip(item) {
  const key = item.direction || (item.setback ? "negative" : "");
  if (key === "positive") return chip("Positive", "positive", "The event moved the asset forward.", "Direction: Positive");
  if (key === "neutral") return chip("Neutral", "neutral", "The event does not clearly help or hurt.", "Direction: Neutral");
  if (key === "negative") return chip("Setback", "setback", "A dry hole, a delay, or another step backward.", "Direction: Setback");
  return null;
}

function significanceChip(item) {
  const key = item.significance || (item.background ? "background" : (item.material ? "material" : ""));
  const reason = item.significanceReason ? showText(item.significanceReason) : "";
  if (key === "material") return chip("Material", "material", reason || "Large enough to matter for the company.", "Significance: Material");
  if (key === "background") return chip("Background", "background", reason || "A routine item, or too small to change the story.", "Significance: Background");
  return null;
}

function statusChip(status) {
  const key = String(status || "").toLowerCase();
  const labels = { upcoming: "Upcoming", overdue: "Overdue", slipped: "Slipped", done: "Done" };
  if (!labels[key]) return null;
  return chip(labels[key], key, "Where this guided item stands.", `Status: ${labels[key]}`);
}

function confidenceChip(level) {
  const key = String(level || "").toLowerCase();
  const labels = { high: "High", medium: "Medium", low: "Low" };
  if (!labels[key]) return null;
  return chip(labels[key], `conf-${key}`, "How firmly the date is known.", `Date confidence: ${labels[key]}`);
}

function typeChip(item) {
  const text = showText(item.eventType || item.type);
  if (!text || text === "—") return null;
  return chip(text, "type", "The kind of event.");
}

function tagNodes(item) {
  return [
    typeChip(item),
    item.category ? el("span", { class: "cat-tag", title: "Operational, capital and deals, or corporate.", text: showText(item.category) }) : null,
    directionChip(item),
    significanceChip(item),
    statusChip(item.status),
    confidenceChip(item.dateConfidence),
    item.affects.length ? el("span", { class: "also-tag", text: `Also affects: ${item.affects.join(", ")}` }) : null,
    item.slip ? el("span", { class: "slip-tag", title: item.slip, text: "Past guided date" }) : null,
  ];
}

function sourceLink(url, label) {
  const href = safeUrl(url);
  if (!href) return null;
  return el("a", {
    href,
    target: "_blank",
    rel: "noopener noreferrer",
    onClick: (event) => event.stopPropagation(),
    text: label || "Source",
  });
}

function checkedLine(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const parsed = parseDate(text, "exact");
  return parsed ? `Checked ${formatSort(parsed.sort, "day")}` : `Checked ${showText(text)}`;
}

function sourceBadgeLabel(item) {
  const status = String(item.sourceStatus || "").toLowerCase();
  const level = String(item.sourceLevel || "").toLowerCase();
  const href = safeUrl(item.sourceUrl);
  if (status === "missing" || !href) return { label: "Missing", kind: "missing", href: "" };
  if (level === "listing page") return { label: "Listing page", kind: "listing", href };
  if (status === "secondary") return { label: "Secondary", kind: "secondary", href };
  return { label: "Primary", kind: "primary", href };
}

function sourceBadge(item) {
  const badge = sourceBadgeLabel(item);
  const checked = checkedLine(item.lastChecked);
  const title = checked || (badge.kind === "missing" ? "No source on file" : badge.label);
  if (!badge.href) {
    return el("span", { class: `src-badge src-${badge.kind}`, title, text: badge.label });
  }
  return el("a", {
    class: `src-badge src-${badge.kind}`,
    href: badge.href,
    target: "_blank",
    rel: "noopener noreferrer",
    title,
    "aria-label": checked ? `${badge.label}. ${checked}. Opens in a new tab.` : `${badge.label}. Opens in a new tab.`,
    onClick: (event) => event.stopPropagation(),
    text: badge.label,
  });
}

function sourceList(item) {
  const urls = item.sources && item.sources.length ? item.sources : (item.sourceUrl ? [item.sourceUrl] : []);
  const parts = [];
  const checked = checkedLine(item.lastChecked);
  if (checked) parts.push(el("p", { class: "label-notes", text: checked }));
  if (urls.length) {
    parts.push(el("p", { class: "eyebrow", text: urls.length > 1 ? "Sources" : "Source" }));
    parts.push(el("ul", { class: "source-list" }, urls.map((url) => {
      const link = sourceLink(url, showText(url).replace(/^https?:\/\//, ""));
      return el("li", {}, [link || el("span", { class: "muted-gap", text: "Missing" })]);
    })));
  } else {
    parts.push(el("p", { class: "label-notes", text: "No source on file." }));
  }
  if (item.revisions && item.revisions.length) {
    parts.push(el("p", { class: "eyebrow", text: "Merged revisions" }));
    parts.push(el("ul", { class: "source-list" }, item.revisions.map((revision) => {
      const when = parseDate(revision.date, "exact");
      const bits = [
        when ? formatSort(when.sort, "day") : "",
        showText(revision.type),
        showText(revision.headline),
      ].filter((bit) => bit && bit !== "—");
      const link = sourceLink(revision.source_url, "Source");
      return el("li", {}, [
        el("span", { text: bits.join(". ") }),
        link ? el("span", {}, [" ", link]) : null,
      ]);
    })));
  }
  return parts;
}

function fact(key, value, extra) {
  return el("span", { class: extra ? `fact ${extra}` : "fact" }, [
    el("span", { class: "k", text: key }),
    value,
  ]);
}

function pilotBlock(pilot) {
  const trap = pilot.trap === "Y" && pilot.trapReason ? `Yes. ${showText(pilot.trapReason)}` : ynLabel(pilot.trap);
  const confidence = pilot.confidence === "low" ? "Low" : pilot.confidence === "medium" ? "Medium" : pilot.confidence === "high" ? "High" : "—";
  const strip = el("div", { class: "label-strip" }, [
    fact("Asset", showText(pilot.asset)),
    fact("Risk removed", showText(pilot.risk)),
    fact("Stage reached", showText(pilot.stage)),
    fact("Status", showText(pilot.status)),
    fact("Market status", showText(pilot.market)),
    fact("Gate", ynLabel(pilot.gate), pilot.gate === "Y" ? "is-gate" : ""),
    fact("Material", ynLabel(pilot.material)),
    fact("Trap", trap, pilot.trap === "Y" && pilot.trapReason ? "is-long" : ""),
    fact("Exit", ynLabel(pilot.exit), pilot.exit === "Y" ? "is-exit" : ""),
    fact("60-day run-up", pctLabel(pilot.runup60)),
    fact("20-day excess", pctLabel(pilot.excess20)),
    fact("3-month excess", pctLabel(pilot.excess3m)),
    fact("Size estimate", pctLabel(pilot.sizeEst)),
    fact("Confidence", confidence, pilot.confidence === "low" ? "flag-low" : ""),
  ]);
  if (pilot.announced) strip.append(fact("Announced", formatSort(parseDate(pilot.announced, pilot.announced.length === 7 ? "month" : "exact")?.sort, pilot.announced.length === 7 ? "month" : "day")));
  const block = el("div", { class: "label-block" }, [strip]);
  if (pilot.notes) block.append(el("p", { class: "label-notes", text: showText(pilot.notes) }));
  if (pilot.sourceUrl) block.append(el("p", {}, [sourceLink(pilot.sourceUrl, "Pilot source")]));
  return block;
}

function moveLabel(value) {
  if (value == null) return "-";
  const body = Math.abs(value).toFixed(1);
  return value < 0 ? `−${body}` : body;
}

function partnerLines(item) {
  const codes = item.companies.map((company) => company.code).filter(Boolean);
  if (!codes.length || !across.length) return [];
  return across.filter((entry) => {
    const affected = entry.affected_codes || [];
    const hit = codes.some((code) => affected.some((other) => codesMatch(code, other)));
    if (!hit) return false;
    return datesClose(item.sort, item.precision, entry.date);
  });
}

function partnerBlock(entries) {
  const shown = entries.slice(0, 6);
  const list = el("ul", { class: "cap-events" }, shown.map((entry) => {
    const code = String(entry.source_code || "").trim();
    const parsed = parseDate(entry.date, "exact");
    const name = code && linkCodes.has(code)
      ? el("button", {
        type: "button",
        class: "co-link",
        onClick: (event) => {
          event.stopPropagation();
          if (typeof window.moonshotOpenScreen === "function") window.moonshotOpenScreen(code);
        },
        text: code,
      })
      : el("span", { class: "cap-code", text: showText(code) });
    return el("li", { class: "cap-event" }, [
      el("span", { class: "cap-date", text: parsed ? formatSort(parsed.sort, "day") : showText(entry.date) }),
      name,
      el("span", { text: showText(entry.headline) }),
      entry.relation ? el("span", { class: "place-label", text: showText(entry.relation) }) : null,
      entry.note ? el("span", { class: "cap-date", text: showText(entry.note) }) : null,
    ]);
  }));
  return el("div", {}, [
    el("p", { class: "eyebrow", text: "Related events from partners" }),
    list,
    entries.length > shown.length ? el("p", { class: "label-notes", text: `${entries.length - shown.length} more on this date.` }) : null,
  ]);
}

function trendChip(trend, status) {
  const key = String(trend || "").toLowerCase();
  if (key === "no update found") return chip("No update found", "trend-none", "The guided window has not moved in the notes on file.");
  const state = String(status || "").toLowerCase();
  if (state === "slipped" || state === "overdue") return null;
  if (key.includes("slipped")) return chip("Slipped", "slipped", "The guided window moved later.");
  if (!key) return null;
  return chip(showText(trend), "type", "");
}

function guidanceBlock(item) {
  const history = Array.isArray(item.guidanceHistory) ? item.guidanceHistory : [];
  if (!history.length && !item.guidanceTrend) return null;
  return el("div", { class: "guidance-block" }, [
    el("p", { class: "eyebrow", text: "Guidance history" }),
    trendChip(item.guidanceTrend, item.status),
    history.length ? el("ul", { class: "guidance-list" }, history.map((entry) => {
      const seen = parseDate(entry.date_seen, "exact");
      const link = sourceLink(entry.source_url_if_any, "Source");
      return el("li", {}, [
        el("span", { class: "cap-date", text: seen ? formatSort(seen.sort, "day") : "Date not set" }),
        el("span", { text: showText(entry.window_text) }),
        link,
      ]);
    })) : null,
  ]);
}

function riskChip(value) {
  const key = String(value || "").toLowerCase();
  if (key === "risk reduced") return chip("Risk reduced", "positive", "How the notes describe the risk. Factual context, not a recommendation.");
  if (key === "risk increased") return chip("Risk increased", "setback", "How the notes describe the risk. Factual context, not a recommendation.");
  if (key === "mixed") return chip("Mixed", "neutral", "How the notes describe the risk. Factual context, not a recommendation.");
  return null;
}

function filledLine(value) {
  if (value == null) return "";
  const text = showText(value);
  if (!text || text === "—" || text === "-") return "";
  return text;
}

function nextMilestone(id) {
  const key = String(id || "").trim();
  if (!key) return null;
  const bare = key.startsWith("N-") ? key.slice(2) : key;
  const target = upcoming.find((item) => item.rawId === key || item.id === `u:${key}`)
    || events.find((item) => item.rawId === key || item.rawId === bare || item.id === `n:${bare}` || item.id === `u:${key}`);
  if (!target) return null;
  const when = target.label || formatSort(target.sort, target.precision);
  const headline = showText(target.headline);
  const label = [when, headline].filter((part) => part && part !== "—").join(". ");
  if (!label) return null;
  const inUpcoming = upcoming.some((item) => item.id === target.id);
  return el("p", {}, [
    el("span", { class: "k", text: "Next milestone. " }),
    el("button", {
      type: "button",
      class: "co-link",
      onClick: (event) => {
        event.stopPropagation();
        state.range = inUpcoming ? "upcoming" : "all";
        state.briefIds = null;
        state.briefKey = "";
        state.significance = "all";
        state.background = true;
        state.open.add(target.id);
        state.shown = Math.max(state.shown, PAGE);
        mountFilters();
        writeUrl();
        render();
        requestAnimationFrame(() => {
          const node = visibleEventNode(target.id);
          if (node) node.scrollIntoView({ block: "nearest" });
        });
      },
      text: label,
    }),
  ]);
}

function whatChangedCard(item) {
  const block = item.whatChanged;
  const material = item.significance === "material" || (item.material && item.significance !== "background");
  if (!material || !block || typeof block !== "object") return null;
  const beforeText = filledLine(block.before);
  const before = beforeText ? el("p", {}, [el("span", { class: "k", text: "Before. " }), beforeText]) : null;
  const evidenceText = block.evidence ? showText(block.evidence) : "";
  const evidence = evidenceText && evidenceText !== "—"
    ? el("p", {}, [el("span", { class: "k", text: "Evidence. " }), evidenceText, " ", sourceBadge(item)])
    : null;
  const risk = riskChip(block.risk_effect);
  const milestone = typeof block.next_milestone === "string"
    ? block.next_milestone
    : (block.next_milestone && block.next_milestone.id);
  const next = milestone ? nextMilestone(milestone) : null;
  if (!before && !evidence && !risk && !next) return null;
  return el("div", { class: "changed-card" }, [
    el("p", { class: "eyebrow", text: "What changed" }),
    el("p", { class: "label-notes", text: "Factual context from the sources. Not a recommendation." }),
    before,
    evidence,
    risk ? el("p", {}, [el("span", { class: "k", text: "Risk effect. " }), risk]) : null,
    next,
  ]);
}

function detailNode(item) {
  const parts = [];
  if (item.moves) {
    parts.push(el("p", { class: "eyebrow", text: "Historical context" }));
    parts.push(el("p", { class: "moves", text: `r5 ${moveLabel(item.moves.r5)} · r20 ${moveLabel(item.moves.r20)} · r60 ${moveLabel(item.moves.r60)}` }));
    parts.push(el("p", { class: "label-notes", text: "Share-price change after the event. Context only." }));
  }
  parts.push(...sourceList(item));
  const guidance = guidanceBlock(item);
  if (guidance) parts.push(guidance);
  const changed = whatChangedCard(item);
  if (changed) parts.push(changed);
  const partners = partnerLines(item);
  if (partners.length) parts.push(partnerBlock(partners));
  item.pilots.forEach((pilot) => parts.push(pilotBlock(pilot)));
  if (item.note) parts.push(el("p", { class: "label-notes", text: showText(item.note) }));
  if (!parts.length) parts.push(el("p", { class: "label-notes", text: "No source, share-price reaction, or partner event on file." }));
  return el("div", { class: "cap-expand" }, parts);
}

function visibleEventNode(id) {
  const nodes = [...document.querySelectorAll(`[data-event-id="${CSS.escape(id)}"]`)];
  return nodes.find((node) => node.getClientRects().length) || null;
}

let focusAfterRender = null;

function detailDomId(id, slot) {
  return `detail-${slot}-${String(id).replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function detailToggle(id, open, slot) {
  return el("button", {
    type: "button",
    class: "detail-toggle",
    "data-detail-for": id,
    "aria-expanded": open ? "true" : "false",
    "aria-controls": detailDomId(id, slot),
    onClick: (event) => {
      event.stopPropagation();
      toggle(id, slot === "chart");
    },
    text: open ? "Close" : "Details",
  });
}

function detailPanel(id, node, slot) {
  if (!node) return null;
  return el("div", { class: "detail-panel", id: detailDomId(id, slot), "data-detail-panel": id }, [node]);
}

function rowClick(event, id) {
  if (event.target.closest("a, button, summary, input, select, label")) return;
  toggle(id);
}

function toggle(id, fromChart) {
  const opening = !state.open.has(id);
  if (opening) state.open.add(id);
  else state.open.delete(id);
  if (fromChart) state.chartFocus = opening ? id : "";
  else if (state.chartFocus === id && !opening) state.chartFocus = "";
  focusAfterRender = { id, fromChart: !!fromChart, opening };
  render();
  if (fromChart && opening) {
    requestAnimationFrame(() => {
      const row = visibleEventNode(id);
      const detail = document.getElementById("chartDetail");
      if (row) row.scrollIntoView({ block: "nearest", behavior: "auto" });
      else if (detail && !detail.hidden) detail.scrollIntoView({ block: "nearest", behavior: "auto" });
    });
  }
}

function finishRender() {
  if (!focusAfterRender) return;
  const pending = focusAfterRender;
  focusAfterRender = null;
  const { id, fromChart, opening } = pending;
  const chartSlot = document.getElementById("chartDetail");
  const chartClose = chartSlot && !chartSlot.hidden
    ? chartSlot.querySelector(`[data-detail-for="${CSS.escape(id)}"]`)
    : null;
  const btn = [...document.querySelectorAll(`[data-detail-for="${CSS.escape(id)}"]`)].find((node) => node.getClientRects().length);
  const dot = document.querySelector(`#chartScroll .dot[data-id="${CSS.escape(id)}"]`);
  if (opening) {
    if (fromChart && chartClose) chartClose.focus();
    else if (btn) btn.focus();
  } else if (fromChart && dot) dot.focus();
  else if (btn) btn.focus();
}

function basisTag(basis) {
  const key = String(basis || "").toLowerCase();
  if (key === "confirmed") return el("span", { class: "basis-tag", title: "The date is fixed on a calendar or in a contract.", text: "Confirmed" });
  if (key === "company target") return el("span", { class: "basis-tag", title: "The company or operator gave this window.", text: "Company target" });
  if (key === "estimate") return el("span", { class: "basis-tag", title: "The date is inferred. No company window is on file.", text: "Estimate" });
  return null;
}

const RUNWAY_LABELS = {
  "appears funded to next catalyst": ["Appears funded to next catalyst", "positive"],
  "funding needed before next catalyst": ["Funding needed before next catalyst", "setback"],
  unclear: ["Unclear", "neutral"],
  "not covered": ["Not covered", "background"],
};

function runwayChip(check) {
  const key = String(check || "not covered").trim().toLowerCase();
  const pair = RUNWAY_LABELS[key] || RUNWAY_LABELS["not covered"];
  return chip(pair[0], `${pair[1]} chip-runway`, "A rough check from public filings. Not advice.");
}

function runwayChipFor(id, companies) {
  const key = String(id || "");
  if (!key) return null;
  const company = (companies || []).find((item) => fundingByCode.has(item.code));
  const block = company ? fundingByCode.get(company.code) : null;
  if (!block || String(block.next_catalyst_id || "") !== key) return null;
  return runwayChip(block.runway_check);
}

function dateNode(item) {
  const text = item.label || formatSort(item.sort, item.precision);
  return el("span", { class: "date-stack" }, [
    el("span", { text }),
    basisTag(item.dateBasis),
    item.precision === "month" && !item.proxy ? el("span", { class: "precision", text: "Month" }) : null,
    runwayChipFor(item.rawId, item.companies),
  ]);
}

function renderTable(rows) {
  const table = el("table", { class: "register timeline" });
  const head = el("tr");
  [["Date", "When it happened, or the guided window."], ["Company", "The company the event belongs to."], ["Event type", "The kind of event."], ["Headline", "What was announced."], ["Source", "Primary, secondary, a listing page, or missing."]].forEach(([label, tip]) => head.append(el("th", { scope: "col", title: tip, text: label })));
  table.append(el("thead", {}, [head]));
  const body = el("tbody");
  rows.forEach((item) => {
    const open = state.open.has(item.id);
    const main = el("tr", {
      class: open ? "is-open" : "",
      "data-event-id": item.id,
      onClick: (event) => rowClick(event, item.id),
    });
    main.append(
      el("td", { class: "date" }, [dateNode(item)]),
      el("td", {}, [el("span", { class: "tl-cos" }, item.companies.map(companyNode))]),
      el("td", {}, [el("span", { class: "chip-row" }, tagNodes(item).slice(0, 2))]),
      el("td", {}, [el("span", { class: "tl-headline" }, [el("span", { text: showText(item.headline) }), el("span", { class: "chip-row" }, tagNodes(item).slice(2)), detailToggle(item.id, open, "table")])]),
      el("td", {}, [sourceBadge(item)]),
    );
    body.append(main);
    if (open) {
      const extra = detailPanel(item.id, detailNode(item), "table");
      if (extra) body.append(el("tr", { class: "tl-detail" }, [el("td", { colspan: "5" }, [extra])]));
    }
  });
  table.append(body);
  return table;
}

function renderCards(rows) {
  return rows.map((item) => {
    const open = state.open.has(item.id);
    return el("article", {
      class: open ? "card is-selected" : "card",
      "data-event-id": item.id,
      onClick: (event) => rowClick(event, item.id),
    }, [
      el("div", { class: "card-top" }, [
        el("time", { text: item.label || formatSort(item.sort, item.precision) }),
        runwayChipFor(item.rawId, item.companies),
      ]),
      el("div", { class: "tl-cos" }, item.companies.map(companyNode)),
      el("p", { class: "card-what", text: showText(item.headline) }),
      el("div", { class: "chip-row" }, tagNodes(item)),
      el("div", { class: "card-meta" }, [sourceBadge(item), detailToggle(item.id, open, "card")]),
      open ? detailPanel(item.id, detailNode(item), "card") : null,
    ]);
  });
}

const SVG_NS = "http://www.w3.org/2000/svg";
const LANE_CAP = 25;
const LANE = 50;
const DAY_MS = 86400000;
const MARK_R = 4.25;
const BIN_PX = 18;
let popTimer = 0;
let popPinned = false;
let clusterReturn = "";

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null) continue;
      node.setAttribute(key, String(value));
    }
  }
  return node;
}

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function sortMs(sort) {
  const match = String(sort || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function todayMs() {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

function parentTicker(company) {
  const ticker = company && company.parentListed && String(company.parentListed.ticker || "").trim();
  if (!ticker || ticker === "—") return "";
  return ticker;
}

function subsidiaryOfListed(company) {
  return String(company && company.listingStatus || "").toLowerCase() === "subsidiary of listed" && !!parentTicker(company);
}

function parentShortLabel(company) {
  const short = String(company.shortName || "").trim();
  if (/^inpex\b/i.test(short)) return "INPEX";
  return short || company.name || "Company";
}

function companyKey(company) {
  if (subsidiaryOfListed(company)) return `c:${parentTicker(company)}`;
  if (company.code) return `c:${company.code}`;
  return `n:${showText(company.label || company.name)}`;
}

function chartBounds(rows) {
  const today = todayMs();
  const pad = 5 * DAY_MS;
  const times = rows.map((item) => sortMs(item.sort)).filter((time) => Number.isFinite(time));
  if (state.range === "upcoming") {
    const last = times.reduce((max, time) => Math.max(max, time), today + 30 * DAY_MS);
    return { start: today - pad, end: last + pad };
  }
  if (state.range === "30") return { start: sortMs(shiftDays(todayIso(), -30)) - pad, end: today + pad };
  if (state.range === "90") return { start: sortMs(shiftDays(todayIso(), -90)) - pad, end: today + pad };
  if (state.range === "12m") return { start: sortMs(shiftMonths(todayIso(), -12)) - pad, end: today + pad };
  let start = today;
  let end = today;
  times.forEach((time) => {
    if (time < start) start = time;
    if (time > end) end = time;
  });
  if (end - start < 30 * DAY_MS) {
    start -= 15 * DAY_MS;
    end += 15 * DAY_MS;
  }
  return { start: start - pad, end: end + pad };
}

function companyVisible(company) {
  if (state.watchOnly && !(company.code && window.moonshotWatch && window.moonshotWatch.has(company.code))) return false;
  if (state.band !== "all" && company.band !== state.band) return false;
  if (state.sector !== "all" && company.sector !== state.sector) return false;
  if (state.market !== "all" && !(company.markets || []).includes(state.market)) return false;
  if (state.country !== "all" && !(company.countries || []).includes(state.country)) return false;
  const query = state.q.trim().toLowerCase();
  if (!query) return true;
  const blob = [company.label, company.name, company.code, company.shortName].join(" ").replaceAll("&", "and").toLowerCase();
  return blob.includes(query);
}

function buildLanes(rows) {
  const map = new Map();
  rows.forEach((item) => {
    item.companies.forEach((company) => {
      if (state.watchOnly) {
        if (!company.code || !window.moonshotWatch || !window.moonshotWatch.has(company.code)) return;
      }
      const key = companyKey(company);
      const subsidiary = subsidiaryOfListed(company);
      const chip = subsidiary ? parentTicker(company) : (company.code || "");
      const name = subsidiary ? parentShortLabel(company) : (company.label || company.name || company.code || "Company");
      const full = subsidiary ? (company.label || company.name || name) : "";
      let lane = map.get(key);
      if (!lane) {
        lane = {
          key,
          code: chip,
          name,
          title: full || (chip ? `${showText(name)} (${showText(chip)})` : showText(name)),
          screenCode: company.code || chip,
          onScreen: !!(company.onScreen || (company.code && linkCodes.has(company.code))),
          count: 0,
          subsidiary,
        };
        map.set(key, lane);
      } else if (subsidiary) {
        lane.name = name;
        lane.code = chip || lane.code;
        if (full && !String(lane.title).includes(full)) lane.title = lane.subsidiary && lane.title ? `${lane.title}. ${full}` : full;
        lane.subsidiary = true;
        if (company.code && (company.onScreen || linkCodes.has(company.code))) lane.screenCode = company.code;
      }
      if (company.onScreen || (company.code && linkCodes.has(company.code))) lane.onScreen = true;
      lane.count += 1;
    });
  });
  // Companies with no event in this filter still belong to the same list as the Screen.
  if (!state.briefIds || !state.briefIds.size) {
    screenProfiles.forEach((company) => {
      if (!companyVisible(company)) return;
      const key = companyKey(company);
      if (map.has(key)) return;
      const subsidiary = subsidiaryOfListed(company);
      const chip = subsidiary ? parentTicker(company) : (company.code || "");
      const name = subsidiary ? parentShortLabel(company) : (company.label || company.name || company.code || "Company");
      const full = subsidiary ? (company.label || company.name || name) : "";
      map.set(key, {
        key,
        code: chip,
        name,
        title: full || (chip ? `${showText(name)} (${showText(chip)})` : showText(name)),
        screenCode: company.code || chip,
        onScreen: true,
        count: 0,
        subsidiary,
      });
    });
  }
  const pinned = (lane) => !!(lane.code && window.moonshotWatch && window.moonshotWatch.has(lane.code));
  return [...map.values()].sort((a, b) => {
    const presence = Number(b.count > 0) - Number(a.count > 0);
    if (presence) return presence;
    if (state.chartSort === "count") return b.count - a.count || showText(a.name).localeCompare(showText(b.name), "en", { sensitivity: "base" });
    if (state.chartSort === "watch") {
      const pin = Number(pinned(b)) - Number(pinned(a));
      if (pin) return pin;
    }
    if (state.chartSort === "latest") {
      const left = latestMaterial.get(a.key) || "";
      const right = latestMaterial.get(b.key) || "";
      if (left !== right) return right.localeCompare(left);
      return b.count - a.count || showText(a.name).localeCompare(showText(b.name), "en", { sensitivity: "base" });
    }
    const left = nextCatalyst.get(a.key) || "9999-99-99";
    const right = nextCatalyst.get(b.key) || "9999-99-99";
    if (left !== right) return left.localeCompare(right);
    return b.count - a.count || showText(a.name).localeCompare(showText(b.name), "en", { sensitivity: "base" });
  });
}

function xFor(time, width, bounds) {
  const pad = 16;
  const span = Math.max(width - pad * 2, 1);
  const ratio = (time - bounds.start) / Math.max(bounds.end - bounds.start, 1);
  return pad + Math.min(1, Math.max(0, ratio)) * span;
}

function monthTicks(width, bounds) {
  const ticks = [];
  let first = true;
  const origin = new Date(bounds.start);
  for (let cursor = Date.UTC(origin.getUTCFullYear(), origin.getUTCMonth(), 1); cursor <= bounds.end; cursor = Date.UTC(new Date(cursor).getUTCFullYear(), new Date(cursor).getUTCMonth() + 1, 1)) {
    const monthDate = new Date(cursor);
    const next = Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1);
    const visibleStart = Math.max(cursor, bounds.start);
    const visibleEnd = Math.min(next, bounds.end);
    const visibleDays = (visibleEnd - visibleStart) / DAY_MS;
    const show = visibleDays >= 18;
    const year = monthDate.getUTCFullYear();
    const name = MONTHS[monthDate.getUTCMonth()];
    const opening = first;
    const yearEdge = monthDate.getUTCMonth() === 0;
    const align = opening && !show ? "start" : "middle";
    ticks.push({
      line: cursor >= bounds.start && cursor <= bounds.end ? xFor(cursor, width, bounds) : null,
      labelX: align === "start" ? xFor(visibleStart, width, bounds) + 4 : xFor((visibleStart + visibleEnd) / 2, width, bounds),
      show: show || yearEdge || opening,
      yearEdge,
      year,
      align,
      text: name,
    });
    if (show || opening) first = false;
  }
  return ticks;
}

function countBox(count) {
  const coarse = window.matchMedia("(max-width: 820px)").matches;
  const label = `+${count}`;
  return {
    w: Math.max(coarse ? 40 : 28, label.length * (coarse ? 8 : 7) + (coarse ? 16 : 12)),
    h: coarse ? 40 : 20,
  };
}

function clusterLane(dots) {
  const sorted = dots.slice().sort((a, b) => a.x - b.x || String(a.item.id).localeCompare(String(b.item.id)));
  const groups = [];
  sorted.forEach((dot) => {
    const last = groups[groups.length - 1];
    if (last && dot.x - last.xStart < BIN_PX) last.dots.push(dot);
    else groups.push({ dots: [dot], xStart: dot.x });
  });
  return groups;
}

function layoutGroup(group, y, width) {
  const dots = group.dots;
  const shownCount = dots.length <= 3 ? dots.length : 2;
  const shown = dots.slice(0, shownCount);
  const hidden = dots.slice(shownCount);
  const coarse = window.matchMedia("(max-width: 820px)").matches;
  const gap = coarse ? 42 : 11;
  const centers = shown.map((_, index) => index * gap);
  let countW = 0;
  let countH = 20;
  if (hidden.length) {
    const box = countBox(hidden.length);
    countW = box.w;
    countH = box.h;
    const last = centers.length ? centers[centers.length - 1] : 0;
    centers.push(last + (coarse ? 20 : MARK_R) + countW / 2 + 4);
  }
  const span = centers.length ? centers[centers.length - 1] : 0;
  const mid = dots.reduce((sum, dot) => sum + dot.x, 0) / dots.length;
  const edge = 8 + (hidden.length ? countW / 2 : MARK_R);
  let origin = mid - span / 2;
  if (origin < edge) origin = edge;
  if (origin + span > width - edge) origin = Math.max(edge, width - edge - span);
  const placed = shown.map((dot, index) => ({ kind: "event", dot, x: origin + centers[index], y }));
  if (hidden.length) placed.push({ kind: "count", hidden, x: origin + centers[centers.length - 1], y, width: countW, height: countH });
  return placed;
}

function markerColor(item) {
  if (item.setback || item.direction === "negative") return cssVar("--amber", "#f0b429");
  if (item.direction === "neutral" || item.background || item.significance === "background") return cssVar("--muted", "#8b97a8");
  return cssVar("--accent", "#4f7cff");
}

function starPoints(cx, cy, radius) {
  const points = [];
  for (let i = 0; i < 10; i += 1) {
    const arm = i % 2 ? radius * 0.42 : radius;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(`${(cx + Math.cos(angle) * arm).toFixed(2)},${(cy + Math.sin(angle) * arm).toFixed(2)}`);
  }
  return points.join(" ");
}

function hideCluster(force) {
  if (popPinned && !force) return;
  clearTimeout(popTimer);
  popPinned = false;
  const pop = document.getElementById("chartPopover");
  if (!pop) return;
  pop.hidden = true;
  pop.replaceChildren();
}

function placeCluster(anchor) {
  const pop = document.getElementById("chartPopover");
  if (!pop || pop.hidden) return;
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 16);
  let left = rect.left;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  pop.style.width = `${width}px`;
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${rect.bottom + 6}px`;
  const box = pop.getBoundingClientRect();
  if (box.bottom > window.innerHeight - 8) pop.style.top = `${Math.max(8, rect.top - box.height - 6)}px`;
}

function showCluster(anchor, dots, pin) {
  clearTimeout(popTimer);
  const pop = document.getElementById("chartPopover");
  if (!pop) return;
  if (pin) popPinned = true;
  clusterReturn = anchor.getAttribute("data-ids") || "";
  const noun = dots.length === 1 ? "event" : "events";
  pop.hidden = false;
  pop.setAttribute("role", "region");
  pop.setAttribute("aria-label", `${dots.length} more ${noun}`);
  pop.replaceChildren(
    el("p", { class: "eyebrow", text: `${dots.length} more ${noun}` }),
    el("ul", { class: "cluster-list" }, dots.map((dot) => {
      const item = dot.item;
      return el("li", {}, [
        el("button", {
          type: "button",
          class: item.setback ? "cluster-item is-setback" : "cluster-item",
          onClick: (event) => {
            event.stopPropagation();
            hideCluster(true);
            toggle(item.id, true);
          },
        }, [
          el("span", { class: "cap-date", text: item.label || formatSort(item.sort, item.precision) }),
          el("span", { class: "cluster-line", text: showText(item.headline) }),
          (item.setback || item.direction === "negative") ? el("span", { class: "chip chip-setback", text: "Setback", "aria-label": "Direction: Setback" }) : null,
        ]),
      ]);
    })),
  );
  placeCluster(anchor);
}

function armHideCluster() {
  clearTimeout(popTimer);
  popTimer = setTimeout(() => hideCluster(false), 220);
}

function drawDot(placed) {
  const dot = placed.dot;
  const item = dot.item;
  const color = markerColor(item);
  const cx = placed.x;
  const cy = placed.y;
  const setback = item.setback || item.direction === "negative";
  const group = svgEl("g", {
    class: state.open.has(item.id) ? "dot is-open" : "dot",
    tabindex: "0",
    role: "button",
    "data-id": item.id,
    "aria-label": [
      setback ? "Setback" : "",
      item.label || formatSort(item.sort, item.precision),
      showText(dot.company.label || dot.company.name),
      showText(item.headline),
    ].filter(Boolean).join(". "),
  });
  const hit = window.matchMedia("(max-width: 820px)").matches ? 20 : 8;
  group.append(svgEl("circle", { cx, cy, r: hit, fill: "transparent" }));
  group.append(svgEl("circle", { class: "halo", cx, cy, r: 6.4 }));
  const gate = item.pilots.some((pilot) => pilot.gate === "Y");
  const exit = item.pilots.some((pilot) => pilot.exit === "Y");
  if (gate) {
    group.append(svgEl("circle", {
      class: "gate-ring",
      cx,
      cy,
      r: 6.2,
      fill: "none",
      stroke: cssVar("--accent", "#4f7cff"),
      "stroke-width": "1.1",
      "stroke-opacity": "0.7",
    }));
  }
  const happened = !item.upcoming && item.sort <= todayIso();
  const paint = {
    class: "mark",
    fill: happened ? color : cssVar("--panel", "#111722"),
    stroke: color,
    "stroke-width": item.setback ? 2 : 1.6,
  };
  const mark = setback
    ? svgEl("polygon", { ...paint, points: starPoints(cx, cy, 5.2) })
    : exit
      ? svgEl("polygon", { ...paint, points: `${cx},${cy - 5} ${cx + 5},${cy} ${cx},${cy + 5} ${cx - 5},${cy}` })
      : svgEl("circle", { ...paint, cx, cy, r: MARK_R });
  if (item.precision !== "day" && item.precision !== "exact") mark.setAttribute("stroke-dasharray", "1.6 1.3");
  group.append(mark);
  group.addEventListener("click", (event) => {
    event.stopPropagation();
    hideCluster(true);
    toggle(item.id, true);
  });
  group.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    hideCluster(true);
    toggle(item.id, true);
  });
  return group;
}

function drawCount(placed) {
  const hidden = placed.hidden;
  const label = `+${hidden.length}`;
  const w = placed.width;
  const h = placed.height || 20;
  const open = hidden.some((dot) => state.open.has(dot.item.id));
  const group = svgEl("g", {
    class: open ? "dot count-dot is-open" : "dot count-dot",
    tabindex: "0",
    role: "button",
    "data-ids": hidden.map((dot) => dot.item.id).join(" "),
    "aria-label": `${hidden.length} more events. Opens the list.`,
  });
  group.append(svgEl("rect", {
    class: "count-mark",
    x: placed.x - w / 2,
    y: placed.y - h / 2,
    width: w,
    height: h,
    rx: 7,
    stroke: cssVar("--border-strong", "#364157"),
    "stroke-width": "1",
  }));
  const text = svgEl("text", {
    class: "count-label",
    x: placed.x,
    y: placed.y + 0.5,
    "text-anchor": "middle",
    "dominant-baseline": "central",
  });
  text.textContent = label;
  group.append(text);
  group.addEventListener("mouseenter", () => showCluster(group, hidden, false));
  group.addEventListener("mouseleave", armHideCluster);
  group.addEventListener("focus", () => showCluster(group, hidden, false));
  group.addEventListener("blur", armHideCluster);
  group.addEventListener("click", (event) => {
    event.stopPropagation();
    showCluster(group, hidden, true);
  });
  group.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideCluster(true);
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    showCluster(group, hidden, true);
    const first = document.querySelector("#chartPopover button");
    if (first) first.focus();
  });
  return group;
}

function buildSvg(lanes, rows, width, bounds) {
  const height = lanes.length * LANE;
  const root = svgEl("svg", {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: "group",
    "aria-label": "Timeline markers. The events list under the chart is the text version.",
  });
  const defs = svgEl("defs");
  const laneIndex = new Map(lanes.map((lane, index) => [lane.key, index]));
  lanes.forEach((lane, index) => {
    const clip = svgEl("clipPath", { id: `lane-clip-${index}` });
    clip.append(svgEl("rect", { x: 0, y: index * LANE, width, height: LANE }));
    defs.append(clip);
  });
  root.append(defs);
  lanes.forEach((lane, index) => {
    if (index % 2) {
      root.append(svgEl("rect", {
        x: 0,
        y: index * LANE,
        width,
        height: LANE,
        fill: cssVar("--zebra", "#151c28"),
      }));
    }
    if (index > 0) {
      const y = index * LANE + 0.5;
      root.append(svgEl("line", { x1: 0, x2: width, y1: y, y2: y, stroke: cssVar("--border", "#252d3c") }));
    }
  });
  monthTicks(width, bounds).forEach((tick) => {
    if (tick.line == null) return;
    root.append(svgEl("line", {
      x1: tick.line,
      x2: tick.line,
      y1: 0,
      y2: height,
      stroke: tick.yearEdge ? cssVar("--border-strong", "#364157") : cssVar("--border", "#252d3c"),
      "stroke-width": tick.yearEdge ? "1.25" : "1",
    }));
  });
  const today = todayMs();
  let todayX = null;
  if (today >= bounds.start && today <= bounds.end) {
    todayX = xFor(today, width, bounds);
    root.append(svgEl("line", {
      x1: todayX,
      x2: todayX,
      y1: 0,
      y2: height,
      class: "today-line",
    }));
  }
  const byLane = new Map();
  rows.forEach((item) => {
    const time = sortMs(item.sort);
    if (!Number.isFinite(time)) return;
    item.companies.forEach((company) => {
      const key = companyKey(company);
      const index = laneIndex.get(key);
      if (index == null) return;
      if (!byLane.has(key)) byLane.set(key, []);
      byLane.get(key).push({ item, company, key, time, x: xFor(time, width, bounds) });
    });
  });
  lanes.forEach((lane, index) => {
    const layer = svgEl("g", { "clip-path": `url(#lane-clip-${index})` });
    const y = index * LANE + LANE / 2;
    clusterLane(byLane.get(lane.key) || []).forEach((group) => {
      layoutGroup(group, y, width).forEach((placed) => {
        layer.append(placed.kind === "count" ? drawCount(placed) : drawDot(placed));
      });
    });
    root.append(layer);
  });
  return { root, todayX };
}

function chartStampFor(rows) {
  return JSON.stringify({
    range: state.range,
    significance: state.significance,
    direction: state.direction,
    status: state.status,
    confidence: state.confidence,
    band: state.band,
    types: state.types,
    sector: state.sector,
    market: state.market,
    category: state.category,
    country: state.country,
    background: state.background,
    watchOnly: state.watchOnly,
    q: state.q,
    chartAll: state.chartAll,
    chartSort: state.chartSort,
    n: rows.length,
    a: rows[0] && rows[0].id,
    b: rows.length ? rows[rows.length - 1].id : "",
  });
}

function renderChartDetail(rows) {
  const slot = document.getElementById("chartDetail");
  if (!slot) return;
  const item = state.chartFocus ? rows.find((row) => row.id === state.chartFocus) : null;
  const index = item ? rows.indexOf(item) : -1;
  const onPage = index >= 0 && index < state.shown;
  if (!item || !state.open.has(item.id) || onPage) {
    slot.hidden = true;
    slot.replaceChildren();
    return;
  }
  slot.hidden = false;
  slot.replaceChildren(el("div", { "data-detail-panel": item.id }, [
    detailToggle(item.id, true, "chart"),
    el("p", { class: "cap-date", text: item.label || formatSort(item.sort, item.precision) }),
    el("div", { class: "tl-cos" }, item.companies.map(companyNode)),
    el("p", { class: "card-what", text: showText(item.headline) }),
    detailPanel(item.id, detailNode(item), "chart"),
  ]));
}

function axisBox(node, origin) {
  const box = node.getBoundingClientRect();
  return { node, left: box.left - origin, right: box.right - origin, top: box.top, bottom: box.bottom };
}

function pinAxisLeft(node, left) {
  node.style.left = `${Math.round(left)}px`;
  node.style.transform = "none";
}

function axisOverlap(a, b, gap) {
  return a.left < b.right + gap && a.right + gap > b.left;
}

function settleAxisLabels(monthNodes, yearNodes, pill, width) {
  const track = monthNodes[0]?.parentElement || yearNodes[0]?.parentElement || pill?.parentElement;
  if (!track) return;
  const origin = track.getBoundingClientRect().left;
  const gap = 6;
  const kept = [];
  monthNodes.forEach((node) => {
    if (!node.isConnected) return;
    let box = axisBox(node, origin);
    const span = box.right - box.left;
    if (box.left < 2) {
      pinAxisLeft(node, 2);
      box = axisBox(node, origin);
    }
    if (box.right > width - 2) {
      pinAxisLeft(node, Math.max(2, width - 2 - span));
      box = axisBox(node, origin);
    }
    const prev = kept[kept.length - 1];
    if (prev && axisOverlap(prev, box, gap)) {
      const prefer = node.dataset.yearEdge === "true" || node.dataset.last === "true";
      if (prefer && prev.node.dataset.yearEdge !== "true") {
        prev.node.remove();
        kept.pop();
        const earlier = kept[kept.length - 1];
        if (earlier && axisOverlap(earlier, box, gap)) {
          node.remove();
          return;
        }
      } else {
        node.remove();
        return;
      }
    }
    kept.push(box);
  });
  const years = [];
  yearNodes.forEach((node) => {
    if (!node.isConnected) return;
    let box = axisBox(node, origin);
    if (box.left < 2) {
      pinAxisLeft(node, 2);
      box = axisBox(node, origin);
    }
    const prev = years[years.length - 1];
    if (prev && axisOverlap(prev, box, gap)) {
      pinAxisLeft(node, prev.right + gap);
      box = axisBox(node, origin);
      if (box.right > width - 2) {
        node.remove();
        return;
      }
    }
    years.push(box);
  });
  if (!pill) return;
  let pillBox = axisBox(pill, origin);
  years.forEach((year) => {
    if (!year.node.isConnected) return;
    const box = axisBox(year.node, origin);
    if (!axisOverlap(pillBox, box, gap)) return;
    const pillW = pillBox.right - pillBox.left;
    const yearW = box.right - box.left;
    const yearOnRight = box.left >= pillBox.left;
    if (yearOnRight && pillBox.right + gap + yearW <= width - 2) {
      pinAxisLeft(year.node, pillBox.right + gap);
      return;
    }
    const pillLeft = box.left - gap - pillW;
    if (pillLeft >= 2) {
      pinAxisLeft(pill, pillLeft);
      pillBox = axisBox(pill, origin);
      return;
    }
    const pillRight = box.right + gap;
    if (pillRight + pillW <= width - 2) {
      pinAxisLeft(pill, pillRight);
      pillBox = axisBox(pill, origin);
    }
  });
}

function renderChart(rows) {
  const scroll = document.getElementById("chartScroll");
  const empty = document.getElementById("chartEmpty");
  const meta = document.getElementById("chartMeta");
  const more = document.getElementById("chartMore");
  hideCluster(true);
  if (!scroll || !empty || !meta || !more) return;
  if (!rows.length) {
    scroll.replaceChildren();
    scroll.hidden = true;
    empty.hidden = false;
    empty.replaceChildren(
      el("strong", { text: "No events in this view" }),
      el("p", { text: "The chart uses the same filters as the list." }),
    );
    meta.textContent = "No events";
    more.hidden = true;
    return;
  }
  const allLanes = buildLanes(rows);
  const capped = !state.watchOnly && !state.chartAll && allLanes.length > LANE_CAP;
  const lanes = capped ? allLanes.slice(0, LANE_CAP) : allLanes;
  const companyNoun = allLanes.length === 1 ? "company" : "companies";
  const eventNoun = rows.length === 1 ? "event" : "events";
  const companyText = lanes.length === allLanes.length ? `${allLanes.length} ${companyNoun}` : `${lanes.length} of ${allLanes.length} ${companyNoun}`;
  meta.textContent = `${companyText} · ${rows.length.toLocaleString("en-GB")} ${eventNoun}`;
  if (!state.watchOnly && allLanes.length > LANE_CAP) {
    more.hidden = false;
    more.textContent = state.chartAll ? "Show the top 25" : `Show all ${allLanes.length} companies`;
  } else {
    more.hidden = true;
  }
  if (!lanes.length) {
    scroll.replaceChildren();
    scroll.hidden = true;
    empty.hidden = false;
    empty.replaceChildren(
      el("strong", { text: "No companies in this view" }),
      el("p", { text: "The chart uses the same filters as the list." }),
    );
    return;
  }
  empty.hidden = true;
  scroll.hidden = false;
  const bounds = chartBounds(rows);
  const narrow = window.matchMedia("(max-width: 820px)").matches;
  const laneNodes = lanes.map((lane, index) => {
    const full = lane.title || (lane.code ? `${showText(lane.name)} (${showText(lane.code)})` : showText(lane.name));
    const openCode = lane.screenCode || lane.code;
    const tick = lane.code ? el("span", { class: "tick", title: showText(lane.code), text: showText(lane.code) }) : null;
    const name = el("span", { class: "name", title: full, text: showText(lane.name) });
    const body = lane.onScreen
      ? el("button", {
        type: "button",
        class: "lane-link",
        title: full,
        "aria-label": `Open ${showText(lane.name)} on the Screen`,
        onClick: () => {
          if (typeof window.moonshotOpenScreen === "function") window.moonshotOpenScreen(openCode);
        },
      }, [tick, name])
      : el("span", { class: "lane-static" }, [tick, name]);
    return el("div", {
      class: index % 2 ? "lane alt" : "lane",
      title: full,
    }, [body]);
  });
  const labels = el("div", { class: "label-col" }, laneNodes);
  const plot = el("div", { class: "plot-col" });
  const canvas = el("div", { class: "plot-canvas" });
  const months = (bounds.end - bounds.start) / (30.437 * DAY_MS);
  const minWidth = Math.round(Math.max(680, months * 48));
  canvas.style.minWidth = `${minWidth}px`;
  plot.append(canvas);
  const track = el("div", { class: "chart-axis-track" });
  const axis = el("div", { class: "chart-axis" }, [
    el("div", { class: "chart-axis-gutter" }, [
      el("span", { class: "wide-only", text: "Company" }),
      el("span", { class: "narrow-only", text: "Ticker" }),
    ]),
    el("div", { class: "chart-axis-window" }, [track]),
  ]);
  scroll.replaceChildren(el("div", { class: "chart-frame" }, [
    axis,
    el("div", { class: "chart-grid" }, [labels, plot]),
  ]));
  const width = Math.max(minWidth, Math.round(plot.getBoundingClientRect().width));
  canvas.style.width = `${width}px`;
  const built = buildSvg(lanes, rows, width, bounds);
  canvas.append(built.root);
  track.style.width = `${width}px`;
  const ticks = monthTicks(width, bounds).filter((tick) => tick.show);
  const monthNodes = ticks.map((tick, index) => {
    const alignStart = tick.align === "start";
    return el("span", {
      class: "chart-axis-label",
      style: `left:${Math.round(tick.labelX)}px;transform:translateX(${alignStart ? "0" : "-50%"})`,
      "data-year-edge": tick.yearEdge ? "true" : "false",
      "data-last": index === ticks.length - 1 ? "true" : "false",
      text: tick.text,
    });
  });
  const seenYears = new Set();
  const yearNodes = [];
  ticks.forEach((tick) => {
    if (seenYears.has(tick.year)) return;
    seenYears.add(tick.year);
    const anchor = tick.yearEdge && tick.line != null ? tick.line + 4 : tick.align === "start" ? tick.labelX : Math.max(4, (tick.line != null ? tick.line : tick.labelX) + 2);
    yearNodes.push(el("span", {
      class: "chart-axis-year",
      style: `left:${Math.round(anchor)}px`,
      text: String(tick.year),
    }));
  });
  track.append(...monthNodes, ...yearNodes);
  let pill = null;
  if (built.todayX != null) {
    const pillW = 52;
    const pillLeft = Math.max(2, Math.min(built.todayX - pillW / 2, width - pillW - 2));
    pill = el("span", {
      class: "today-pill",
      style: `left:${Math.round(pillLeft)}px;width:${pillW}px`,
      text: "Today",
    });
    track.append(pill);
  }
  settleAxisLabels(monthNodes, yearNodes, pill, width);
  const syncAxis = () => { track.style.transform = `translateX(${-plot.scrollLeft}px)`; };
  plot.addEventListener("scroll", () => {
    syncAxis();
    hideCluster(true);
  });
  if (built.todayX != null && plot.scrollWidth > plot.clientWidth + 2) {
    plot.scrollLeft = Math.max(0, built.todayX - plot.clientWidth * 0.42);
  }
  syncAxis();
  const rangeText = `${formatSort(new Date(bounds.start).toISOString().slice(0, 10), "day")} to ${formatSort(new Date(bounds.end).toISOString().slice(0, 10), "day")}`;
  const summary = document.getElementById("chartSummary");
  const scrollHint = narrow ? " Scroll sideways inside the chart for other months." : "";
  if (summary) {
    summary.textContent = `Company timeline from ${rangeText}. ${companyText}, ${rows.length.toLocaleString("en-GB")} ${eventNoun}. Each marker is a button. A star marks a setback, and the marker name includes the word Setback.${scrollHint} The events list under the chart is the same information in text.`;
  }
}

function scheduleChart(rows) {
  chartRows = rows;
  if (document.documentElement.dataset.view !== "events") {
    chartDirty = true;
    return;
  }
  const stamp = chartStampFor(rows);
  if (stamp === chartStamp && !chartDirty && document.getElementById("chartScroll")?.childElementCount) {
    document.querySelectorAll("#chartScroll .dot").forEach((dot) => {
      const id = dot.getAttribute("data-id");
      const ids = (dot.getAttribute("data-ids") || "").split(" ").filter(Boolean);
      const open = id ? state.open.has(id) : ids.some((item) => state.open.has(item));
      dot.classList.toggle("is-open", open);
    });
    return;
  }
  chartDirty = false;
  chartStamp = stamp;
  cancelAnimationFrame(chartTimer);
  chartTimer = requestAnimationFrame(() => renderChart(rows));
}

function subtitle() {
  if (state.range === "upcoming") return "Coming up, soonest first.";
  const significance = state.significance === "material"
    ? "Material and setbacks"
    : state.significance === "background"
      ? "Background"
      : "All significance";
  const range = state.range === "all" ? "all dates" : RANGES.find(([value]) => value === state.range)[1].toLowerCase();
  return `${significance}, ${range}. Newest first.`;
}

function render() {
  const rows = filtered();
  const visible = rows.slice(0, state.shown);
  const showing = document.getElementById("showing");
  const noun = rows.length === 1 ? "event" : "events";
  showing.textContent = `Showing ${visible.length.toLocaleString("en-GB")} of ${rows.length.toLocaleString("en-GB")} ${noun}`;
  document.getElementById("timelineSub").textContent = subtitle();
  document.getElementById("clearFilters").hidden = isDefault();
  const empty = document.getElementById("tableEmpty");
  const more = document.getElementById("moreRow");
  if (!rows.length) {
    empty.hidden = false;
    const pinned = window.moonshotWatch ? window.moonshotWatch.codes().length : 0;
    const title = state.watchOnly && !pinned ? "No companies pinned" : "Nothing in this view";
    const detail = state.watchOnly && !pinned
      ? "Star a company to build a watchlist."
      : state.watchOnly
        ? "No pinned companies in this view."
        : "No events match these filters.";
    empty.replaceChildren(el("strong", { text: title }), el("p", { text: detail }));
    document.getElementById("tableWrap").replaceChildren();
    document.getElementById("cards").replaceChildren();
    more.hidden = true;
    renderChartDetail(rows);
    scheduleChart(rows);
    finishRender();
    return;
  }
  empty.hidden = true;
  document.getElementById("tableWrap").replaceChildren(renderTable(visible));
  document.getElementById("cards").replaceChildren(...renderCards(visible));
  more.hidden = visible.length >= rows.length;
  renderChartDetail(rows);
  scheduleChart(rows);
  finishRender();
}

function showError() {
  const loading = document.getElementById("loading");
  if (loading) loading.hidden = true;
  document.getElementById("main").prepend(el("p", { class: "error", text: "The register could not be loaded. Refresh the page to try again." }));
}

function briefDate(item) {
  if (item.date_window_text) return showText(item.date_window_text);
  const parsed = parseDate(item.date, "exact");
  return parsed ? formatSort(parsed.sort, "day") : showText(item.date);
}

function renderBriefing(data) {
  const section = document.getElementById("briefing");
  const tiles = document.getElementById("briefingTiles");
  const note = document.getElementById("briefingNote");
  const asof = document.getElementById("briefingAsof");
  const details = document.getElementById("briefingDetails");
  if (!section || !tiles || !data || !data.counts) return;
  section.hidden = false;
  const parsed = parseDate(data.as_of, "exact");
  if (asof) asof.textContent = parsed ? `As of ${formatSort(parsed.sort, "day")}.` : "";
  if (note) note.textContent = "Facts only. Dates are event dates, except guidance windows passed, which use the date they were checked.";
  if (details) {
    let open = true;
    try { open = localStorage.getItem("moonshot-briefing") !== "0"; } catch (err) { open = true; }
    details.open = open;
    details.addEventListener("toggle", () => {
      try { localStorage.setItem("moonshot-briefing", details.open ? "1" : "0"); } catch (err) { /* ignore */ }
    });
  }
  const counts = data.counts;
  const groups = [
    {
      label: "New material events",
      hits: [
        ["material_7d", `${counts.material_7d} in 7 days`, data.material_7d || []],
        ["material_30d", `${counts.material_30d} in 30 days`, data.material_30d || []],
      ],
    },
    { label: "New setbacks", hits: [["setbacks_30d", `${counts.setbacks_30d} in 30 days`, data.setbacks_30d || []]] },
    { label: "Catalysts in the next 30 days", hits: [["catalysts_30d", String(counts.catalysts_30d), data.catalysts_30d || []]] },
    { label: "Guidance windows passed", hits: [["overdue", String(counts.overdue), data.overdue || []]] },
  ];
  const openList = (key, items) => {
    state.briefKey = state.briefKey === key ? "" : key;
    document.querySelectorAll(".brief-hit").forEach((node) => node.classList.toggle("is-on", node.dataset.brief === state.briefKey));
    const list = document.getElementById("briefingList");
    if (!list) return;
    if (!state.briefKey) {
      state.briefIds = null;
      list.hidden = true;
      list.replaceChildren();
      render();
      return;
    }
    const shown = items.slice(0, 8);
    list.hidden = false;
    list.replaceChildren(
      ...shown.map((item) => el("p", { class: "brief-row" }, [
        el("span", { class: "cap-date", text: briefDate(item) }),
        el("span", { class: "cap-name", text: showText(item.company) }),
        el("span", { text: showText(item.headline) }),
      ])),
      items.length > shown.length ? el("p", { class: "label-notes", text: `${items.length - shown.length} more in this list.` }) : null,
    );
    const ids = new Set(items.map((item) => item.id).filter(Boolean));
    if (key === "catalysts_30d") {
      state.briefIds = null;
      if (typeof window.moonshotApplyTab === "function") window.moonshotApplyTab("coming", true);
      const horizon = document.querySelector("#coming-horizon [data-horizon='30']");
      if (horizon) horizon.click();
      return;
    }
    if (key === "overdue") {
      state.briefIds = null;
      return;
    }
    state.briefIds = ids;
    state.range = "all";
    state.significance = "all";
    state.background = true;
    state.direction = "all";
    state.status = "all";
    state.shown = PAGE;
    if (typeof window.moonshotApplyTab === "function") window.moonshotApplyTab("events", true);
    mountFilters();
    writeUrl();
    render();
  };
  tiles.replaceChildren(...groups.map((group) => el("article", { class: "brief-tile" }, [
    el("p", { class: "brief-label", text: group.label }),
    ...group.hits.map(([key, text, items]) => el("button", {
      type: "button",
      class: "brief-hit",
      "data-brief": key,
      onClick: () => openList(key, items),
      text,
    })),
  ])));
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(path);
  return response.json();
}

async function main() {
  try {
    const [eventsCsv, companiesCsv, screen, norwayEvents, norwayCompanies, falklands, namibia, guyana, southAfrica, gabon, angola, colombia, readAcross, slipped, coming, briefing] = await Promise.all([
      fetch("data/events.csv", { cache: "no-cache" }).then((response) => { if (!response.ok) throw new Error("events"); return response.text(); }),
      fetch("data/companies.csv", { cache: "no-cache" }).then((response) => { if (!response.ok) throw new Error("companies"); return response.text(); }),
      loadJson("data/smallcaps.json"),
      loadJson("data/norway_events.json"),
      loadJson("data/norway_companies.json"),
      loadJson("data/falklands.json"),
      loadJson("data/namibia.json"),
      loadJson("data/guyana.json"),
      loadJson("data/south_africa.json"),
      loadJson("data/gabon.json"),
      loadJson("data/angola.json"),
      loadJson("data/colombia.json"),
      loadJson("data/read_across.json"),
      loadJson("data/slipped.json"),
      loadJson("data/coming_up.json"),
      loadJson("data/briefing.json").catch(() => null),
    ]);
    fundingByCode = new Map();
    screen.forEach((row) => {
      if (row && row.code && row.funding && typeof row.funding === "object") fundingByCode.set(row.code, row.funding);
    });
    screenCodes = new Set(screen.map((row) => row.code).filter(Boolean));
    SCREEN_PILOTS.forEach((code) => screenCodes.add(code));
    linkCodes = new Set(screenCodes);
    norwayCompanies.forEach((company) => {
      const code = tickerFromListing(company.listing_ticker) || String(company.short_name || "").trim();
      if (code) linkCodes.add(code);
    });
    across = Array.isArray(readAcross) ? readAcross : [];
    const built = buildTimeline(
      screen,
      norwayEvents,
      norwayCompanies,
      rowsToObjects(eventsCsv),
      rowsToObjects(companiesCsv),
      [falklands, namibia, guyana, southAfrica, gabon, angola, colombia],
      readAcross,
      slipped,
      coming,
    );
    events = built.events;
    upcoming = built.upcoming;
    const companyKeys = new Set();
    events.forEach((item) => item.companies.forEach((company) => companyKeys.add(company.code || company.label || company.name)));
    document.body.dataset.chartCompanies = String(companyKeys.size);
    typeOptions = built.types;
    sectorOptions = built.sectors;
    countryOptions = built.countries;
    readUrl();
    renderBriefing(briefing);
    document.getElementById("loading").hidden = true;
    document.getElementById("app").hidden = false;
    mountFilters();
    render();
    document.body.dataset.ready = "true";
    document.body.dataset.events = String(events.length);
    document.body.dataset.upcomingEvents = String(upcoming.length);
  } catch {
    showError();
  }
}

function wireDisclosures(root) {
  (root || document).querySelectorAll("details").forEach((details) => {
    if (details.dataset.wired === "1") return;
    const summary = details.querySelector("summary");
    if (!summary) return;
    details.dataset.wired = "1";
    const paint = () => summary.setAttribute("aria-expanded", details.open ? "true" : "false");
    paint();
    details.addEventListener("toggle", paint);
  });
}

window.moonshotWireDisclosures = wireDisclosures;

function paintThemeButton() {
  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const button = document.getElementById("themeButton");
  if (!button) return;
  button.textContent = theme === "dark" ? "Light" : "Dark";
  button.setAttribute("aria-pressed", theme === "light" ? "true" : "false");
}

function bindChrome() {
  document.documentElement.style.backgroundColor = "";
  paintThemeButton();
  const showMore = document.getElementById("showMore");
  if (showMore) showMore.addEventListener("click", () => { state.shown += PAGE; render(); });
  const chartToggle = document.getElementById("chartToggle");
  const chartSort = document.getElementById("chartSort");
  try {
    const savedChart = localStorage.getItem("moonshot-chart-open");
    if (savedChart === "0" || savedChart === "1") state.chartOpen = savedChart === "1";
    else state.chartOpen = !window.matchMedia("(max-width: 820px)").matches;
    const savedSort = localStorage.getItem("moonshot-chart-sort");
    if (savedSort === "next" || savedSort === "latest" || savedSort === "watch" || savedSort === "count") state.chartSort = savedSort;
  } catch (err) { /* keep defaults */ }
  const paintChartChrome = () => {
    const block = document.getElementById("chartBlock");
    if (block) block.classList.toggle("is-collapsed", !state.chartOpen);
    if (chartToggle) {
      chartToggle.textContent = state.chartOpen ? "Hide timeline" : "Show timeline";
      chartToggle.setAttribute("aria-expanded", state.chartOpen ? "true" : "false");
    }
    if (chartSort) chartSort.value = state.chartSort;
  };
  paintChartChrome();
  if (chartToggle) {
    chartToggle.addEventListener("click", () => {
      state.chartOpen = !state.chartOpen;
      try { localStorage.setItem("moonshot-chart-open", state.chartOpen ? "1" : "0"); } catch (err) { /* ignore */ }
      paintChartChrome();
      if (state.chartOpen) {
        chartStamp = "";
        scheduleChart(chartRows);
      }
    });
  }
  if (chartSort) {
    chartSort.addEventListener("change", () => {
      state.chartSort = chartSort.value;
      try { localStorage.setItem("moonshot-chart-sort", state.chartSort); } catch (err) { /* ignore */ }
      chartStamp = "";
      scheduleChart(chartRows);
    });
  }
  const chartMore = document.getElementById("chartMore");
  if (chartMore) {
    chartMore.addEventListener("click", () => {
      state.chartAll = !state.chartAll;
      chartStamp = "";
      scheduleChart(chartRows);
    });
  }
  const chartScroll = document.getElementById("chartScroll");
  if (chartScroll) {
    chartScroll.addEventListener("keydown", (event) => {
      if (event.target !== chartScroll && !event.target.classList.contains("plot-col")) return;
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const plot = chartScroll.querySelector(".plot-col");
      if (!plot) return;
      event.preventDefault();
      plot.scrollLeft += event.key === "ArrowRight" ? 80 : -80;
    });
  }
  const chartPopover = document.getElementById("chartPopover");
  if (chartPopover) {
    chartPopover.addEventListener("mouseenter", () => clearTimeout(popTimer));
    chartPopover.addEventListener("mouseleave", armHideCluster);
  }
  document.addEventListener("click", (event) => {
    const pop = document.getElementById("chartPopover");
    if (!pop || pop.hidden) return;
    if (pop.contains(event.target)) return;
    if (event.target.closest && event.target.closest(".count-dot")) return;
    hideCluster(true);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const pop = document.getElementById("chartPopover");
    if (pop && !pop.hidden) {
      const ids = clusterReturn;
      hideCluster(true);
      const dot = ids ? document.querySelector(`#chartScroll .count-dot[data-ids="${CSS.escape(ids)}"]`) : null;
      if (dot) dot.focus();
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (!active || !active.closest) return;
    const dot = active.closest("#chartScroll .dot[data-id]");
    const panel = active.closest("[data-detail-panel], #chartDetail, [data-event-id].is-selected");
    const toggleBtn = active.closest("[data-detail-for]");
    const id = (dot && dot.getAttribute("data-id"))
      || (panel && panel.getAttribute("data-detail-panel"))
      || (panel && panel.getAttribute("data-event-id"))
      || (toggleBtn && toggleBtn.getAttribute("data-detail-for"));
    if (!id || !state.open.has(id)) return;
    if (!dot && !panel && !toggleBtn) return;
    if (panel && !panel.closest("#events-view, #timeline, #chartDetail") && !toggleBtn) return;
    event.preventDefault();
    const fromChart = !!(dot || active.closest("#chartDetail"));
    toggle(id, fromChart);
  });
  wireDisclosures(document);
  new MutationObserver(() => {
    if (document.documentElement.dataset.view === "events" && chartDirty) scheduleChart(chartRows);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-view"] });
  const clear = document.getElementById("clearFilters");
  if (clear) clear.addEventListener("click", clearFilters);
  const themeButton = document.getElementById("themeButton");
  if (themeButton) {
    themeButton.addEventListener("click", () => {
      const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", next === "light" ? "#eef1f6" : "#0b0f16");
      try { localStorage.setItem("moonshot-theme", next); } catch (err) { /* ignore */ }
      paintThemeButton();
    });
  }
  if (window.moonshotWatch) {
    window.moonshotWatch.subscribe(() => {
      if (document.body.dataset.ready !== "true") return;
      render();
    });
  }
  window.addEventListener("popstate", () => {
    if (!events.length && !upcoming.length) return;
    readUrl();
    mountFilters();
    render();
  });
}

if (typeof document !== "undefined") {
  bindChrome();
  main();
}
