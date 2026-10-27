const FILES = ["data/falklands.json", "data/namibia.json", "data/guyana.json", "data/south_africa.json"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

function isListed(value) {
  return value === true || value === "Y";
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

function formatWhen(date, precision) {
  if (!date || precision === "undated") return "Date not set";
  const match = String(date).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!match) return showText(date);
  const year = match[1];
  const monthIndex = Number(match[2]) - 1;
  const month = MONTHS[monthIndex];
  if (!month) return showText(date);
  if (precision === "year") return year;
  if (precision === "half") return `${monthIndex < 6 ? "H1" : "H2"} ${year}`;
  if (precision === "quarter") return `Q${Math.floor(monthIndex / 3) + 1} ${year}`;
  if (precision === "month") return `${month} ${year}`;
  return `${Number(match[3] || 1)} ${month} ${year}`;
}

function companyLines(company) {
  const interests = Array.isArray(company.interests) && company.interests.length
    ? company.interests
    : [{
      licence: company.licence,
      working_interest: company.working_interest,
      operator: company.operator,
      stage: company.stage,
      basin: company.basin,
    }];
  return interests.map((interest) => ({
    code: company.code || "",
    name: company.name,
    listed: isListed(company.in_dataset) && !!company.code,
    sector: company.sector,
    licence: interest.licence,
    interest: interest.working_interest,
    operator: interest.operator,
    stage: interest.stage,
    basin: interest.basin,
  }));
}

function nameNode(row) {
  const label = el("span", {}, [
    el("span", { class: "cap-name", text: showText(row.name) }),
    row.code ? el("span", { class: "cap-code", text: showText(row.code) }) : null,
    row.sector === "Oil and gas" && showText(row.basin) !== "—" ? el("span", { class: "place-label", text: showText(row.basin) }) : null,
  ]);
  if (!row.listed) return label;
  return el("button", {
    type: "button",
    class: "co-link",
    onClick: () => {
      if (typeof window.moonshotOpenScreen === "function") window.moonshotOpenScreen(row.code);
    },
  }, [label]);
}

function affectedNodes(catalyst) {
  const affected = Array.isArray(catalyst.affected) && catalyst.affected.length
    ? catalyst.affected
    : (catalyst.affected_codes || []).map((code) => ({ code, interest: "" }));
  if (!affected.length) return el("span", { text: "—" });
  return el("span", { class: "affected-list" }, affected.map((entry) => {
    const code = entry.code || "";
    const interest = showText(entry.interest);
    const text = interest === "—" ? showText(code) : `${showText(code)} ${interest}`;
    const listed = entry.in_dataset !== false && !!code;
    if (!listed) return el("span", { class: "affected-plain", text });
    return el("button", {
      type: "button",
      class: "co-link affected-link",
      onClick: () => {
        if (typeof window.moonshotOpenScreen === "function") window.moonshotOpenScreen(code);
      },
      text,
    });
  }));
}

function sourceLink(url) {
  const href = safeUrl(url);
  if (!href) return null;
  return el("a", { href, target: "_blank", rel: "noopener noreferrer", text: "Source" });
}

function netBadge(net) {
  if (net === "tight") return el("span", { class: "no-badge tight", text: "Tight" });
  if (net === "loose") return el("span", { class: "no-badge loose", text: "Loose" });
  return null;
}

function categoryTag(value) {
  const text = showText(value);
  if (text === "—") return null;
  return el("span", { class: "cat-tag", text });
}

function companyTable(rows) {
  const table = el("table", { class: "register countries" });
  const head = el("tr");
  ["Company", "Sector", "Licence", "Interest", "Operator", "Stage"].forEach((label) => {
    head.append(el("th", { scope: "col", text: label }));
  });
  table.append(el("thead", {}, [head]));
  const body = el("tbody");
  rows.forEach((row) => {
    const tr = el("tr");
    tr.append(
      el("td", {}, [nameNode(row)]),
      el("td", { text: showText(row.sector) }),
      el("td", { text: showText(row.licence) }),
      el("td", { text: showText(row.interest) }),
      el("td", { text: showText(row.operator) }),
      el("td", { text: showText(row.stage) }),
    );
    body.append(tr);
  });
  table.append(body);
  return table;
}

function companyCards(rows) {
  return el("div", { class: "cards" }, rows.map((row) => el("article", { class: "card" }, [
    nameNode(row),
    el("p", { class: "card-meta", text: showText(row.sector) }),
    el("p", { text: showText(row.licence) }),
    el("p", { class: "card-meta", text: [showText(row.interest), showText(row.operator), showText(row.stage)].join(" · ") }),
  ])));
}

function catalystRows(catalysts) {
  return catalysts.map((catalyst) => ({
    sort: catalyst.date || "9999-99-99",
    date: formatWhen(catalyst.date, catalyst.date_precision),
    headline: catalyst.headline,
    url: catalyst.source_url,
    type: catalyst.type,
    category: catalyst.category,
    net: catalyst.net,
    affected: catalyst,
  }));
}

function catalystTable(rows) {
  const table = el("table", { class: "register catalysts" });
  const head = el("tr");
  ["Date", "Catalyst", "Companies"].forEach((label) => head.append(el("th", { scope: "col", text: label })));
  table.append(el("thead", {}, [head]));
  const body = el("tbody");
  rows.forEach((row) => {
    const tr = el("tr");
    tr.append(
      el("td", {}, [el("span", { class: "cap-date", text: row.date })]),
      el("td", {}, [
        el("span", { class: "cap-line" }, [
          sourceLink(row.url) ? el("a", { href: safeUrl(row.url), target: "_blank", rel: "noopener noreferrer", text: showText(row.headline) }) : el("span", { text: showText(row.headline) }),
        ]),
        el("span", { class: "cap-kind" }, [showText(row.type) === "—" ? null : el("span", { text: showText(row.type) }), categoryTag(row.category), netBadge(row.net)]),
      ]),
      el("td", {}, [affectedNodes(row.affected)]),
    );
    body.append(tr);
  });
  table.append(body);
  return table;
}

function catalystCards(rows) {
  return el("div", { class: "cards" }, rows.map((row) => el("article", { class: "card" }, [
    el("span", { class: "cap-date", text: row.date }),
    el("p", {}, [
      safeUrl(row.url)
        ? el("a", { href: safeUrl(row.url), target: "_blank", rel: "noopener noreferrer", text: showText(row.headline) })
        : showText(row.headline),
    ]),
    el("p", { class: "cap-kind" }, [categoryTag(row.category), netBadge(row.net)]),
    affectedNodes(row.affected),
  ])));
}

function section(file) {
  const companies = (file.companies || []).flatMap(companyLines);
  const catalysts = catalystRows(file.catalysts || []).sort((a, b) => a.sort.localeCompare(b.sort) || a.headline.localeCompare(b.headline));
  const later = catalystRows(file.beyond_window || []).sort((a, b) => a.sort.localeCompare(b.sort));
  return el("section", { class: "country-block", "data-country": file.country }, [
    el("h3", { text: showText(file.country) }),
    el("p", { class: "eyebrow", text: "Companies" }),
    el("div", { class: "table-wrap wide-only cap-scroll" }, [companyTable(companies)]),
    el("div", { class: "narrow-only" }, [companyCards(companies)]),
    el("p", { class: "eyebrow", text: "Catalysts" }),
    catalysts.length
      ? el("div", {}, [
        el("div", { class: "table-wrap wide-only cap-scroll" }, [catalystTable(catalysts)]),
        el("div", { class: "narrow-only" }, [catalystCards(catalysts)]),
      ])
      : el("p", { class: "cap-desc", text: "No dated catalysts." }),
    later.length
      ? el("div", {}, [
        el("p", { class: "eyebrow", text: "Further out" }),
        el("div", { class: "table-wrap wide-only cap-scroll" }, [catalystTable(later)]),
        el("div", { class: "narrow-only" }, [catalystCards(later)]),
      ])
      : null,
  ]);
}

async function load() {
  const files = await Promise.all(FILES.map(async (path) => {
    const response = await fetch(path, { cache: "no-cache" });
    if (!response.ok) throw new Error(path);
    return response.json();
  }));
  document.getElementById("countries-loading").hidden = true;
  document.getElementById("countries-body").replaceChildren(...files.map(section));
  document.body.dataset.countries = String(files.length);
}

function boot() {
  load().catch(() => {
    const loading = document.getElementById("countries-loading");
    if (loading) loading.hidden = true;
    const body = document.getElementById("countries-body");
    if (body) body.replaceChildren(el("p", { class: "error", text: "Countries could not be loaded. Refresh the page to try again." }));
  });
}

if (typeof document !== "undefined") boot();
