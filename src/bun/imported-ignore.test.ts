import { describe, expect, test } from "bun:test";
import Database from "bun:sqlite";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { migrateImportedEvents } from "./importedEvents";
import {
	dismissImportedSimilar,
	importedTitlesSimilar,
	migrateImportedIgnore,
	normalizeImportedTitle,
} from "./importedIgnore";

describe("importedIgnore", () => {
	test("normalize strips calendar prefix", () => {
		expect(normalizeImportedTitle("MV: Daily standup")).toBe("daily standup");
	});

	test("similar titles match", () => {
		const a = normalizeImportedTitle("Reunião de time");
		const b = normalizeImportedTitle("reuniao de time");
		expect(importedTitlesSimilar(a, b)).toBe(true);
	});

	test("dismiss removes matching rows", () => {
		const dir = mkdtempSync(join(tmpdir(), "reminder-ignore-"));
		const database = new Database(join(dir, "t.db"));
		migrateImportedEvents(database);
		migrateImportedIgnore(database);
		database
			.query(
				`INSERT INTO imported_events (external_id, summary, description, starts_at, ends_at, all_day, source)
         VALUES ('1', 'MV: Weekly sync', '', '2026-10-10T10:00:00.000Z', null, 0, 'google')`,
			)
			.run();
		database
			.query(
				`INSERT INTO imported_events (external_id, summary, description, starts_at, ends_at, all_day, source)
         VALUES ('2', 'Weekly sync', '', '2026-10-17T10:00:00.000Z', null, 0, 'google')`,
			)
			.run();
		const r = dismissImportedSimilar(database, "Weekly sync", "hide");
		expect(r.removed).toBe(2);
		const left = database
			.query("SELECT COUNT(*) as n FROM imported_events")
			.get() as { n: number };
		expect(left.n).toBe(0);
	});
});
