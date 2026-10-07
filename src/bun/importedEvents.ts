import type { Database } from "bun:sqlite";
import type { ImportedEventRow, ImportedEventSource } from "./types";
import type { ParsedIcsEvent } from "./ics";

export const IMPORTED_ALERT_OFFSETS_MINUTES = [15, 0];

export const IMPORTED_EVENTS_DDL = `
  CREATE TABLE IF NOT EXISTS imported_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    starts_at TEXT NOT NULL,
    ends_at TEXT,
    all_day INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'ics',
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    raw_snippet TEXT,
    UNIQUE (source, external_id)
  );

  CREATE INDEX IF NOT EXISTS idx_imported_events_starts_at ON imported_events (starts_at);

  CREATE TABLE IF NOT EXISTS fired_imported_alerts (
    imported_event_id INTEGER NOT NULL,
    occurrence_at TEXT NOT NULL,
    minutes_before INTEGER NOT NULL,
    fired_at TEXT NOT NULL,
    PRIMARY KEY (imported_event_id, occurrence_at, minutes_before),
    FOREIGN KEY (imported_event_id) REFERENCES imported_events(id) ON DELETE CASCADE
  );
`;

export function migrateImportedEvents(database: Database) {
	database.exec(IMPORTED_EVENTS_DDL);
}

export function listIdForImported(dbId: number): number {
	return -dbId;
}

export function isImportedListId(id: number): boolean {
	return id < 0;
}

export function importedDbIdFromListId(listId: number): number {
	return -listId;
}

export interface UpsertImportedInput {
	externalId: string;
	summary: string;
	description: string;
	startsAt: string;
	endsAt: string | null;
	allDay: boolean;
	source: ImportedEventSource;
	rawSnippet?: string | null;
}

export function upsertImportedEvents(
	database: Database,
	events: UpsertImportedInput[],
): { imported: number; updated: number } {
	const insert = database.query(
		`INSERT INTO imported_events (
      external_id, summary, description, starts_at, ends_at, all_day, source, raw_snippet
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, external_id) DO UPDATE SET
      summary = excluded.summary,
      description = excluded.description,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      all_day = excluded.all_day,
      raw_snippet = excluded.raw_snippet,
      imported_at = datetime('now')`,
	);

	let imported = 0;
	let updated = 0;
	for (const ev of events) {
		const before = database
			.query(
				"SELECT id FROM imported_events WHERE source = ? AND external_id = ?",
			)
			.get(ev.source, ev.externalId) as { id: number } | undefined;
		insert.run(
			ev.externalId,
			ev.summary,
			ev.description,
			ev.startsAt,
			ev.endsAt,
			ev.allDay ? 1 : 0,
			ev.source,
			ev.rawSnippet?.slice(0, 500) ?? null,
		);
		if (before) updated++;
		else imported++;
	}
	return { imported, updated };
}

export function parsedToUpsert(ev: ParsedIcsEvent): UpsertImportedInput {
	return {
		externalId: ev.uid,
		summary: ev.summary,
		description: ev.description,
		startsAt: ev.startsAt,
		endsAt: ev.endsAt,
		allDay: ev.allDay,
		source: "ics",
	};
}

export function listImportedInWindow(
	database: Database,
	fromIso: string,
	toIso: string,
): ImportedEventRow[] {
	return database
		.query(
			`SELECT * FROM imported_events
       WHERE starts_at >= ? AND starts_at <= ?
       ORDER BY starts_at ASC`,
		)
		.all(fromIso, toIso) as ImportedEventRow[];
}

export function getImportedEventById(
	database: Database,
	id: number,
): ImportedEventRow | null {
	return (
		(database.query("SELECT * FROM imported_events WHERE id = ?").get(id) as
			| ImportedEventRow
			| undefined) ?? null
	);
}

export function deleteImportedBySource(database: Database, source: ImportedEventSource) {
	database.query("DELETE FROM imported_events WHERE source = ?").run(source);
}

export function markImportedAlertFired(
	database: Database,
	importedEventId: number,
	occurrenceAt: string,
	minutesBefore: number,
) {
	database
		.query(
			`INSERT OR IGNORE INTO fired_imported_alerts (imported_event_id, occurrence_at, minutes_before, fired_at)
     VALUES (?, ?, ?, datetime('now'))`,
		)
		.run(importedEventId, occurrenceAt, minutesBefore);
}

export function wasImportedAlertFired(
	database: Database,
	importedEventId: number,
	occurrenceAt: string,
	minutesBefore: number,
): boolean {
	const row = database
		.query(
			`SELECT 1 FROM fired_imported_alerts
       WHERE imported_event_id = ? AND occurrence_at = ? AND minutes_before = ?`,
		)
		.get(importedEventId, occurrenceAt, minutesBefore);
	return !!row;
}
