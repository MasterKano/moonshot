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


def ticker_code(company):
    ticker = clean(company.get("listing_ticker"))
    symbol = ticker.split(":")[-1].strip() if ":" in ticker else ""
    if symbol and "," not in symbol and "(" not in symbol and len(symbol) <= 8:
        return symbol
    return clean(company.get("short_name"))


def band_value(value):
    text = clean(value).lower()
    return text if text in ("tight", "loose") else ""


def item_record(**fields):
    record = dict(fields)
    for key in ("company_name", "company_code", "headline", "type", "date_label"):
        record[key] = clean(record.get(key))
    return record


def london_items(rows):
    items = []
    for row in rows:
        if clean(row.get("exchange")) == "ASX":
            continue
        code = clean(row.get("code"))
        name = clean(row.get("name"))
        for index, raw in enumerate(row.get("upcoming") or []):
            if not isinstance(raw, dict) or not raw.get("date"):
                continue
            anchor, label, approx, suffix = place(raw.get("date"), raw.get("date_precision") or "exact")
            items.append(item_record(
                id=f"L-{code}-{raw.get('date')}-{index}",
                anchor=anchor.isoformat(),
                precision=raw.get("date_precision") or "exact",
                date_label=label,
                approx=approx,
                suffix=suffix,
                market="London",
                company_name=name,
                company_code=code,
                link_key=code,
                type=display_type(raw.get("type")),
                headline=clean(raw.get("headline")),
                band=band_value(raw.get("net")),
                material="Y" if raw.get("material_if_delivered") == "Y" else "N",
                source_url=clean(raw.get("source_url")),
            ))
    return items


def norway_items(events, companies):
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
        items.append(item_record(
            id=f"N-{clean(event.get('id')) or event.get('date')}",
            anchor=anchor.isoformat(),
            precision=confidence,
            date_label=label,
            approx=approx,
            suffix=suffix,
            market="Norway",
            company_name=clean(company.get("name")) or short,
            company_code=ticker_code(company) if company else short,
            link_key=short,
            type=display_type(event.get("type")),
            headline=clean(event.get("title")),
            band=band_value(event.get("net")),
            material="Y" if event.get("material") == "Y" else "N",
            source_url=clean(event.get("source_url")),
        ))
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
            f"Market: {item['market']}. Type: {item['type']}. "
            f"Company: {item['company_name']} ({item['company_code']}). "
            f"Material: {'Yes' if item['material'] == 'Y' else 'No'}. Band: {band}."
        )
        if item["source_url"]:
            description += f" Source: {item['source_url']}"
        props = [
            "BEGIN:VEVENT",
            f"SUMMARY:{escape_ics(summary)}",
            f"DTSTART;VALUE=DATE:{start.strftime('%Y%m%d')}",
            f"DTEND;VALUE=DATE:{end.strftime('%Y%m%d')}",
            f"DTSTAMP:{stamp}",
            f"UID:{item['id']}@moonshot",
            f"CATEGORIES:{escape_ics(item['market'])}",
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
    items = london_items(screen) + norway_items(norway, companies)
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
    text = json.dumps(payload)
    if "&" in text or b"&" in (ROOT / "coming_up.ics").read_bytes():
        raise SystemExit("ampersand leaked into coming up output")
    print(f"as_of {today.isoformat()}")
    print(f"items {len(forward)} london {sum(1 for item in forward if item['market'] == 'London')} norway {sum(1 for item in forward if item['market'] == 'Norway')}")
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
