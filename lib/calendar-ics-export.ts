import type { CalendarEvent } from "@/lib/jmap/types";

const MAX_LINE_OCTETS = 74;

function foldLine(line: string): string {
  if (line.length <= MAX_LINE_OCTETS) return line;
  const chunks: string[] = [line.slice(0, MAX_LINE_OCTETS)];
  let pos = MAX_LINE_OCTETS;
  while (pos < line.length) {
    chunks.push(" " + line.slice(pos, pos + MAX_LINE_OCTETS - 1));
    pos += MAX_LINE_OCTETS - 1;
  }
  return chunks.join("\r\n");
}

// RFC 5545 §3.3.11 - escape backslash, semicolon, comma, and newline in TEXT values.
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function stripDateSeparators(value: string): string {
  return value.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function dateOnly(value: string): string {
  return value.replace(/-/g, "").substring(0, 8);
}

function formatNow(): string {
  return stripDateSeparators(new Date().toISOString().replace(/\.\d{3}/, ""));
}

function pushDateProp(
  lines: string[],
  prop: "DTSTART" | "DTEND",
  value: string,
  showWithoutTime: boolean,
  tz?: string | null,
): void {
  if (showWithoutTime) {
    lines.push(`${prop};VALUE=DATE:${dateOnly(value)}`);
    return;
  }
  if (value.endsWith("Z")) {
    lines.push(`${prop}:${stripDateSeparators(value)}`);
    return;
  }
  const basic = stripDateSeparators(value);
  if (tz) {
    lines.push(`${prop};TZID=${tz}:${basic}`);
  } else {
    lines.push(`${prop}:${basic}`);
  }
}

function pushFrequencyRule(lines: string[], event: CalendarEvent): void {
  const rule = event.recurrenceRules?.[0];
  if (!rule) return;
  const parts: string[] = [`FREQ=${rule.frequency.toUpperCase()}`];
  if (rule.interval && rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.count != null) parts.push(`COUNT=${rule.count}`);
  if (rule.until) parts.push(`UNTIL=${stripDateSeparators(rule.until)}`);
  if (rule.byDay?.length) {
    // Single-pass concat — drops the intermediate map array.
    let days = '';
    for (let i = 0; i < rule.byDay.length; i++) {
      const d = rule.byDay[i];
      if (i > 0) days += ',';
      days += `${d.nthOfPeriod ?? ''}${d.day.toUpperCase()}`;
    }
    parts.push(`BYDAY=${days}`);
  }
  if (rule.byMonthDay?.length) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(",")}`);
  if (rule.byMonth?.length) parts.push(`BYMONTH=${rule.byMonth.join(",")}`);
  lines.push(`RRULE:${parts.join(";")}`);
}

function pushAlerts(lines: string[], event: CalendarEvent): void {
  if (!event.alerts) return;
  for (const k in event.alerts) {
    const alert = event.alerts[k];
    const trigger = alert.trigger;
    if (!trigger) continue;
    lines.push("BEGIN:VALARM");
    lines.push(`ACTION:${(alert.action || "display").toUpperCase()}`);
    if (trigger["@type"] === "OffsetTrigger") {
      const related = trigger.relativeTo === "end" ? ";RELATED=END" : "";
      lines.push(`TRIGGER${related}:${trigger.offset}`);
    } else if (trigger["@type"] === "AbsoluteTrigger") {
      lines.push(`TRIGGER;VALUE=DATE-TIME:${stripDateSeparators(trigger.when)}`);
    }
    lines.push(`DESCRIPTION:${escapeText(event.title || "Reminder")}`);
    lines.push("END:VALARM");
  }
}

export function eventToICS(event: CalendarEvent): string {
  const now = formatNow();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "PRODID:-//JMAP-Webmail//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${now}`,
  ];

  if (event.created) lines.push(`CREATED:${stripDateSeparators(event.created)}`);
  if (event.updated) lines.push(`LAST-MODIFIED:${stripDateSeparators(event.updated)}`);
  if (event.sequence != null) lines.push(`SEQUENCE:${event.sequence}`);

  if (event.start) {
    pushDateProp(lines, "DTSTART", event.start, event.showWithoutTime, event.timeZone);
  }
  if (event.utcEnd) {
    pushDateProp(lines, "DTEND", event.utcEnd, event.showWithoutTime, event.timeZone);
  } else if (event.duration) {
    lines.push(`DURATION:${event.duration}`);
  }

  if (event.title) lines.push(`SUMMARY:${escapeText(event.title)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.status) lines.push(`STATUS:${event.status.toUpperCase()}`);
  if (event.privacy) lines.push(`CLASS:${event.privacy.toUpperCase()}`);
  if (event.freeBusyStatus) {
    lines.push(`TRANSP:${event.freeBusyStatus === "free" ? "TRANSPARENT" : "OPAQUE"}`);
  }

  if (event.locations) {
    // First-value pick without `Object.values(...)[0]` allocation.
    for (const k in event.locations) {
      const first = event.locations[k];
      if (first?.name) lines.push(`LOCATION:${escapeText(first.name)}`);
      break;
    }
  }
  if (event.virtualLocations) {
    for (const k in event.virtualLocations) {
      const uri = event.virtualLocations[k]?.uri;
      if (uri) lines.push(`URL:${uri}`);
    }
  }

  if (event.participants) {
    // Single pass: find organizer + emit ATTENDEE lines for non-organizers
    // in one walk. Was: `Object.values(...).find(...)` for organizer +
    // another `Object.values(...)` walk for attendees — two values-array
    // allocations.
    for (const k in event.participants) {
      const p = event.participants[k];
      if (!p.roles?.owner) continue;
      const email = p.email || p.sendTo?.imip?.replace("mailto:", "");
      if (email) {
        const cn = p.name ? `;CN=${escapeText(p.name)}` : "";
        lines.push(`ORGANIZER${cn}:mailto:${email}`);
      }
      break; // ICS spec: one ORGANIZER per VEVENT
    }
    for (const k in event.participants) {
      const p = event.participants[k];
      if (p.roles?.owner) continue;
      const email = p.email || p.sendTo?.imip?.replace("mailto:", "");
      if (!email) continue;
      const cn = p.name ? `;CN=${escapeText(p.name)}` : "";
      const partstat = p.participationStatus
        ? `;PARTSTAT=${p.participationStatus.toUpperCase()}`
        : ";PARTSTAT=NEEDS-ACTION";
      const rsvp = p.expectReply ? ";RSVP=TRUE" : "";
      lines.push(`ATTENDEE${cn}${partstat}${rsvp}:mailto:${email}`);
    }
  }

  pushFrequencyRule(lines, event);
  pushAlerts(lines, event);

  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  // Single concat — was lines.map(foldLine).join — drops the intermediate
  // folded-lines array (N strings) for the final serialisation.
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) out += '\r\n';
    out += foldLine(lines[i]);
  }
  return out + '\r\n';
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned || "event";
}

export function downloadEventICS(event: CalendarEvent): void {
  const ics = eventToICS(event);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeFilename(event.title || "event")}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
