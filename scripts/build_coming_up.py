#!/usr/bin/env python3
"""Build the Coming up list and calendar from the screen and Norway files.

Reads data/smallcaps.json, data/norway_events.json, and data/norway_companies.json.
Writes data/coming_up.json and coming_up.ics. Run this again after those sources change.

Forward items are those whose calendar anchor is on or after the day this script runs.
Exact dates use that day. Month items use the 1st. Quarter, half, and year items use
the last day of the period. The page then applies the 30, 90, 180 day, and 12 month
windows on top of this list.
"""

import calendar
import json
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def clean(value):
    if value is None:
        return ""
    return str(value).replace("&", "and").replace("\r", " ").replace("\n", " ").strip()


def display_type(value):
    text = clean(value)
    if not text:
        return ""
    if text[0].islower():
        return text[0].upper() + text[1:]
    return text


def parse_iso(value):
    text = clean(value)
    year, month, day = (int(part) for part in text.split("-"))
    return date(year, month, day)


def month_end(year, month):
    return date(year, month, calendar.monthrange(year, month)[1])


def place(iso, precision):
    """Return anchor date, display label, approx flag, and calendar title suffix."""
    current = parse_iso(iso)
    kind = precision or "exact"
    if kind == "month":
        anchor = date(current.year, current.month, 1)
        label = f"{MONTHS[current.month - 1]} {current.year}"
        return anchor, label, False, " (month)"
    if kind == "quarter":
        quarter = (current.month - 1) // 3 + 1
        anchor = month_end(current.year, quarter * 3)
        label = f"Q{quarter} {current.year}"
        return anchor, label, True, f" (approx., {label})"
    if kind == "half":
        first = current.month <= 6
        anchor = date(current.year, 6, 30) if first else date(current.year, 12, 31)
        label = f"{'H1' if first else 'H2'} {current.year}"
        return anchor, label, True, f" (approx., {label})"
    if kind == "year":
        anchor = date(current.year, 12, 31)
        label = str(current.year)
        return anchor, label, True, f" (approx., {label})"
    if kind == "estimated":
        label = f"{current.day} {MONTHS[current.month - 1]} {current.year}"
        return current, label, True, " (approx.)"
    label = f"{current.day} {MONTHS[current.month - 1]} {current.year}"
    return current, label, False, ""


def ticker_symbol(company):
    ticker = clean(company.get("listing_ticker"))
    symbol = ticker.split(":")[-1].strip() if ":" in ticker else ""
    if symbol and "," not in symbol and "(" not in symbol and len(symbol) <= 8:
        return symbol
    return ""


def ticker_code(company):
    return ticker_symbol(company) or clean(company.get("short_name"))


def screen_market(exchange):
    text = clean(exchange).lower()
    if text == "asx":
        return "ASX"
    if "tel aviv" in text:
        return "Tel Aviv"
    venues = ("stockholm", "first north", "helsinki", "oslo børs", "oslo bors", "euronext growth oslo")
    if any(venue in text for venue in venues):
        return "Nordic"
    if "euronext paris" in text or "euronext growth paris" in text:
        return "Paris"
    if "frankfurt" in text or "xetra" in text:
        return "Frankfurt"
    if "euronext milan" in text or "borsa italiana" in text:
        return "Milan"
    if "euronext amsterdam" in text:
        return "Amsterdam"
    return "London"


def norm_head(value):
    return re.sub(r"[^a-z0-9]+", " ", clean(value).lower()).strip()


def content_tokens(value):
    return {word for word in norm_head(value).split() if len(word) > 2}


def headlines_close(left, right):
    """Same story: equal, one headline contains the other, or the wording overlaps."""
    a = norm_head(left)
    b = norm_head(right)
    if not a or not b:
        return False
    if a == b or a in b or b in a:
        return True
    shared = content_tokens(left) & content_tokens(right)
    if not shared:
        return False
    shorter = min(len(content_tokens(left)), len(content_tokens(right)))
    if "licence" in shared and ("extension" in shared or "extensions" in shared):
        return True
    return len(shared) >= 6 or (len(shared) >= 4 and shorter and len(shared) / shorter >= 0.55)


def remember(seen, code, date, headline):
    seen.add((clean(code), clean(date), norm_head(headline)))


def is_duplicate(seen, code, date, headline):
    code = clean(code)
    date = clean(date)
    if not code or not date or not norm_head(headline):
        return True
    for seen_code, seen_date, seen_head in seen:
        if seen_code != code or seen_date != date or not seen_head:
            continue
        if headlines_close(headline, seen_head):
            return True
    return False


