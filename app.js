const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PAGE = 100;
const TIERS = [["all", "All"], ["material", "Material"], ["setback", "Setback"], ["background", "Background"]];
const RANGES = [["30", "Last 30 days"], ["90", "Last 90 days"], ["12m", "Last 12 months"], ["all", "All"], ["upcoming", "Upcoming"]];
const BANDS = [
  ["all", "All"],
  ["micro", "Micro (US$5-100M)"],
  ["main", "Main (US$100M-5B)"],
  ["large", "Large"],
  ["private", "Private"],
];
const MARKETS = ["London", "ASX", "Norway", "Nordic", "Tel Aviv"];
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
  tier: "all",
  range: "12m",
  band: "all",
  types: [],
  sector: "all",
  market: "all",
  category: "all",
  country: "all",
  background: false,
  shown: PAGE,
  open: new Set(),
};

let events = [];
let upcoming = [];
let typeOptions = [];
let sectorOptions = [];
let countryOptions = [];
let screenCodes = new Set();

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
  if (left.length >= 6 && right.length >= 6 && (left.includes(right) || right.includes(left))) return true;
  return false;
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
  const text = String(listing || "");
  if (/unlisted/i.test(text)) return "";
  const match = text.match(/:\s*([A-Za-z0-9]{1,8})\b/);
  return match ? match[1].toUpperCase() : "";
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

function findProfile(profiles, name) {
  for (const profile of profiles) {
    if (namesClose(profile.name, name) || namesClose(profile.label, name)) return profile;
  }
  return null;
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
    label: row.name,
    code: row.code || "",
    band: bandKeyFromLabel(row.band),
    markets: [listingMarket(row.exchange)],
    sector: sectorOfType(row.type),
    countries: [],
    onScreen: true,
  }));
  norwayCompanies.forEach((company) => {
    const existing = findProfile(profiles, company.short_name) || findProfile(profiles, company.name);
    if (existing) {
      if (!existing.markets.includes("Norway")) existing.markets.push("Norway");
      if (!existing.band) existing.band = norwayBand(company);
      if (!existing.code) existing.code = tickerFromListing(company.listing_ticker);
      return;
    }
    profiles.push({
      name: company.name,
      label: company.short_name || company.name,
      code: tickerFromListing(company.listing_ticker),
      band: norwayBand(company),
      markets: ["Norway"],
      sector: "Oil and gas",
      countries: [],
      onScreen: false,
    });
  });
  assignCountries(profiles, countryIndex);
  return profiles;
}

function classify(material, setback, isUpcoming) {
  const flags = { material: !!material, setback: !!setback, background: false };
  flags.background = !flags.material && !flags.setback && !isUpcoming;
  return flags;
}

