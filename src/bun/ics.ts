export interface ParsedIcsEvent {
	uid: string;
	summary: string;
	description: string;
	startsAt: string;
	endsAt: string | null;
	allDay: boolean;
}

export function unfoldIcsLines(text: string): string[] {
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const raw = normalized.split("\n");
	const lines: string[] = [];
	for (const line of raw) {
		const trimmed = line.replace(/\r$/, "");
		if (!trimmed) continue;
		if ((trimmed.startsWith(" ") || trimmed.startsWith("\t")) && lines.length > 0) {
			lines[lines.length - 1] += trimmed.slice(1);
		} else {
			lines.push(trimmed);
		}
	}
	return lines;
}

function parsePropertyLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
	const colon = line.indexOf(":");
	if (colon < 0) return null;
	const namePart = line.slice(0, colon);
	const value = line.slice(colon + 1);
	const segments = namePart.split(";");
	const name = segments[0]?.toUpperCase() ?? "";
	const params: Record<string, string> = {};
	for (let i = 1; i < segments.length; i++) {
		const seg = segments[i];
		const eq = seg.indexOf("=");
		if (eq >= 0) {
			params[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1);
		}
	}
	return { name, params, value };
}

function pad(n: number) {
	return String(n).padStart(2, "0");
}

/** Parse ICS date/time to ISO string (UTC for Z, local wall time otherwise). */
export function parseIcsDateTime(value: string, params: Record<string, string>): Date {
	const isDate = params.VALUE === "DATE" || /^\d{8}$/.test(value);
	if (isDate) {
		const y = Number(value.slice(0, 4));
		const m = Number(value.slice(4, 6)) - 1;
		const d = Number(value.slice(6, 8));
		const local = new Date(y, m, d, 0, 0, 0, 0);
		return local;
	}

	const hasTime = value.includes("T");
	if (!hasTime) {
		const y = Number(value.slice(0, 4));
		const m = Number(value.slice(4, 6)) - 1;
		const d = Number(value.slice(6, 8));
		return new Date(y, m, d, 0, 0, 0, 0);
	}

	const datePart = value.slice(0, 8);
	const timePart = value.slice(9);
	const y = Number(datePart.slice(0, 4));
	const mo = Number(datePart.slice(4, 6)) - 1;
	const d = Number(datePart.slice(6, 8));
	const th = timePart.slice(0, 2);
	const tm = timePart.slice(2, 4);
	const ts = timePart.slice(4, 6);
	const isUtc = timePart.endsWith("Z");
	const hour = Number(th);
	const minute = Number(tm);
	const second = Number(ts.replace("Z", "")) || 0;

	if (isUtc) {
		return new Date(Date.UTC(y, mo, d, hour, minute, second));
	}
	return new Date(y, mo, d, hour, minute, second);
}

function unescapeIcsText(value: string): string {
	return value
		.replace(/\\n/gi, "\n")
		.replace(/\\,/g, ",")
		.replace(/\\;/g, ";")
		.replace(/\\\\/g, "\\");
}

function parseVeventBlock(lines: string[]): ParsedIcsEvent | null {
	const props = new Map<string, { params: Record<string, string>; value: string }>();
	for (const line of lines) {
		const parsed = parsePropertyLine(line);
		if (!parsed) continue;
		props.set(parsed.name, { params: parsed.params, value: parsed.value });
	}

	if (props.has("RRULE")) return null;

	const uid = props.get("UID")?.value?.trim();
	const dtstart = props.get("DTSTART");
	if (!uid || !dtstart) return null;

	const allDay =
		dtstart.params.VALUE === "DATE" || /^\d{8}$/.test(dtstart.value.trim());
	const startDate = parseIcsDateTime(dtstart.value.trim(), dtstart.params);

	let endDate: Date | null = null;
	const dtend = props.get("DTEND");
	if (dtend) {
		endDate = parseIcsDateTime(dtend.value.trim(), dtend.params);
	} else if (allDay) {
		endDate = new Date(startDate);
		endDate.setDate(endDate.getDate() + 1);
	}

	const summary = unescapeIcsText(props.get("SUMMARY")?.value?.trim() ?? "(Sem título)");
	const description = unescapeIcsText(props.get("DESCRIPTION")?.value?.trim() ?? "");

	return {
		uid,
		summary,
		description,
		startsAt: startDate.toISOString(),
		endsAt: endDate ? endDate.toISOString() : null,
		allDay,
	};
}

export function parseIcs(text: string): ParsedIcsEvent[] {
	const lines = unfoldIcsLines(text);
	const events: ParsedIcsEvent[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i].trim().toUpperCase();
		if (line !== "BEGIN:VEVENT") {
			i++;
			continue;
		}
		i++;
		const block: string[] = [];
		while (i < lines.length && lines[i].trim().toUpperCase() !== "END:VEVENT") {
			block.push(lines[i]);
			i++;
		}
		if (i < lines.length) i++;
		const ev = parseVeventBlock(block);
		if (ev) events.push(ev);
	}
	return events;
}

export const ICS_IMPORT_WINDOW_DAYS = 90;
export const MAX_ICS_TEXT_LENGTH = 2 * 1024 * 1024;

export function filterEventsInImportWindow(
	events: ParsedIcsEvent[],
	now = new Date(),
	windowDays = ICS_IMPORT_WINDOW_DAYS,
): { inWindow: ParsedIcsEvent[]; skipped: number } {
	const end = new Date(now);
	end.setDate(end.getDate() + windowDays);
	let skipped = 0;
	const inWindow: ParsedIcsEvent[] = [];
	for (const ev of events) {
		const start = new Date(ev.startsAt);
		if (start > end) {
			skipped++;
			continue;
		}
		if (ev.allDay) {
			const dayEnd = new Date(start);
			dayEnd.setHours(23, 59, 59, 999);
			if (dayEnd < now) {
				skipped++;
				continue;
			}
		} else if (start < now) {
			skipped++;
			continue;
		}
		inWindow.push(ev);
	}
	return { inWindow, skipped };
}
