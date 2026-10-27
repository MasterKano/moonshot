const openIds = new Set();
const state = {
  horizon: "30",
  market: "all",
  sector: "all",
  category: "all",
  materialOnly: false,
  watchOnly: false,
  significance: "all",
  direction: "all",
  status: "all",
  confidence: "all",
};
let items = [];
let slipped = [];
let fundingByCode = new Map();

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

function isoFromLocal(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function shiftMonths(iso, months) {
  const [year, month, day] = iso.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), Math.min(day, last))).toISOString().slice(0, 10);
}

function horizonEnd(today) {
  if (state.horizon === "12m") return shiftMonths(today, 12);
  return addDays(today, Number(state.horizon));
}

function horizonLabel() {
  if (state.horizon === "12m") return "12 months";
  return `${state.horizon} days`;
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

function inView(item, today, end) {
  if (item.anchor < today || item.anchor > end) return false;
  if (state.market !== "all" && item.market !== state.market) return false;
  if (state.sector !== "all" && item.sector !== state.sector) return false;
  if (state.category !== "all" && item.category !== state.category) return false;
  if (state.significance === "material" && item.significance && item.significance !== "material" && item.direction !== "negative") return false;
  if (state.significance === "background" && item.significance !== "background") return false;
  if (state.direction !== "all" && item.direction !== state.direction) return false;
  if (state.status !== "all" && item.status !== state.status) return false;
  if (state.confidence !== "all" && item.date_confidence_level !== state.confidence) return false;
  if (state.watchOnly && !(window.moonshotWatch && window.moonshotWatch.has(item.company_code))) return false;
  return true;
}

function noun(count) {
  return count === 1 ? "event" : "events";
}

function openItem(item) {
  if (typeof window.moonshotOpenScreen === "function") window.moonshotOpenScreen(item.link_key);
}

function companyButton(item) {
  return el("button", {
    type: "button",
    class: "co-link",
    onClick: (event) => {
      event.stopPropagation();
      openItem(item);
    },
  }, [
    el("span", { class: "cap-name", text: showText(item.company_name) }),
    el("span", { class: "cap-code", text: showText(item.company_code) }),
  ]);
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

function runwayChipFor(item) {
  const block = fundingByCode.get(item.company_code);
  if (!block || String(block.next_catalyst_id || "") !== String(item.id || "")) return null;
  const key = String(block.runway_check || "not covered").trim().toLowerCase();
  const pair = RUNWAY_LABELS[key] || RUNWAY_LABELS["not covered"];
  return el("span", {
    class: `chip chip-${pair[1]} chip-runway`,
    title: "A rough check from public filings. Not advice.",
    text: pair[0],
  });
}

function dateCell(item) {
  const proxy = item.sort_date_is_proxy === true;
  const text = proxy && item.date_window_text ? item.date_window_text : item.date_label;
  return el("span", { class: "date-stack" }, [
    el("span", { class: "cap-name", text: showText(text) }),
    basisTag(item.date_basis),
    !proxy && item.approx ? el("span", { class: "no-conf", text: "approx." }) : null,
    runwayChipFor(item),
  ]);
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

function codesMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const bare = (value) => String(value).replace(/\.(OL|ST|HE)$/i, "");
  return bare(a) === bare(b);
}

function dateHasPassed(item) {
  const date = String(item?.anchor || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const precision = item.precision || "exact";
  if (precision === "quarter" || precision === "half" || precision === "year" || precision === "undated") return false;
  const today = isoFromLocal(new Date());
  if (precision === "month") return date.slice(0, 7) < today.slice(0, 7);
  return date < today;
}

function slippedRecord(item) {
  return slipped.find((entry) => codesMatch(entry.code, item.company_code) && headlinesClose(entry.item_headline, item.headline)) || null;
}

function trendChip(trend, status) {
  const key = String(trend || "").toLowerCase();
  if (key === "no update found") return el("span", { class: "chip chip-trend-none", title: "The guided window has not moved in the notes on file.", text: "No update found" });
  if (status === "slipped" || status === "overdue") return null;
  if (key.includes("slipped")) return el("span", { class: "slip-tag", title: "The guided window moved later.", text: "Slipped" });
  return null;
}

function statusFlag(item) {
  if (item.status === "overdue") return el("span", { class: "slip-tag", title: "The guided window has ended.", text: "Overdue" });
  if (item.status === "slipped") return el("span", { class: "slip-tag", title: "The guided window moved later.", text: "Slipped" });
  return null;
}

function guidanceBlock(item) {
  const history = Array.isArray(item.guidance_history) ? item.guidance_history : [];
  if (!history.length && !item.guidance_trend) return el("p", { class: "label-notes", text: "No guidance history on file." });
  return el("div", { class: "guidance-block" }, [
    el("p", { class: "eyebrow", text: "Guidance history" }),
    trendChip(item.guidance_trend, item.status),
    history.length ? el("ul", { class: "guidance-list" }, history.map((entry) => {
      const href = safeUrl(entry.source_url_if_any);
      return el("li", {}, [
        el("span", { class: "cap-date", text: showText(entry.date_seen) }),
        el("span", { text: showText(entry.window_text) }),
        href ? el("a", { href, target: "_blank", rel: "noopener noreferrer", text: "Source" }) : null,
      ]);
    })) : null,
  ]);
}

function slipTag(item) {
  const record = slippedRecord(item);
  if (!record && !dateHasPassed(item)) return null;
  const title = record
    ? `Originally guided: ${showText(record.originally_guided)}. Checked ${showText(record.checked_date)}.`
    : "This guided date has passed.";
  return el("span", { class: "slip-tag", title, text: "Past guided date" });
}

function chip(text, kind, title) {
  return el("span", { class: `chip chip-${kind}`, title: title || "", text });
}

function labelChips(item) {
  const confidence = item.date_confidence_level || "";
  const confidenceLabel = confidence === "high" ? "High" : confidence === "medium" ? "Medium" : confidence === "low" ? "Low" : "";
  const statusLabel = { upcoming: "Upcoming", overdue: "Overdue", slipped: "Slipped", done: "Done" }[item.status] || "";
  return [
    item.direction === "positive" ? chip("Positive", "positive", "The event moved the asset forward.") : null,
    item.direction === "neutral" ? chip("Neutral", "neutral", "The event does not clearly help or hurt.") : null,
    item.direction === "negative" ? chip("Setback", "setback", "A dry hole, a delay, or another step backward.") : null,
    item.significance === "material" ? chip("Material", "material", "Large enough to matter for the company.") : null,
    item.significance === "background" ? chip("Background", "background", "A routine item, or too small to change the story.") : null,
    statusLabel ? chip(statusLabel, item.status, "Where this guided item stands.") : null,
    confidenceLabel ? chip(confidenceLabel, `conf-${confidence}`, "How firmly the date is known.") : null,
  ];
}

function materialNode(item) {
  return item.material === "Y" ? el("span", { class: "no-badge", text: "Material" }) : null;
}

function categoryTag(value) {
  const text = showText(value);
  if (text === "—") return null;
  return el("span", { class: "cat-tag", text });
}

function badges(item) {
  return el("span", { class: "chip-row" }, [statusFlag(item), trendChip(item.guidance_trend, item.status), ...labelChips(item), slipTag(item)]);
}

function headlineNode(item) {
  const text = showText(item.headline);
  const href = safeUrl(item.source_url);
  if (!href) return el("span", { text });
  return el("a", { href, target: "_blank", rel: "noopener noreferrer", text });
}

function renderTable(rows) {
  const table = el("table", { class: "register coming" });
  const head = el("thead");
  const headRow = el("tr");
  [["Date", "The guided window. A proxy day stays in words."], ["Company", "The company this item belongs to."], ["Market", "Where the shares trade."], ["Event type", "The kind of event."], ["Headline", "What is expected."], ["Labels", "Direction, significance, status, and date confidence."]].forEach(([label, tip]) => {
    headRow.append(el("th", { scope: "col", title: tip, text: label }));
  });
  head.append(headRow);
  table.append(head);
  const body = el("tbody");
  rows.forEach((item) => {
    const open = openIds.has(item.id);
    const row = el("tr", {
      class: open ? "is-open" : "",
      "data-coming-id": item.id,
      onClick: (event) => {
        if (event.target.closest("a, button, summary, input, select, label")) return;
        if (openIds.has(item.id)) openIds.delete(item.id);
        else openIds.add(item.id);
        render();
        focusComing(item.id);
      },
    });
    row.append(
      el("td", {}, [dateCell(item), statusFlag(item), slipTag(item)]),
      el("td", {}, [companyButton(item)]),
      el("td", { text: showText(item.market) }),
      el("td", {}, [el("span", { class: "cap-kind" }, [showText(item.event_type || item.type), categoryTag(item.category)])]),
      el("td", {}, [headlineNode(item)]),
      el("td", {}, [
        badges(item),
        el("button", {
          type: "button",
          class: "detail-toggle",
          "data-coming-id": item.id,
          "aria-expanded": open ? "true" : "false",
          onClick: (event) => {
            event.stopPropagation();
            if (openIds.has(item.id)) openIds.delete(item.id);
            else openIds.add(item.id);
            render();
            focusComing(item.id);
          },
          text: open ? "Close" : "Details",
        }),
      ]),
    );
    body.append(row);
    if (open) body.append(el("tr", { class: "tl-detail", "data-coming-id": item.id }, [el("td", { colspan: "6" }, [el("div", { class: "detail-panel", "data-detail-panel": item.id }, [guidanceBlock(item)])])]));
  });
  table.append(body);
  document.getElementById("coming-table").replaceChildren(rows.length ? table : []);
}

function renderCards(rows) {
  const root = document.getElementById("coming-cards");
  root.replaceChildren(...rows.map((item) => el("article", { class: "card" }, [
    el("span", { class: "card-top" }, [dateCell(item), statusFlag(item), badges(item)]),
    el("details", { class: "guidance-block", "data-coming-id": item.id, onClick: (event) => event.stopPropagation() }, [
      el("summary", { text: "Guidance history" }),
      guidanceBlock(item),
    ]),
    companyButton(item),
    el("p", { class: "card-meta" }, [`${showText(item.market)} · ${showText(item.type)} `, categoryTag(item.category)]),
    el("p", { class: "card-what" }, [headlineNode(item)]),
  ])));
}

function focusComing(id) {
  requestAnimationFrame(() => {
    const nodes = [...document.querySelectorAll(`[data-coming-id="${CSS.escape(id)}"]`)];
    const btn = nodes.find((node) => node.tagName === "BUTTON" && node.getClientRects().length);
    const summary = nodes.find((node) => node.tagName === "DETAILS" && node.getClientRects().length)?.querySelector("summary");
    const target = btn || summary;
    if (target) target.focus();
  });
}

function render() {
  const today = isoFromLocal(new Date());
  const end = horizonEnd(today);
  const scoped = items.filter((item) => inView(item, today, end));
  const rows = (state.materialOnly ? scoped.filter((item) => item.material === "Y") : scoped)
    .slice()
    .sort((a, b) => String(a.sort_date || a.anchor).localeCompare(String(b.sort_date || b.anchor)) || String(a.id).localeCompare(String(b.id)));
  const label = horizonLabel();
  const showing = rows.length === scoped.length
    ? `Showing ${rows.length} ${noun(rows.length)}. Next ${label}.`
    : `Showing ${rows.length} of ${scoped.length} ${noun(scoped.length)}. Next ${label}.`;
  document.getElementById("coming-showing").textContent = showing;
  const empty = document.getElementById("coming-empty");
  if (!rows.length) {
    document.getElementById("coming-table").replaceChildren();
    document.getElementById("coming-cards").replaceChildren();
    empty.hidden = false;
    const pinned = window.moonshotWatch ? window.moonshotWatch.codes().length : 0;
    const title = state.watchOnly && !pinned ? "No companies pinned" : state.watchOnly ? "No pinned companies" : "No events in this window";
    const detail = state.watchOnly && !pinned
      ? "Star a company to build a watchlist."
      : state.watchOnly
        ? "No pinned companies in this window."
        : "Widen the range, or set the filters back to All.";
    empty.replaceChildren(el("strong", { text: title }), el("p", { text: detail }));
  } else {
    empty.hidden = true;
    renderTable(rows);
    renderCards(rows);
  }
  const material = document.getElementById("coming-material");
  if (material) material.setAttribute("aria-pressed", state.materialOnly ? "true" : "false");
  if (window.moonshotWireDisclosures) window.moonshotWireDisclosures(document.getElementById("coming"));
  document.body.dataset.coming = String(items.length);
  document.body.dataset.comingShown = String(rows.length);
  document.body.dataset.comingEnd = end;
}

function filterSelect(key, label, options) {
  const select = el("select", { [`data-coming-${key}`]: "1" });
  select.append(el("option", { value: "all", text: "All" }));
  options.forEach((option) => {
    const value = Array.isArray(option) ? option[0] : option;
    const text = Array.isArray(option) ? option[1] : option;
    select.append(el("option", { value, text }));
  });
  select.addEventListener("change", () => {
    state[key] = select.value;
    select.closest(".field").classList.toggle("active", select.value !== "all");
    render();
  });
  const tips = {
    Market: "Where the shares trade.",
    Sector: "Oil and gas, mining, or another sector.",
    Category: "Operational, capital and deals, or corporate.",
    Significance: "Material events, or the routine background ones.",
    Direction: "Whether the event helped, was neutral, or was a setback.",
    Status: "Where a guided item stands.",
    "Date confidence": "How firmly the date is known. High, medium, or low.",
  };
  return el("label", { class: "field", title: tips[label] || "" }, [label, select]);
}

function mountFilters() {
  document.getElementById("coming-filters").replaceChildren(
    filterSelect("market", "Market", ["London", "Norway", "Nordic", "Tel Aviv", "Paris", "Frankfurt", "Milan", "Amsterdam"]),
    filterSelect("sector", "Sector", ["Oil and gas", "Mining"]),
    filterSelect("category", "Category", ["Operational", "Capital and deals", "Corporate"]),
    filterSelect("significance", "Significance", [["material", "Material"], ["background", "Background"]]),
    filterSelect("direction", "Direction", [["positive", "Positive"], ["neutral", "Neutral"], ["negative", "Setback"]]),
    filterSelect("status", "Status", [["upcoming", "Upcoming"], ["overdue", "Overdue"], ["slipped", "Slipped"], ["done", "Done"]]),
    filterSelect("confidence", "Date confidence", [["high", "High"], ["medium", "Medium"], ["low", "Low"]]),
    el("label", { class: "field" }, [
      "Material",
      el("button", {
        type: "button",
        class: "toggle-btn",
        id: "coming-material",
        "aria-pressed": "false",
        onClick: () => {
          state.materialOnly = !state.materialOnly;
          render();
        },
        text: "Material only",
      }),
    ]),
    el("label", { class: state.watchOnly ? "field active" : "field" }, [
      "Watchlist",
      el("button", {
        type: "button",
        class: "toggle-btn",
        id: "coming-watch",
        "aria-pressed": state.watchOnly ? "true" : "false",
        onClick: (event) => {
          state.watchOnly = !state.watchOnly;
          event.currentTarget.setAttribute("aria-pressed", state.watchOnly ? "true" : "false");
          event.currentTarget.closest(".field").classList.toggle("active", state.watchOnly);
          render();
        },
        text: "Watchlist",
      }),
    ]),
  );
}

function bindHorizon() {
  document.getElementById("coming-horizon").addEventListener("click", (event) => {
    const button = event.target.closest("[data-horizon]");
    if (!button) return;
    state.horizon = button.dataset.horizon;
    document.querySelectorAll("#coming-horizon [data-horizon]").forEach((node) => {
      node.setAttribute("aria-checked", node === button ? "true" : "false");
    });
    render();
  });
}

function showError() {
  const loading = document.getElementById("coming-loading");
  if (loading) loading.hidden = true;
  const empty = document.getElementById("coming-empty");
  empty.hidden = false;
  empty.replaceChildren(el("p", { class: "error", text: "Coming up could not be loaded. Refresh the page to try again." }));
}

async function load() {
  const [response, slipResponse, screenResponse] = await Promise.all([
    fetch("data/coming_up.json", { cache: "no-cache" }),
    fetch("data/slipped.json", { cache: "no-cache" }),
    fetch("data/smallcaps.json", { cache: "no-cache" }),
  ]);
  if (!response.ok || !slipResponse.ok || !screenResponse.ok) throw new Error("coming");
  const data = await response.json();
  const slipData = await slipResponse.json();
  const screen = await screenResponse.json();
  items = Array.isArray(data.items) ? data.items : [];
  slipped = Array.isArray(slipData) ? slipData : [];
  fundingByCode = new Map();
  (Array.isArray(screen) ? screen : []).forEach((row) => {
    if (row && row.code && row.funding && typeof row.funding === "object") fundingByCode.set(row.code, row.funding);
  });
  document.getElementById("coming-loading").hidden = true;
  mountFilters();
  bindHorizon();
  render();
}

function boot() {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const active = document.activeElement;
    if (!active || !active.closest || !active.closest("#coming")) return;
    const details = active.closest("details[open]");
    if (details) {
      event.preventDefault();
      details.open = false;
      const summary = details.querySelector("summary");
      if (summary) summary.focus();
      return;
    }
    const host = active.closest("[data-coming-id]");
    if (!host) return;
    const id = host.getAttribute("data-coming-id");
    if (!id || !openIds.has(id)) return;
    event.preventDefault();
    openIds.delete(id);
    render();
    focusComing(id);
  });
  if (window.moonshotWatch) {
    window.moonshotWatch.subscribe(() => {
      if (!document.body.dataset.coming) return;
      render();
    });
  }
  load().catch(showError);
}

if (typeof document !== "undefined") boot();