function rowShell(id, when, companies, fields) {
  return {
    id,
    sort: when.sort,
    precision: when.precision,
    companies,
    type: fields.type || "",
    category: fields.category || "",
    headline: fields.headline || "",
    sourceUrl: fields.sourceUrl || "",
    affects: [],
    pilots: [],
    reaction: fields.reaction || "",
    note: fields.note || "",
    slip: "",
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
    const profile = findProfile(profiles, company.name) || blankProfile(company.name);
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
      sourceUrl: event.source_url || "",
      material: event.material === "Y",
      setback: event.setback === "Y",
      upcoming: upcomingFlag,
      note: event.note || "",
    }));
  });

  pilotRows.forEach((row, index) => {
    const when = parseDate(row.date, row.date && /^\d{4}-\d{2}$/.test(row.date) ? "month" : "exact");
    if (!when) return;
    const meta = byTicker.get(row.ticker);
    let profile = findProfile(profiles, row.company);
    if (!profile) {
      profile = {
        name: row.company,
        label: row.company,
        code: row.ticker,
        band: bandFromCap(meta && meta.market_cap_usd_m),
        markets: [],
        sector: PILOT_SECTORS[meta && meta.sector] || "",
        countries: [],
        onScreen: false,
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
      const sameCompany = item.companies.some((company) => namesClose(company.label, row.company) || namesClose(company.name, row.company));
      if (!sameCompany || !datesClose(item.sort, item.precision, row.date)) return;
      const score = headlineScore(item.headline, row.what_happened);
      if (score > best) { host = item; best = score; }
    });
    if (host) {
      host.pilots.push(pilot);
      if (!host.sourceUrl && pilot.sourceUrl) host.sourceUrl = pilot.sourceUrl;
      return;
    }
    const made = rowShell(`p:${row.ticker}:${row.date}:${index}`, when, [profile], {
      type: pilot.risk,
      headline: row.what_happened || "",
      sourceUrl: pilot.sourceUrl,
      material: row.material === "Y",
      setback: false,
    });
    made.pilots.push(pilot);
    rows.push(made);
  });

  rows.forEach((item) => {
    item.affects = affectsFor(readAcross, item.companies, item.sort, item.precision, item.headline);
  });
  rows.sort((a, b) => b.sort.localeCompare(a.sort) || showText(a.companies[0] && a.companies[0].label).localeCompare(showText(b.companies[0] && b.companies[0].label)) || a.id.localeCompare(b.id));

  const forward = (coming.items || []).map((item) => {
    const when = parseDate(item.anchor, item.precision || "exact");
    if (!when) return null;
    const profile = profiles.find((company) => codesMatch(company.code, item.company_code)) || findProfile(profiles, item.company_name) || {
      ...blankProfile(item.company_name || item.company_code || "Company"),
      code: item.company_code || "",
      markets: item.market ? [item.market] : [],
      sector: item.sector || "",
      onScreen: screenCodes.has(item.company_code),
    };
    if (!profile.countries.length) {
      const found = countryIndex.get(profile.code);
      if (found) profile.countries = [...found];
    }
    const row = rowShell(`u:${item.id}`, when, [profile], {
      type: displayType(item.type),
      category: item.category || "",
      headline: item.headline || "",
      sourceUrl: item.source_url || "",
      material: item.material === "Y",
      setback: false,
      upcoming: true,
    });
    row.affects = affectsFor(readAcross, row.companies, row.sort, row.precision, row.headline);
    row.slip = slipTitle(slipped, row.companies, row.headline, row.sort, item.precision || row.precision);
    row.label = item.date_label || formatSort(row.sort, row.precision);
    return row;
  }).filter(Boolean);
  forward.sort((a, b) => a.sort.localeCompare(b.sort) || a.id.localeCompare(b.id));

  const types = new Set();
  const sectors = new Set();
  rows.concat(forward).forEach((item) => {
    if (item.type) types.add(item.type);
    item.companies.forEach((company) => { if (company.sector) sectors.add(company.sector); });
  });
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

function tierOk(item) {
  if (state.tier === "material") return item.material;
  if (state.tier === "setback") return item.setback;
  if (state.tier === "background") return item.background;
  if (item.background) return state.background;
  return true;
}

function filtered() {
  const today = todayIso();
  const query = state.q.trim().toLowerCase();
  const source = state.range === "upcoming" ? upcoming : events;
  return source.filter((item) => {
    if (!tierOk(item)) return false;
    if (state.range !== "upcoming" && !dateOk(item, today)) return false;
    if (state.band !== "all" && !item.companies.some((company) => company.band === state.band)) return false;
    if (state.types.length && !state.types.includes(item.type)) return false;
    if (state.sector !== "all" && !item.companies.some((company) => company.sector === state.sector)) return false;
    if (state.market !== "all" && !item.companies.some((company) => company.markets.includes(state.market))) return false;
    if (state.category !== "all" && item.category !== state.category) return false;
    if (state.country !== "all" && !item.companies.some((company) => (company.countries || []).includes(state.country))) return false;
    if (query) {
      const blob = [item.headline, ...item.companies.flatMap((company) => [company.label, company.name, company.code])].join(" ").replaceAll("&", "and").toLowerCase();
      if (!blob.includes(query)) return false;
    }
    return true;
  });
}

function isDefault() {
  return !state.q.trim() && state.tier === "all" && state.range === "12m" && state.band === "all" && !state.types.length && state.sector === "all" && state.market === "all" && state.category === "all" && state.country === "all" && !state.background;
}

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  state.q = params.get("q") || "";
  const tier = params.get("tier");
  state.tier = TIERS.some(([value]) => value === tier) ? tier : "all";
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
  state.background = params.get("bg") === "1";
  state.shown = PAGE;
}

function writeUrl() {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.tier !== "all") params.set("tier", state.tier);
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
  return key === "range" ? "12m" : "all";
}

