const KEY = "moonshot-watch";
const CODE_RE = /^[A-Za-z0-9.]{1,15}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let pins = [];
const known = new Set();
const profiles = new Map();
const listeners = new Set();
let ready = false;

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

function bare(code) {
  return String(code || "").replace(/\.(OL|ST|HE)$/i, "");
}

function codesMatch(a, b) {
  if (!a || !b) return false;
  const left = String(a);
  const right = String(b);
  if (left.toUpperCase() === right.toUpperCase()) return true;
  const leftBare = bare(left);
  const rightBare = bare(right);
  const leftSuffixed = leftBare !== left;
  const rightSuffixed = rightBare !== right;
  if (leftSuffixed === rightSuffixed) return false;
  if (leftBare.toUpperCase() !== rightBare.toUpperCase()) return false;
  const bareKey = leftBare.toUpperCase();
  const suffixed = (leftSuffixed ? left : right).toUpperCase();
  const hasBare = [...known].some((code) => code.toUpperCase() === bareKey);
  const hasSuffixed = [...known].some((code) => code.toUpperCase() === suffixed);
  if (hasBare && hasSuffixed) return false;
  return true;
}

function has(code) {
  return pins.some((pin) => codesMatch(pin, code));
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(pins)); } catch (err) { /* ignore */ }
}

function readStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    raw.forEach((code) => {
      const text = String(code || "").trim();
      if (!CODE_RE.test(text) || seen.has(text)) return;
      seen.add(text);
      out.push(text);
    });
    return out;
  } catch (err) {
    return [];
  }
}

function importFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("watch")) return;
  const seen = new Set();
  const next = [];
  String(params.get("watch") || "").split(",").forEach((part) => {
    const code = part.trim();
    if (!CODE_RE.test(code) || seen.has(code)) return;
    seen.add(code);
    next.push(code);
  });
  pins = next;
  persist();
  params.delete("watch");
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", nextUrl);
}

function shareUrl() {
  if (!pins.length) return "";
  const list = pins.map((code) => encodeURIComponent(code)).join(",");
  return `${window.location.origin}${window.location.pathname}?watch=${list}`;
}

function paintStars() {
  document.querySelectorAll(".star[data-code]").forEach((button) => {
    const code = button.getAttribute("data-code");
    const on = has(code);
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.textContent = on ? "★" : "☆";
    const name = button.getAttribute("data-name") || code;
    button.setAttribute("aria-label", `${on ? "Unpin" : "Pin"} ${name}`);
  });
}

function notify() {
  const snapshot = pins.slice();
  listeners.forEach((fn) => {
    try { fn(snapshot); } catch (err) { /* ignore */ }
  });
}

function save() {
  persist();
  paintStars();
  notify();
  renderPanel();
}

function toggle(code) {
  const text = String(code || "").trim();
  if (!CODE_RE.test(text)) return;
  const index = pins.findIndex((pin) => codesMatch(pin, text));
  if (index >= 0) pins.splice(index, 1);
  else pins.push(text);
  save();
}

function star(code, name) {
  const text = String(code || "").trim();
  if (!CODE_RE.test(text)) return null;
  const on = has(text);
  const label = name || text;
  return el("button", {
    type: "button",
    class: "star",
    "data-code": text,
    "data-name": label,
    "aria-pressed": on ? "true" : "false",
    "aria-label": `${on ? "Unpin" : "Pin"} ${label}`,
    onClick: (event) => {
      event.stopPropagation();
      event.preventDefault();
      toggle(text);
    },
    text: on ? "★" : "☆",
  });
}

function formatWhen(date, precision) {
  const match = String(date || "").match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!match) return "";
  const year = match[1];
  const monthIndex = Number(match[2]) - 1;
  const month = MONTHS[monthIndex];
  if (!month) return "";
  if (precision === "year") return year;
  if (precision === "half") return `${monthIndex < 6 ? "H1" : "H2"} ${year}`;
  if (precision === "quarter") return `Q${Math.floor(monthIndex / 3) + 1} ${year}`;
  if (precision === "month" || !match[3]) return `${month} ${year}`;
  return `${Number(match[3])} ${month} ${year}`;
}

