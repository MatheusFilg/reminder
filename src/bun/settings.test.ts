import { describe, expect, test } from "bun:test";
import { parseGoogleCalendarSyncIntervalMinutes } from "./settings";

describe("parseGoogleCalendarSyncIntervalMinutes", () => {
	test("accepts allowed values", () => {
		expect(parseGoogleCalendarSyncIntervalMinutes("5", 30)).toBe(5);
		expect(parseGoogleCalendarSyncIntervalMinutes("60", 30)).toBe(60);
	});

	test("falls back for invalid values", () => {
		expect(parseGoogleCalendarSyncIntervalMinutes("10", 30)).toBe(30);
		expect(parseGoogleCalendarSyncIntervalMinutes(undefined, 15)).toBe(15);
	});
});