function selectField(key, label, choices, current) {
  const select = el("select", { "data-filter": key, "aria-label": label });
  choices.forEach(([value, text]) => select.append(el("option", { value, text })));
  select.value = current;
  select.addEventListener("change", () => {
    state[key] = select.value;
    state.shown = PAGE;
    select.closest(".field").classList.toggle("active", select.value !== fieldDefault(key));
    writeUrl();
    render();
  });
  const field = el("label", { class: "field" }, [label, select]);
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
      summary.textContent = typeSummary();
      menu.closest(".field").classList.toggle("active", state.types.length > 0);
      state.shown = PAGE;
      writeUrl();
      render();
    });
    menu.append(el("label", {}, [input, type]));
  });
  const typeField = el("div", { class: state.types.length ? "field type active" : "field type" }, [
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
      event.currentTarget.setAttribute("aria-pressed", state.background ? "true" : "false");
      event.currentTarget.closest(".field").classList.toggle("active", state.background);
      state.shown = PAGE;
      writeUrl();
      render();
    },
    text: "Show background",
  });

  document.getElementById("event-bar").replaceChildren(
    searchField,
    selectField("tier", "Tier", TIERS, state.tier),
    selectField("range", "Date", RANGES, state.range),
    selectField("band", "Size band", BANDS, state.band),
    typeField,
    selectField("sector", "Sector", [["all", "All"], ...sectorOptions.map((value) => [value, value])], state.sector),
    selectField("market", "Market", [["all", "All"], ...MARKETS.map((value) => [value, value])], state.market),
    selectField("category", "Category", [["all", "All"], ...CATEGORIES.map((value) => [value, value])], state.category),
    selectField("country", "Country", [["all", "All"], ...countryOptions.map((value) => [value, value])], state.country),
    el("label", { class: state.background ? "field active" : "field" }, ["Background", background]),
  );
}

function clearFilters() {
  state.q = "";
  state.tier = "all";
  state.range = "12m";
  state.band = "all";
  state.types = [];
  state.sector = "all";
  state.market = "all";
  state.category = "all";
  state.country = "all";
  state.background = false;
  state.shown = PAGE;
  state.open.clear();
  mountFilters();
  writeUrl();
  render();
}

function companyNode(company) {
  const body = [
    el("span", { class: "cap-name", text: showText(company.label || company.name) }),
    company.code ? el("span", { class: "co-ticker", text: showText(company.code) }) : null,
  ];
  if (!company.onScreen || !company.code) return el("span", { class: "tl-plain" }, body);
  return el("button", {
    type: "button",
    class: "co-link",
    onClick: (event) => {
      event.stopPropagation();
      if (typeof window.moonshotOpenScreen === "function") window.moonshotOpenScreen(company.code);
    },
  }, body);
}

function tagNodes(item) {
  return [
    item.category ? el("span", { class: "cat-tag", text: showText(item.category) }) : null,
    item.setback ? el("span", { class: "no-badge setback", text: "Setback" }) : null,
    item.affects.length ? el("span", { class: "also-tag", text: `Also affects: ${item.affects.join(", ")}` }) : null,
    item.slip ? el("span", { class: "slip-tag", title: item.slip, text: "Past guided date" }) : null,
  ];
}

function sourceLink(url, label) {
  const href = safeUrl(url);
  if (!href) return el("span", { text: "—" });
  return el("a", {
    href,
    target: "_blank",
    rel: "noopener noreferrer",
    onClick: (event) => event.stopPropagation(),
    text: label || "Source",
  });
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

function detailNode(item) {
  const parts = [];
  if (item.reaction) parts.push(el("p", { class: "label-notes", text: `Reaction: ${item.reaction}` }));
  item.pilots.forEach((pilot) => parts.push(pilotBlock(pilot)));
  if (item.note) parts.push(el("p", { class: "label-notes", text: showText(item.note) }));
  return parts.length ? el("div", { class: "cap-expand" }, parts) : null;
}

function hasDetail(item) {
  return !!(item.reaction || item.pilots.length || item.note);
}

function toggle(id) {
  if (state.open.has(id)) state.open.delete(id);
  else state.open.add(id);
  render();
}

function onRowKey(event, id) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  toggle(id);
}

function dateNode(item) {
  const text = item.label || formatSort(item.sort, item.precision);
  return el("span", {}, [
    text,
    item.precision === "month" ? el("span", { class: "precision", text: "Month" }) : null,
  ]);
}

