import Database from "bun:sqlite";
import { Utils } from "electrobun/bun";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { AppSettings, ReminderInput, ReminderRow } from "./types";

const dataDir = Utils.paths.userData;
if (!existsSync(dataDir)) {
	mkdirSync(dataDir, { recursive: true });
}

const dbPath = join(dataDir, "reminder.db");
export const db = new Database(dbPath, { create: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    recurrence_type TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    weekly_days TEXT,
    recurrence_end_type TEXT NOT NULL DEFAULT 'never',
    recurrence_end_date TEXT,
    is_paused INTEGER NOT NULL DEFAULT 0,
    is_completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS alert_offsets (
    reminder_id INTEGER NOT NULL,
    minutes_before INTEGER NOT NULL,
    PRIMARY KEY (reminder_id, minutes_before),
    FOREIGN KEY (reminder_id) REFERENCES reminders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS completed_occurrences (
    reminder_id INTEGER NOT NULL,
    occurrence_at TEXT NOT NULL,
    PRIMARY KEY (reminder_id, occurrence_at),
    FOREIGN KEY (reminder_id) REFERENCES reminders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS fired_alerts (
    reminder_id INTEGER NOT NULL,
    occurrence_at TEXT NOT NULL,
    minutes_before INTEGER NOT NULL,
    fired_at TEXT NOT NULL,
    PRIMARY KEY (reminder_id, occurrence_at, minutes_before)
  );

  CREATE TABLE IF NOT EXISTS snoozes (
    reminder_id INTEGER NOT NULL,
    occurrence_at TEXT NOT NULL,
    minutes_before INTEGER NOT NULL DEFAULT 0,
    snooze_until TEXT NOT NULL,
    PRIMARY KEY (reminder_id, occurrence_at, minutes_before),
    FOREIGN KEY (reminder_id) REFERENCES reminders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

{
	const cols = db.query("PRAGMA table_info(reminders)").all() as { name: string }[];
	if (!cols.some((c) => c.name === "all_day")) {
		db.exec(
			"ALTER TABLE reminders ADD COLUMN all_day INTEGER NOT NULL DEFAULT 0",
		);
	}
}

const defaultSettings: AppSettings = {
	autostart: true,
	pausedGlobally: false,
	missedAlertHours: 24,
	pinned: false,
};

export function getSettings(): AppSettings {
	const rows = db.query("SELECT key, value FROM settings").all() as {
		key: string;
		value: string;
	}[];
	const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
	return {
		autostart: map.autostart !== "false",
		pausedGlobally: map.pausedGlobally === "true",
		missedAlertHours: Number(map.missedAlertHours ?? 24),
		pinned: map.pinned === "true",
	};
}

export function saveSettings(partial: Partial<AppSettings>) {
	const current = getSettings();
	const next = { ...current, ...partial };
	for (const [key, value] of Object.entries(next)) {
		db.query(
			"INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		).run(key, String(value));
	}
	return next;
}

export function getAllReminders(): ReminderRow[] {
	return db
		.query("SELECT * FROM reminders ORDER BY starts_at ASC")
		.all() as ReminderRow[];
}

export function getReminderById(id: number): ReminderRow | null {
	return (
		(db.query("SELECT * FROM reminders WHERE id = ?").get(id) as
			| ReminderRow
			| undefined) ?? null
	);
}

export function getAlertOffsets(reminderId: number): number[] {
	const rows = db
		.query(
			"SELECT minutes_before FROM alert_offsets WHERE reminder_id = ? ORDER BY minutes_before DESC",
		)
		.all(reminderId) as { minutes_before: number }[];
	return rows.map((r) => r.minutes_before);
}

export function getCompletedOccurrences(reminderId: number): Set<string> {
	const rows = db
		.query(
			"SELECT occurrence_at FROM completed_occurrences WHERE reminder_id = ?",
		)
		.all(reminderId) as { occurrence_at: string }[];
	return new Set(rows.map((r) => r.occurrence_at));
}

export function getCompletedOccurrenceList(
	reminderId: number,
): string[] {
	const rows = db
		.query(
			"SELECT occurrence_at FROM completed_occurrences WHERE reminder_id = ? ORDER BY occurrence_at DESC",
		)
		.all(reminderId) as { occurrence_at: string }[];
	return rows.map((r) => r.occurrence_at);
}

function setAlertOffsets(reminderId: number, offsets: number[]) {
	db.query("DELETE FROM alert_offsets WHERE reminder_id = ?").run(reminderId);
	const insert = db.query(
		"INSERT INTO alert_offsets (reminder_id, minutes_before) VALUES (?, ?)",
	);
	for (const minutes of [...new Set(offsets)].sort((a, b) => b - a)) {
		insert.run(reminderId, minutes);
	}
}

export function createReminder(input: ReminderInput): ReminderRow {
	const weeklyDays =
		input.recurrenceType === "weekly" ? JSON.stringify(input.weeklyDays) : null;
	const row = db
		.query(
			`INSERT INTO reminders (
        name, description, recurrence_type, starts_at, weekly_days,
        recurrence_end_type, recurrence_end_date, all_day
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *`,
		)
		.get(
			input.name.trim(),
			input.description.trim(),
			input.recurrenceType,
			input.startsAt,
			weeklyDays,
			input.recurrenceEndType,
			input.recurrenceEndDate,
			input.allDay ? 1 : 0,
		) as ReminderRow;
	setAlertOffsets(row.id, input.alertOffsetsMinutes);
	return row;
}

export function updateReminder(
	id: number,
	input: ReminderInput,
): ReminderRow | null {
	const existing = getReminderById(id);
	if (!existing) return null;
	const weeklyDays =
		input.recurrenceType === "weekly" ? JSON.stringify(input.weeklyDays) : null;
	const row = db
		.query(
			`UPDATE reminders SET
        name = ?, description = ?, recurrence_type = ?, starts_at = ?,
        weekly_days = ?, recurrence_end_type = ?, recurrence_end_date = ?,
        all_day = ?, updated_at = datetime('now')
      WHERE id = ?
      RETURNING *`,
		)
		.get(
			input.name.trim(),
			input.description.trim(),
			input.recurrenceType,
			input.startsAt,
			weeklyDays,
			input.recurrenceEndType,
			input.recurrenceEndDate,
			input.allDay ? 1 : 0,
			id,
		) as ReminderRow;
	setAlertOffsets(id, input.alertOffsetsMinutes);
	return row;
}

export function deleteReminder(id: number) {
	db.query("DELETE FROM reminders WHERE id = ?").run(id);
}

export function completeReminder(id: number, occurrenceAt: string) {
	const reminder = getReminderById(id);
	if (!reminder) return;
	if (reminder.recurrence_type === "once") {
		db.query(
			"UPDATE reminders SET is_completed = 1, updated_at = datetime('now') WHERE id = ?",
		).run(id);
		return;
	}
	db.query(
		"INSERT OR IGNORE INTO completed_occurrences (reminder_id, occurrence_at) VALUES (?, ?)",
	).run(id, occurrenceAt);
}

export function snoozeReminder(
	id: number,
	occurrenceAt: string,
	minutesBefore: number,
	snoozeMinutes: number,
) {
	const until = new Date(Date.now() + snoozeMinutes * 60_000).toISOString();
	db.query(
		`INSERT INTO snoozes (reminder_id, occurrence_at, minutes_before, snooze_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(reminder_id, occurrence_at, minutes_before)
     DO UPDATE SET snooze_until = excluded.snooze_until`,
	).run(id, occurrenceAt, minutesBefore, until);
}

export function markAlertFired(
	reminderId: number,
	occurrenceAt: string,
	minutesBefore: number,
) {
	db.query(
		`INSERT OR IGNORE INTO fired_alerts (reminder_id, occurrence_at, minutes_before, fired_at)
     VALUES (?, ?, ?, datetime('now'))`,
	).run(reminderId, occurrenceAt, minutesBefore);
}

export function wasAlertFired(
	reminderId: number,
	occurrenceAt: string,
	minutesBefore: number,
): boolean {
	const row = db
		.query(
			`SELECT 1 FROM fired_alerts
       WHERE reminder_id = ? AND occurrence_at = ? AND minutes_before = ?`,
		)
		.get(reminderId, occurrenceAt, minutesBefore);
	return !!row;
}

export function getSnoozeUntil(
	reminderId: number,
	occurrenceAt: string,
	minutesBefore: number,
): string | null {
	const row = db
		.query(
			`SELECT snooze_until FROM snoozes
       WHERE reminder_id = ? AND occurrence_at = ? AND minutes_before = ?`,
		)
		.get(reminderId, occurrenceAt, minutesBefore) as
		| { snooze_until: string }
		| undefined;
	return row?.snooze_until ?? null;
}

export function clearExpiredSnoozes() {
	db.query("DELETE FROM snoozes WHERE snooze_until <= datetime('now')").run();
}

export { dbPath, defaultSettings };
