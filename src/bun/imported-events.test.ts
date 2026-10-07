import Database from "bun:sqlite";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "bun:test";
import {
	listImportedInWindow,
	migrateImportedEvents,
	upsertImportedEvents,
} from "./importedEvents";

function openTestDb() {
	const dir = mkdtempSync(join(tmpdir(), "reminder-imported-"));
	const database = new Database(join(dir, "test.db"), { create: true });
	migrateImportedEvents(database);
	return database;
}

describe("imported events db", () => {
	test("upsert dedupes on source + external_id", () => {
		const database = openTestDb();
		const first = upsertImportedEvents(database, [
			{
				externalId: "uid-1",
				summary: "A",
				description: "",
				startsAt: "2026-05-01T10:00:00.000Z",
				endsAt: null,
				allDay: false,
				source: "ics",
			},
		]);
		expect(first.imported).toBe(1);
		expect(first.updated).toBe(0);

		const second = upsertImportedEvents(database, [
			{
				externalId: "uid-1",
				summary: "A atualizado",
				description: "d",
				startsAt: "2026-05-01T11:00:00.000Z",
				endsAt: null,
				allDay: false,
				source: "ics",
			},
		]);
		expect(second.imported).toBe(0);
		expect(second.updated).toBe(1);

		const rows = listImportedInWindow(
			database,
			"2026-01-01T00:00:00.000Z",
			"2026-12-31T23:59:59.999Z",
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].summary).toBe("A atualizado");
	});

	test("listImportedInWindow filters by starts_at", () => {
		const database = openTestDb();
		upsertImportedEvents(database, [
			{
				externalId: "a",
				summary: "early",
				description: "",
				startsAt: "2026-04-01T10:00:00.000Z",
				endsAt: null,
				allDay: false,
				source: "ics",
			},
			{
				externalId: "b",
				summary: "late",
				description: "",
				startsAt: "2026-06-01T10:00:00.000Z",
				endsAt: null,
				allDay: false,
				source: "ics",
			},
		]);
		const rows = listImportedInWindow(
			database,
			"2026-05-01T00:00:00.000Z",
			"2026-12-31T23:59:59.999Z",
		);
		expect(rows.map((r) => r.external_id)).toEqual(["b"]);
	});
});