def sector_of(type_value):
    """Oil and gas stays Oil and gas. Every other commodity, including Helium and Coal, is Mining."""
    text = clean(type_value)
    suffix = " (low confidence)"
    if text.endswith(suffix):
        text = text[: -len(suffix)].strip()
    return "Oil and gas" if text == "Oil and gas" else "Mining"


def name_matches(short_name, company_name):
    short = clean(short_name).lower()
    name = clean(company_name).lower()
    if not short or not name:
        return False
    if short in re.split(r"[^a-z0-9]+", name):
        return True
    return name == short or name.startswith(short + " ")


def match_screen(company, rows):
    symbol = ticker_symbol(company).upper()
    if symbol:
        for row in rows:
            if clean(row.get("code")).upper() == symbol:
                return row
    for row in rows:
        if name_matches(company.get("short_name"), row.get("name")):
            return row
    return None


def band_value(value):
    text = clean(value).lower()
    return text if text in ("tight", "loose") else ""


def item_record(**fields):
    record = dict(fields)
    for key in ("company_name", "company_code", "headline", "type", "date_label"):
        record[key] = clean(record.get(key))
    return record


CARRY_KEYS = (
    "event_type",
    "direction",
    "significance",
    "significance_reason",
    "status",
    "date_confidence_level",
    "date_window_text",
    "date_basis",
    "date_basis_reason",
    "sort_date",
    "guidance_trend",
    "source_status",
    "source_link_level",
    "last_checked",
)


def carry_history(entries):
    if not isinstance(entries, list):
        return []
    cleaned = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        item = {}
        seen = clean(entry.get("date_seen"))
        window = clean(entry.get("window_text"))
        url = clean_url(entry.get("source_url_if_any"))
        if seen:
            item["date_seen"] = seen
        if window:
            item["window_text"] = window
        if url:
            item["source_url_if_any"] = url
        if item:
            cleaned.append(item)
    return cleaned


def carry_sources(value):
    if not isinstance(value, list):
        return []
    urls = []
    for entry in value:
        if isinstance(entry, str):
            url = clean_url(entry)
        elif isinstance(entry, dict):
            url = clean_url(entry.get("url") or entry.get("href"))
        else:
            url = ""
        if url and url not in urls:
            urls.append(url)
    return urls


def carried(raw):
    """Keep guidance, status, and date-basis fields that the page already shows."""
    if not isinstance(raw, dict):
        return {}
    extra = {}
    for key in CARRY_KEYS:
        value = raw.get(key)
        if value is None or value == "":
            continue
        if isinstance(value, str):
            text = clean(value)
            if text:
                extra[key] = text
        else:
            extra[key] = value
    if isinstance(raw.get("sort_date_is_proxy"), bool):
        extra["sort_date_is_proxy"] = raw["sort_date_is_proxy"]
    history = carry_history(raw.get("guidance_history"))
    if history:
        extra["guidance_history"] = history
    sources = carry_sources(raw.get("sources"))
    if sources:
        extra["sources"] = sources
    confidence = clean(raw.get("date_confidence")).lower()
    if confidence in ("high", "medium", "low"):
        extra["date_confidence"] = confidence
    return extra


def with_source(record, raw):
    record.update(carried(raw))
    return record


def clean_url(value):
    if value is None:
        return ""
    return str(value).replace("\r", " ").replace("\n", " ").strip()


def london_items(rows, seen):
    items = []
    for row in rows:
        market = screen_market(row.get("exchange"))
        if market == "ASX":
            continue
        code = clean(row.get("code"))
        name = clean(row.get("name"))
        prefix = {"Nordic": "D", "Tel Aviv": "T", "Paris": "U", "Frankfurt": "U", "Milan": "U", "Amsterdam": "U"}.get(market, "L")
        for index, raw in enumerate(row.get("upcoming") or []):
            if not isinstance(raw, dict) or not raw.get("date"):
                continue
            anchor, label, approx, suffix = place(raw.get("date"), raw.get("date_precision") or "exact")
            source_id = clean(raw.get("id"))
            items.append(with_source(item_record(
                id=source_id or f"{prefix}-{code}-{raw.get('date')}-{index}",
                anchor=anchor.isoformat(),
                precision=raw.get("date_precision") or "exact",
                date_label=label,
                approx=approx,
                suffix=suffix,
                market=market,
                sector=sector_of(row.get("type")),
                category=clean(raw.get("category")),
                company_name=name,
                company_code=code,
                link_key=code,
                type=display_type(raw.get("type")),
                headline=clean(raw.get("headline")),
                band=band_value(raw.get("net")),
                material="Y" if raw.get("material_if_delivered") == "Y" else "N",
                source_url=clean_url(raw.get("source_url")),
            ), raw))
            remember(seen, code, raw.get("date"), raw.get("headline"))
    return items