function renderTable(rows) {
  const table = el("table", { class: "register timeline" });
  const head = el("tr");
  ["Date", "Company", "Type", "Headline", "Source"].forEach((label) => head.append(el("th", { scope: "col", text: label })));
  table.append(el("thead", {}, [head]));
  const body = el("tbody");
  rows.forEach((item) => {
    const open = state.open.has(item.id);
    const detail = hasDetail(item);
    const main = el("tr", {
      class: open ? "is-open" : "",
      tabindex: detail ? "0" : null,
      role: detail ? "button" : null,
      "aria-expanded": detail ? (open ? "true" : "false") : null,
      onClick: detail ? () => toggle(item.id) : null,
      onKeydown: detail ? (event) => onRowKey(event, item.id) : null,
    });
    main.append(
      el("td", { class: "date" }, [dateNode(item)]),
      el("td", {}, [el("span", { class: "tl-cos" }, item.companies.map(companyNode))]),
      el("td", {}, [el("span", { class: "tl-tags" }, [item.type ? showText(item.type) : "—", item.category ? el("span", { class: "cat-tag", text: showText(item.category) }) : null])]),
      el("td", {}, [el("span", { class: "tl-headline" }, [el("span", { text: showText(item.headline) }), el("span", { class: "tl-tags" }, tagNodes(item).slice(1))])]),
      el("td", {}, [sourceLink(item.sourceUrl)]),
    );
    body.append(main);
    if (open) {
      const extra = detailNode(item);
      if (extra) body.append(el("tr", { class: "tl-detail" }, [el("td", { colspan: "5" }, [extra])]));
    }
  });
  table.append(body);
  return table;
}

function renderCards(rows) {
  return rows.map((item) => {
    const open = state.open.has(item.id);
    const detail = hasDetail(item);
    return el("article", {
      class: open ? "card is-selected" : "card",
      tabindex: detail ? "0" : null,
      role: detail ? "button" : null,
      "aria-expanded": detail ? (open ? "true" : "false") : null,
      onClick: detail ? () => toggle(item.id) : null,
      onKeydown: detail ? (event) => onRowKey(event, item.id) : null,
    }, [
      el("div", { class: "card-top" }, [el("time", { text: item.label || formatSort(item.sort, item.precision) }), item.type ? el("span", { text: showText(item.type) }) : null]),
      el("div", { class: "tl-cos" }, item.companies.map(companyNode)),
      el("p", { class: "card-what", text: showText(item.headline) }),
      el("div", { class: "tl-tags" }, tagNodes(item)),
      el("div", { class: "card-meta" }, [sourceLink(item.sourceUrl)]),
      open ? detailNode(item) : null,
    ]);
  });
}

function subtitle() {
  if (state.range === "upcoming") return "Coming up, soonest first.";
  const tier = state.tier === "all"
    ? (state.background ? "All tiers" : "Material and setbacks")
    : TIERS.find(([value]) => value === state.tier)[1];
  const range = state.range === "all" ? "all dates" : RANGES.find(([value]) => value === state.range)[1].toLowerCase();
  return `${tier}, ${range}. Newest first.`;
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
    empty.replaceChildren(el("strong", { text: "Nothing in this view" }), el("p", { text: "No events match these filters." }));
    document.getElementById("tableWrap").replaceChildren();
    document.getElementById("cards").replaceChildren();
    more.hidden = true;
    return;
  }
  empty.hidden = true;
  document.getElementById("tableWrap").replaceChildren(renderTable(visible));
  document.getElementById("cards").replaceChildren(...renderCards(visible));
  more.hidden = visible.length >= rows.length;
}

function showError() {
  const loading = document.getElementById("loading");
  if (loading) loading.hidden = true;
  document.getElementById("main").prepend(el("p", { class: "error", text: "The register could not be loaded. Refresh the page to try again." }));
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(path);
  return response.json();
}

async function main() {
  try {
    const [eventsCsv, companiesCsv, screen, norwayEvents, norwayCompanies, falklands, namibia, guyana, southAfrica, readAcross, slipped, coming] = await Promise.all([
      fetch("data/events.csv", { cache: "no-cache" }).then((response) => { if (!response.ok) throw new Error("events"); return response.text(); }),
      fetch("data/companies.csv", { cache: "no-cache" }).then((response) => { if (!response.ok) throw new Error("companies"); return response.text(); }),
      loadJson("data/smallcaps.json"),
      loadJson("data/norway_events.json"),
      loadJson("data/norway_companies.json"),
      loadJson("data/falklands.json"),
      loadJson("data/namibia.json"),
      loadJson("data/guyana.json"),
      loadJson("data/south_africa.json"),
      loadJson("data/read_across.json"),
      loadJson("data/slipped.json"),
      loadJson("data/coming_up.json"),
    ]);
    screenCodes = new Set(screen.map((row) => row.code).filter(Boolean));
    const built = buildTimeline(
      screen,
      norwayEvents,
      norwayCompanies,
      rowsToObjects(eventsCsv),
      rowsToObjects(companiesCsv),
      [falklands, namibia, guyana, southAfrica],
      readAcross,
      slipped,
      coming,
    );
    events = built.events;
    upcoming = built.upcoming;
    typeOptions = built.types;
    sectorOptions = built.sectors;
    countryOptions = built.countries;
    readUrl();
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