function anchorOf(date, precision) {
  const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (precision === "year") return `${match[1]}-12-31`;
  if (precision === "half") return month <= 6 ? `${match[1]}-06-30` : `${match[1]}-12-31`;
  if (precision === "quarter") {
    const endMonth = Math.ceil(month / 3) * 3;
    const endDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
    return `${match[1]}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
  }
  if (precision === "month") return `${match[1]}-${match[2]}-01`;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function todayIso() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function norm(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parentPhrase(parent) {
  if (!parent || typeof parent !== "object") return "";
  const name = showText(parent.name).replace(/\s+(ASA|AB|plc|SE|AG|S\.A\.|SA)$/i, "").trim();
  const ticker = showText(parent.ticker);
  if (!name || name === "—") return "";
  return ticker && ticker !== "—" ? `${name} (${ticker})` : name;
}

function shelfLabel(company) {
  const phrase = parentPhrase(company.parent_listed);
  if (company.listing_status === "subsidiary of listed" && phrase) return `${company.name}, part of ${phrase}`;
  return company.name || company.short_name || "";
}

function ensure(code, name, onScreen) {
  const text = String(code || "").trim();
  if (!text) return null;
  let profile = profiles.get(text);
  if (!profile) {
    profile = { code: text, name: name || text, onScreen: !!onScreen, events: [], upcoming: [] };
    profiles.set(text, profile);
    known.add(text);
  } else if (name && (profile.name === profile.code || !profile.name)) {
    profile.name = name;
  }
  if (onScreen) profile.onScreen = true;
  return profile;
}

function addUpcoming(profile, item) {
  if (!profile || !item || !item.headline) return;
  const anchor = item.anchor || anchorOf(item.date, item.precision);
  if (!anchor) return;
  const key = `${anchor}|${norm(item.headline)}`;
  if (profile.upcoming.some((row) => `${row.anchor}|${norm(row.headline)}` === key)) return;
  profile.upcoming.push({
    anchor,
    label: item.label || formatWhen(item.date, item.precision),
    headline: item.headline,
  });
}

function tickerSymbol(company) {
  const ticker = String(company.listing_ticker || "").trim();
  if (!ticker.includes(":")) return "";
  const symbol = ticker.split(":").pop().trim();
  if (!symbol || symbol.includes(",") || symbol.includes("(") || symbol.length > 8) return "";
  return symbol;
}

function nameMatches(shortName, companyName) {
  const short = String(shortName || "").trim().toLowerCase();
  const name = String(companyName || "").trim().toLowerCase();
  if (!short || !name) return false;
  if (name.split(/[^a-z0-9]+/).includes(short)) return true;
  return name === short || name.startsWith(`${short} `);
}

function findProfile(code, name) {
  if (code && profiles.has(code)) return profiles.get(code);
  if (code) {
    const upper = String(code).toUpperCase();
    for (const profile of profiles.values()) {
      if (String(profile.code).toUpperCase() === upper) return profile;
    }
  }
  if (name) {
    for (const profile of profiles.values()) {
      if (nameMatches(name, profile.name)) return profile;
    }
  }
  return null;
}

function build(screen, coming, norwayEvents, norwayCompanies, countries) {
  screen.forEach((row) => {
    if (!row || !row.code) return;
    const profile = ensure(row.code, row.name, true);
    (row.events || []).forEach((event) => {
      if (event && event.date && event.headline) profile.events.push({ date: event.date, headline: event.headline });
    });
    (row.upcoming || []).forEach((item) => {
      addUpcoming(profile, { date: item.date, precision: item.date_precision, headline: item.headline });
    });
  });
  norwayCompanies.forEach((company) => {
    const shortName = String(company.short_name || "").trim();
    const symbol = tickerSymbol(company);
    const code = symbol || shortName;
    if (!code) return;
    let profile = (symbol && findProfile(symbol, "")) || (!symbol && (findProfile("", shortName) || findProfile("", company.name)));
    if (!profile) profile = ensure(code, shelfLabel(company), true);
    else profile.onScreen = true;
    profile.listingStatus = company.listing_status || profile.listingStatus || "";
    norwayEvents.forEach((event) => {
      const names = Array.isArray(event.companies) ? event.companies : [];
      if (shortName && !names.includes(shortName) && event.operator !== shortName) return;
      if (event.upcoming === "Y") addUpcoming(profile, { date: event.date, precision: event.date_confidence, headline: event.title });
      else if (event.date && event.title) profile.events.push({ date: event.date, headline: event.title });
    });
  });
  countries.forEach((file) => {
    (file.companies || []).forEach((company) => {
      if (!company || !company.code) return;
      const listed = company.in_dataset === true || company.in_dataset === "Y";
      const existing = profiles.get(company.code);
      if (existing) {
        if (!existing.name || existing.name === existing.code) existing.name = company.name;
        return;
      }
      ensure(company.code, company.name, listed);
    });
  });
  (coming.items || []).forEach((item) => {
    const code = item.company_code;
    if (!code) return;
    let profile = profiles.get(code);
    if (!profile) {
      for (const [key, row] of profiles) {
        if (codesMatch(code, key)) {
          profile = row;
          break;
        }
      }
    }
    if (!profile) profile = ensure(code, item.company_name, false);
    addUpcoming(profile, { anchor: item.anchor, label: item.date_label, headline: item.headline });
  });
}

function profileFor(code) {
  if (profiles.has(code)) return profiles.get(code);
  const upper = String(code || "").toUpperCase();
  for (const [key, profile] of profiles) {
    if (String(key).toUpperCase() === upper || codesMatch(code, key)) return profile;
  }
  return { code, name: code, onScreen: false, events: [], upcoming: [] };
}

function latestOf(profile) {
  const events = (profile.events || []).filter((event) => event.date && event.headline);
  events.sort((a, b) => String(b.date).localeCompare(String(a.date)) || showText(a.headline).localeCompare(showText(b.headline)));
  return events[0] || null;
}

function nextOf(profile) {
  const today = todayIso();
  const items = (profile.upcoming || []).filter((item) => item.anchor >= today && item.headline);
  items.sort((a, b) => String(a.anchor).localeCompare(String(b.anchor)) || showText(a.headline).localeCompare(showText(b.headline)));
  return items[0] || null;
}

function nameControl(profile) {
  const label = el("span", {}, [
    el("span", { class: "cap-name", text: showText(profile.name) }),
    el("span", { class: "cap-code", text: showText(profile.code) }),
    (profile.listingStatus === "private" || profile.listingStatus === "state")
      ? el("span", { class: "not-listed", title: "Private or state entity, with no stock-exchange listing.", text: "Not listed" })
      : null,
  ]);
  if (!profile.onScreen) return label;
  return el("button", {
    type: "button",
    class: "co-link",
    onClick: () => {
      if (typeof window.moonshotOpenScreen === "function") window.moonshotOpenScreen(profile.code);
    },
  }, [label]);
}

function detailLine(label, item, empty) {
  const text = item
    ? `${item.label || formatWhen(item.date) || "—"}. ${showText(item.headline)}`
    : empty;
  return el("p", { class: "watch-line" }, [
    el("span", { class: "eyebrow", text: label }),
    el("span", { text }),
  ]);
}

function cardFor(code) {
  const profile = profileFor(code);
  return el("article", { class: "card watch-card" }, [
    el("div", { class: "co-with-star" }, [
      star(profile.code, profile.name),
      el("div", { class: "watch-body" }, [
        nameControl(profile),
        detailLine("Latest event", latestOf(profile), "No event on file."),
        detailLine("Next upcoming", nextOf(profile), "Nothing dated ahead."),
      ]),
    ]),
  ]);
}

function renderPanel() {
  const body = document.getElementById("watch-body");
  const link = document.getElementById("watch-link");
  const copy = document.getElementById("watch-copy");
  if (link) link.value = shareUrl();
  if (copy) copy.disabled = pins.length === 0;
  if (!body || !ready) return;
  if (!pins.length) {
    body.replaceChildren(el("div", { class: "empty" }, [
      el("strong", { text: "No companies pinned" }),
      el("p", { text: "Use the star on a screen row, a company card, or a country list." }),
    ]));
    return;
  }
  body.replaceChildren(...pins.map(cardFor));
}

async function copyLink() {
  const input = document.getElementById("watch-link");
  const button = document.getElementById("watch-copy");
  const url = shareUrl();
  if (!url) return;
  if (input) input.value = url;
  let copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
      copied = true;
    }
  } catch (err) {
    copied = false;
  }
  if (!copied && input) {
    input.focus();
    input.select();
  }
  if (!button) return;
  const previous = "Copy link";
  button.textContent = copied ? "Copied" : "Select the link";
  window.setTimeout(() => { button.textContent = previous; }, 1600);
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(path);
  return response.json();
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

function addPilots(companiesText, eventsText) {
  const wanted = new Set(["LUN", "MAU", "FDY", "LUNR", "ORRON", "FWZ", "LUG", "NGEX"]);
  const table = parseCsv(companiesText);
  if (table.length < 2) return;
  const headers = table[0].map((header) => header.trim());
  const companies = table.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((header, i) => { obj[header] = (cells[i] ?? "").trim(); });
    return obj;
  });
  const events = parseCsv(eventsText);
  const eventHeaders = events[0] ? events[0].map((header) => header.trim()) : [];
  const eventRows = events.slice(1).map((cells) => {
    const obj = {};
    eventHeaders.forEach((header, i) => { obj[header] = (cells[i] ?? "").trim(); });
    return obj;
  });
  companies.forEach((company) => {
    const code = String(company.ticker || "").toUpperCase();
    if (!wanted.has(code) || profiles.has(code)) return;
    const profile = ensure(code, company.company, true);
    profile.listingStatus = "listed";
    eventRows.filter((event) => String(event.ticker || "").toUpperCase() === code).forEach((event) => {
      if (event.date && event.what_happened) profile.events.push({ date: event.date, headline: event.what_happened });
    });
  });
}

async function loadText(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(path);
  return response.text();
}

async function load() {
  try {
    const [screen, coming, norwayEvents, norwayCompanies, pilotCompanies, pilotEvents, ...countries] = await Promise.all([
      loadJson("data/smallcaps.json"),
      loadJson("data/coming_up.json"),
      loadJson("data/norway_events.json"),
      loadJson("data/norway_companies.json"),
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
    build(
      Array.isArray(screen) ? screen : [],
      coming && typeof coming === "object" ? coming : { items: [] },
      Array.isArray(norwayEvents) ? norwayEvents : [],
      Array.isArray(norwayCompanies) ? norwayCompanies : [],
      countries,
    );
    addPilots(pilotCompanies, pilotEvents);
    ready = true;
    const loading = document.getElementById("watch-loading");
    if (loading) loading.hidden = true;
    renderPanel();
    notify();
  } catch (err) {
    ready = true;
    const loading = document.getElementById("watch-loading");
    if (loading) loading.hidden = true;
    const body = document.getElementById("watch-body");
    if (body) body.replaceChildren(el("p", { class: "error", text: "The watchlist could not be loaded. Refresh the page to try again." }));
  }
}

pins = readStorage();
importFromUrl();

window.moonshotWatch = {
  has,
  toggle,
  codes: () => pins.slice(),
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  shareUrl,
  star,
};

function boot() {
  const copy = document.getElementById("watch-copy");
  if (copy) copy.addEventListener("click", () => { copyLink(); });
  renderPanel();
  load();
}

if (typeof document !== "undefined") boot();