def affected_codes(catalyst):
    affected = catalyst.get("affected") or []
    if affected:
        for entry in affected:
            if isinstance(entry, dict) and clean(entry.get("code")):
                yield clean(entry.get("code"))
        return
    for code in catalyst.get("affected_codes") or []:
        if clean(code):
            yield clean(code)


def country_items(screen, seen):
    """Catalysts whose code, date, and headline are not already on the screen or the shelf."""
    by_code = {clean(row.get("code")): row for row in screen}
    names = {
        "falklands.json": "FK",
        "namibia.json": "NA",
        "guyana.json": "GY",
        "south_africa.json": "ZA",
        "gabon.json": "GA",
        "angola.json": "AO",
        "colombia.json": "CO",
    }
    items = []
    for filename, slug in names.items():
        path = ROOT / "data" / filename
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for index, catalyst in enumerate(data.get("catalysts") or []):
            if not catalyst.get("date") or catalyst.get("status") == "past":
                continue
            try:
                anchor, label, approx, suffix = place(catalyst.get("date"), catalyst.get("date_precision") or "exact")
            except (TypeError, ValueError):
                continue
            headline = clean(catalyst.get("headline"))
            for code in affected_codes(catalyst):
                row = by_code.get(code)
                if not row or is_duplicate(seen, code, catalyst.get("date"), headline):
                    continue
                remember(seen, code, catalyst.get("date"), headline)
                market = screen_market(row.get("exchange"))
                items.append(with_source(item_record(
                    id=clean(catalyst.get("id")) or f"C-{slug}-{code}-{catalyst.get('date')}-{index}",
                    anchor=anchor.isoformat(),
                    precision=catalyst.get("date_precision") or "exact",
                    date_label=label,
                    approx=approx,
                    suffix=suffix,
                    market=market,
                    sector=sector_of(row.get("type")),
                    category=clean(catalyst.get("category")),
                    company_name=clean(row.get("name")),
                    company_code=code,
                    link_key=code,
                    type=display_type(catalyst.get("type")),
                    headline=headline,
                    band=band_value(catalyst.get("net")),
                    material="N",
                    source_url=clean_url(catalyst.get("source_url")),
                ), catalyst))
    return items


def norway_items(events, companies, screen, seen):
    """Shelf events stay market Norway. A name already on the London screen, such as Kistos, keeps that screen code."""
    by_short = {clean(company.get("short_name")): company for company in companies}
    items = []
    for event in events:
        if not event.get("date"):
            continue
        confidence = event.get("date_confidence") or "exact"
        anchor, label, approx, suffix = place(event.get("date"), confidence)
        operator = clean(event.get("operator"))
        names = [clean(name) for name in (event.get("companies") or []) if clean(name)]
        short = operator if operator in by_short else (names[0] if names else "")
        company = by_short.get(short, {})
        matched = match_screen(company, screen) if company else None
        if matched:
            code = clean(matched.get("code"))
            name = clean(matched.get("name"))
        else:
            code = ticker_code(company) if company else short
            name = clean(company.get("name")) or short
        items.append(with_source(item_record(
            id=f"N-{clean(event.get('id')) or event.get('date')}",
            anchor=anchor.isoformat(),
            precision=confidence,
            date_label=label,
            approx=approx,
            suffix=suffix,
            market="Norway",
            sector="Oil and gas",
            category=clean(event.get("category")),
            company_name=name,
            company_code=code,
            link_key=code,
            type=display_type(event.get("type")),
            headline=clean(event.get("title")),
            band=band_value(event.get("net")),
            material="Y" if event.get("material") == "Y" else "N",
            source_url=clean_url(event.get("source_url")),
        ), event))
        remember(seen, code, event.get("date"), event.get("title"))
    return items


def escape_ics(value):
    return clean(value).replace("\\", "\\\\").replace(";", r"\;").replace(",", r"\,")


def fold(line):
    data = line.encode("utf-8")
    parts = []
    limit = 75
    while data:
        if len(data) <= limit:
            parts.append(data)
            break
        cut = limit
        while cut > 0 and (data[cut] & 0xC0) == 0x80:
            cut -= 1
        if cut <= 0:
            cut = limit
        parts.append(data[:cut])
        data = data[cut:]
        limit = 74
    return parts[0] + b"".join(b"\r\n " + part for part in parts[1:])


