import { describe, expect, test } from "bun:test";
import { prepareIcsImport } from "./icsImport";

describe("icsImport", () => {
	test("returns error when no VEVENT parsed", () => {
		const result = prepareIcsImport("BEGIN:VCALENDAR\nEND:VCALENDAR");
		expect(result.error).toBeDefined();
		expect(result.events).toHaveLength(0);
	});
});
