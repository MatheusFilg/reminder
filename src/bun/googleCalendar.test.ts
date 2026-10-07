import { describe, expect, test } from "bun:test";
import {
	googleEventToUpsert,
	googleImportedExternalId,
} from "./googleCalendar";

describe("googleCalendar", () => {
	test("maps timed event", () => {
		const row = googleEventToUpsert({
			id: "abc123",
			summary: "Reunião",
			description: "Notas",
			start: { dateTime: "2026-04-10T15:00:00-03:00" },
			end: { dateTime: "2026-04-10T16:00:00-03:00" },
		});
		expect(row).not.toBeNull();
		expect(row!.source).toBe("google");
		expect(row!.externalId).toBe("abc123");
		expect(
			googleEventToUpsert(
				{
					id: "abc123",
					summary: "Reunião",
					start: { dateTime: "2026-04-10T15:00:00-03:00" },
				},
				"work@group.calendar.google.com",
			)!.externalId,
		).toBe(googleImportedExternalId("work@group.calendar.google.com", "abc123"));
		expect(row!.allDay).toBe(false);
	});

	test("maps all-day event", () => {
		const row = googleEventToUpsert({
			id: "day1",
			summary: "Feriado",
			start: { date: "2026-04-15" },
			end: { date: "2026-04-16" },
		});
		expect(row!.allDay).toBe(true);
	});

	test("skips cancelled", () => {
		expect(
			googleEventToUpsert({ id: "x", status: "cancelled", start: { date: "2026-04-15" } }),
		).toBeNull();
	});
});