def ics_document(items, stamp):
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Moonshot Coming up//EN",
        "X-WR-CALNAME:Moonshot coming up",
    ]
    for item in items:
        start = date.fromisoformat(item["anchor"])
        end = start + timedelta(days=1)
        summary = f"{item['company_name']} ({item['company_code']}): {item['headline']}{item['suffix']}"
        band = {"tight": "Tight", "loose": "Loose"}.get(item["band"], "n/a")
        description = (
            f"Market: {item['market']}. Sector: {item.get('sector') or 'Mining'}. "
            f"Category: {item.get('category') or 'n/a'}. Type: {item['type']}. "
            f"Company: {item['company_name']} ({item['company_code']}). "
            f"Material: {'Yes' if item['material'] == 'Y' else 'No'}. Band: {band}."
        )
        if item["source_url"] and "&" not in item["source_url"]:
            description += f" Source: {item['source_url']}"
        categories = ",".join(
            escape_ics(part) for part in (item.get("market"), item.get("category")) if part
        )
        props = [
            "BEGIN:VEVENT",
            f"SUMMARY:{escape_ics(summary)}",
            f"DTSTART;VALUE=DATE:{start.strftime('%Y%m%d')}",
            f"DTEND;VALUE=DATE:{end.strftime('%Y%m%d')}",
            f"DTSTAMP:{stamp}",
            f"UID:{item['id']}@moonshot",
            f"CATEGORIES:{categories}",
            f"DESCRIPTION:{escape_ics(description)}",
        ]
        if item["source_url"]:
            props.append(f"URL:{item['source_url']}")
        props.append("END:VEVENT")
        lines.extend(props)
    lines.append("END:VCALENDAR")
    return b"\r\n".join(fold(line) for line in lines) + b"\r\n"


def main():
    today = date.today()
    screen = json.loads((ROOT / "data" / "smallcaps.json").read_text(encoding="utf-8"))
    norway = json.loads((ROOT / "data" / "norway_events.json").read_text(encoding="utf-8"))
    companies = json.loads((ROOT / "data" / "norway_companies.json").read_text(encoding="utf-8"))
    seen = set()
    items = london_items(screen, seen) + norway_items(norway, companies, screen, seen)
    items += country_items(screen, seen)
    forward = [item for item in items if item["anchor"] >= today.isoformat()]
    forward.sort(key=lambda item: (item["anchor"], item["market"], item["company_name"], item["id"]))
    payload = {
        "as_of": today.isoformat(),
        "note": "Generated by scripts/build_coming_up.py. Do not edit by hand.",
        "items": forward,
    }
    # Keep suffix in the JSON so the page and feed share one label. The page does not show suffix.
    (ROOT / "data" / "coming_up.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    (ROOT / "coming_up.ics").write_bytes(ics_document(forward, stamp))
    def without_urls(value):
        if isinstance(value, dict):
            return {
                key: without_urls(item)
                for key, item in value.items()
                if key not in ("source_url", "source_url_if_any", "href", "url") and not str(key).endswith("_url")
            }
        if isinstance(value, list):
            return [without_urls(item) for item in value]
        if isinstance(value, str) and (value.startswith("http://") or value.startswith("https://")):
            return ""
        return value

    visible = json.dumps(without_urls(forward), ensure_ascii=False)
    ics_lines = []
    skipping_url = False
    for line in (ROOT / "coming_up.ics").read_bytes().decode("utf-8").split("\r\n"):
        if line.startswith("URL:"):
            skipping_url = True
            continue
        if skipping_url and line.startswith(" "):
            continue
        skipping_url = False
        ics_lines.append(line)
    if "&" in visible or "&" in "\n".join(ics_lines):
        raise SystemExit("ampersand leaked into coming up output")
    print(f"as_of {today.isoformat()}")
    names = ("London", "Norway", "Nordic", "Tel Aviv", "ASX", "Paris", "Frankfurt", "Milan", "Amsterdam")
    counts = {name: sum(1 for item in forward if item["market"] == name) for name in names}
    print(
        f"items {len(forward)} london {counts['London']} norway {counts['Norway']} "
        f"nordic {counts['Nordic']} telaviv {counts['Tel Aviv']} asx {counts['ASX']} "
        f"paris {counts['Paris']} frankfurt {counts['Frankfurt']} milan {counts['Milan']} amsterdam {counts['Amsterdam']}"
    )
    for label, end in (
        ("30", today + timedelta(days=30)),
        ("90", today + timedelta(days=90)),
        ("180", today + timedelta(days=180)),
        ("12m", date(today.year + 1, today.month, min(today.day, calendar.monthrange(today.year + 1, today.month)[1]))),
    ):
        count = sum(1 for item in forward if item["anchor"] <= end.isoformat())
        material = sum(1 for item in forward if item["anchor"] <= end.isoformat() and item["material"] == "Y")
        print(f"window {label} through {end.isoformat()}: {count} material {material}")


if __name__ == "__main__":
    main()
