import { describe, expect, test } from "bun:test";
import {
	filterEventsInImportWindow,
	parseIcs,
	parseIcsDateTime,
	unfoldIcsLines,
} from "./ics";

describe("ics", () => {
	test("unfolds folded lines", () => {
		// RFC 5545: CRLF + single SP/HTAB is removed; content is concatenated (often mid-word).
		const text = "DESCRIPTION:Long line part on\r\n e part two\r\nSUMMARY:Hi";
		const lines = unfoldIcsLines(text);
		expect(lines.some((l) => l.startsWith("DESCRIPTION:Long line part one part two"))).toBe(
			true,
		);
	});

	test("parses simple VEVENT with UTC DTSTART", () => {
		const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:test-1@example.com
DTSTART:20260410T150000Z
DTEND:20260410T160000Z
SUMMARY:Reunião
DESCRIPTION:Notas
END:VEVENT
END:VCALENDAR`;
		const events = parseIcs(ics);
		expect(events).toHaveLength(1);
		expect(events[0].uid).toBe("test-1@example.com");
		expect(events[0].summary).toBe("Reunião");
		expect(events[0].description).toBe("Notas");
		expect(events[0].allDay).toBe(false);
		expect(new Date(events[0].startsAt).toISOString()).toBe(
			new Date("2026-04-10T15:00:00.000Z").toISOString(),
		);
	});

	test("parses all-day VALUE=DATE", () => {
		const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:allday@test
DTSTART;VALUE=DATE:20260415
SUMMARY:Feriado
END:VEVENT
END:VCALENDAR`;
		const events = parseIcs(ics);
		expect(events).toHaveLength(1);
		expect(events[0].allDay).toBe(true);
		expect(events[0].endsAt).not.toBeNull();
	});

	test("skips VEVENT with RRULE", () => {
		const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:recur@test
DTSTART:20260410T100000Z
RRULE:FREQ=DAILY
SUMMARY:Diário
END:VEVENT
END:VCALENDAR`;
		expect(parseIcs(ics)).toHaveLength(0);
	});

	test("parses multiple VEVENT blocks", () => {
		const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a@test
DTSTART:20260410T100000Z
SUMMARY:A
END:VEVENT
BEGIN:VEVENT
UID:b@test
DTSTART:20260411T100000Z
SUMMARY:B
END:VEVENT
END:VCALENDAR`;
		expect(parseIcs(ics)).toHaveLength(2);
	});

	test("parseIcsDateTime respects Z offset", () => {
		const d = parseIcsDateTime("20260101T120000Z", {});
		expect(d.toISOString()).toBe("2026-01-01T12:00:00.000Z");
	});

	test("filterEventsInImportWindow keeps future events within 90d", () => {
		const now = new Date("2026-04-01T12:00:00.000Z");
		const inside = {
			uid: "1",
			summary: "x",
			description: "",
			startsAt: "2026-04-15T10:00:00.000Z",
			endsAt: null,
			allDay: false,
		};
		const far = {
			...inside,
			uid: "2",
			startsAt: "2026-08-01T10:00:00.000Z",
		};
		const past = {
			...inside,
			uid: "3",
			startsAt: "2026-03-01T10:00:00.000Z",
		};
		const { inWindow, skipped } = filterEventsInImportWindow(
			[inside, far, past],
			now,
			90,
		);
		expect(inWindow.map((e) => e.uid)).toEqual(["1"]);
		expect(skipped).toBe(2);
	});
});
