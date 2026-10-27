const state = { horizon: "30", market: "all", sector: "all", materialOnly: false };
let items = [];

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
    onClick: () => openItem(item),
  }, [
    el("span", { class: "cap-name", text: showText(item.company_name) }),
    el("span", { class: "cap-code", text: showText(item.company_code) }),
  ]);
}

function dateCell(item) {
  return el("span", {}, [
    el("span", { class: "cap-name", text: showText(item.date_label) }),
    item.approx ? el("span", { class: "no-conf", text: "approx." }) : null,
  ]);
}

function bandNode(item) {
  if (item.band === "tight") return el("span", { class: "no-badge tight", text: "Tight" });
  if (item.band === "loose") return el("span", { class: "no-badge loose", text: "Loose" });
  return null;
}

function materialNode(item) {
  return item.material === "Y" ? el("span", { class: "no-badge", text: "Material" }) : null;
}

function badges(item) {
  return el("span", { class: "no-chips" }, [bandNode(item), materialNode(item)]);
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
  ["Date", "Company", "Market", "Type", "Headline", "Band", "Material"].forEach((label) => {
    headRow.append(el("th", { scope: "col", text: label }));
  });
  head.append(headRow);
  table.append(head);
  const body = el("tbody");
  rows.forEach((item) => {
    const row = el("tr");
    row.append(
      el("td", {}, [dateCell(item)]),
      el("td", {}, [companyButton(item)]),
      el("td", { text: showText(item.market) }),
      el("td", { text: showText(item.type) }),
      el("td", {}, [headlineNode(item)]),
      el("td", {}, [bandNode(item)]),
      el("td", {}, [materialNode(item)]),
    );
    body.append(row);
  });
  table.append(body);
  document.getElementById("coming-table").replaceChildren(rows.length ? table : []);
}

function renderCards(rows) {
  const root = document.getElementById("coming-cards");
  root.replaceChildren(...rows.map((item) => el("article", { class: "card" }, [
    el("span", { class: "card-top" }, [dateCell(item), badges(item)]),
    companyButton(item),
    el("p", { class: "card-meta", text: `${showText(item.market)} · ${showText(item.type)}` }),
    el("p", { class: "card-what" }, [headlineNode(item)]),
  ])));
}

function render() {
  const today = isoFromLocal(new Date());
  const end = horizonEnd(today);
  const scoped = items.filter((item) => inView(item, today, end));
  const rows = state.materialOnly ? scoped.filter((item) => item.material === "Y") : scoped;
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
    empty.replaceChildren(
      el("strong", { text: "No events in this window" }),
      el("p", { text: "Widen the range, or set the filters back to All." }),
    );
  } else {
    empty.hidden = true;
    renderTable(rows);
    renderCards(rows);
  }
  const material = document.getElementById("coming-material");
  if (material) material.setAttribute("aria-pressed", state.materialOnly ? "true" : "false");
  document.body.dataset.coming = String(items.length);
  document.body.dataset.comingShown = String(rows.length);
  document.body.dataset.comingEnd = end;
}

function filterSelect(key, label, options) {
  const select = el("select", { [`data-coming-${key}`]: "1" });
  select.append(el("option", { value: "all", text: "All" }), ...options.map((value) => el("option", { value, text: value })));
  select.addEventListener("change", () => {
    state[key] = select.value;
    select.closest(".field").classList.toggle("active", select.value !== "all");
    render();
  });
  return el("label", { class: "field" }, [label, select]);
}

function mountFilters() {
  document.getElementById("coming-filters").replaceChildren(
    filterSelect("market", "Market", ["London", "Norway"]),
    filterSelect("sector", "Sector", ["Oil and gas", "Mining"]),
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
  const response = await fetch("data/coming_up.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("coming");
  const data = await response.json();
  items = Array.isArray(data.items) ? data.items : [];
  document.getElementById("coming-loading").hidden = true;
  mountFilters();
  bindHorizon();
  render();
}

function boot() {
  load().catch(showError);
}

if (typeof document !== "undefined") boot();
