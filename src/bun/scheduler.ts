import {
	completeReminder,
	clearExpiredSnoozes,
	getAlertOffsets,
	getAllReminders,
	getCompletedOccurrences,
	getSettings,
	getSnoozeUntil,
	listImportedInWindowDb,
	markAlertFired,
	markImportedAlertFiredDb,
	wasAlertFired,
	wasImportedAlertFiredDb,
} from "./db";
import { ICS_IMPORT_WINDOW_DAYS } from "./ics";
import { IMPORTED_ALERT_OFFSETS_MINUTES } from "./importedEvents";
import { getAlertFireTime, getNextOccurrence, isAllDay, startOfDay } from "./recurrence";
import { showImportedEventNotification, showReminderNotification } from "./notifications";
import type { ImportedEventRow, ReminderRow } from "./types";

type TickListener = () => void;

const listeners = new Set<TickListener>();
let interval: ReturnType<typeof setInterval> | null = null;

export function onSchedulerTick(listener: TickListener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function notifyListeners() {
	for (const listener of listeners) listener();
}

function shouldFire(
	reminder: ReminderRow,
	occurrenceAt: string,
	minutesBefore: number,
	now: Date,
	missedHours: number,
): boolean {
	if (wasAlertFired(reminder.id, occurrenceAt, minutesBefore)) return false;

	const snoozeUntil = getSnoozeUntil(reminder.id, occurrenceAt, minutesBefore);
	if (snoozeUntil) {
		const until = new Date(snoozeUntil);
		if (until > now) return false;
	}

	const fireAt = getAlertFireTime(new Date(occurrenceAt), minutesBefore);
	if (fireAt > now) return false;

	const missedMs = missedHours * 60 * 60 * 1000;
	if (now.getTime() - fireAt.getTime() > missedMs) return false;

	return true;
}

function shouldFireImported(
	event: ImportedEventRow,
	occurrenceAt: string,
	minutesBefore: number,
	now: Date,
	missedHours: number,
): boolean {
	if (wasImportedAlertFiredDb(event.id, occurrenceAt, minutesBefore)) return false;

	const fireAt = getAlertFireTime(new Date(occurrenceAt), minutesBefore);
	if (fireAt > now) return false;

	const missedMs = missedHours * 60 * 60 * 1000;
	if (now.getTime() - fireAt.getTime() > missedMs) return false;

	return true;
}

function importedListWindow(now: Date, missedHours: number) {
	const from = new Date(now.getTime() - missedHours * 60 * 60 * 1000);
	const to = new Date(now);
	to.setDate(to.getDate() + ICS_IMPORT_WINDOW_DAYS);
	return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

function tickImportedEvents(now: Date, missedHours: number): boolean {
	let fired = false;
	const { fromIso, toIso } = importedListWindow(now, missedHours);
	const events = listImportedInWindowDb(fromIso, toIso);

	for (const event of events) {
		const occurrenceAt = event.starts_at;
		if (event.all_day === 1) {
			const occurrence = new Date(occurrenceAt);
			if (startOfDay(now).getTime() !== startOfDay(occurrence).getTime()) continue;
			if (wasImportedAlertFiredDb(event.id, occurrenceAt, ALL_DAY_OPEN_ALERT)) continue;
			void showImportedEventNotification(event, occurrenceAt, ALL_DAY_OPEN_ALERT);
			markImportedAlertFiredDb(event.id, occurrenceAt, ALL_DAY_OPEN_ALERT);
			fired = true;
			continue;
		}

		for (const minutesBefore of IMPORTED_ALERT_OFFSETS_MINUTES) {
			if (shouldFireImported(event, occurrenceAt, minutesBefore, now, missedHours)) {
				void showImportedEventNotification(event, occurrenceAt, minutesBefore);
				markImportedAlertFiredDb(event.id, occurrenceAt, minutesBefore);
				fired = true;
			}
		}
	}

	return fired;
}

export const ALL_DAY_OPEN_ALERT = -1;

export function notifyAllDayRemindersOnOpen() {
	const settings = getSettings();
	if (settings.pausedGlobally) return;

	const now = new Date();
	const today = startOfDay(now).getTime();
	let fired = false;

	for (const reminder of getAllReminders()) {
		if (!isAllDay(reminder) || reminder.is_paused || reminder.is_completed) {
			continue;
		}
		const completed = getCompletedOccurrences(reminder.id);
		const next = getNextOccurrence(reminder, completed, now);
		if (!next) continue;
		if (startOfDay(next).getTime() !== today) continue;

		const occurrenceAt = next.toISOString();
		if (wasAlertFired(reminder.id, occurrenceAt, ALL_DAY_OPEN_ALERT)) continue;

		void showReminderNotification(reminder, occurrenceAt, ALL_DAY_OPEN_ALERT);
		markAlertFired(reminder.id, occurrenceAt, ALL_DAY_OPEN_ALERT);
		fired = true;
	}

	if (fired) notifyListeners();
}

export function runSchedulerTick() {
	const settings = getSettings();
	if (settings.pausedGlobally) return;

	clearExpiredSnoozes();
	const now = new Date();
	const reminders = getAllReminders();
	let fired = false;

	for (const reminder of reminders) {
		if (reminder.is_paused) continue;
		const completed = getCompletedOccurrences(reminder.id);
		const next = getNextOccurrence(reminder, completed, now);
		if (!next) continue;
		const occurrenceAt = next.toISOString();

		if (isAllDay(reminder)) {
			if (
				reminder.recurrence_type === "once" &&
				!reminder.is_completed &&
				startOfDay(now).getTime() > startOfDay(next).getTime()
			) {
				completeReminder(reminder.id, occurrenceAt);
				fired = true;
			}
			continue;
		}

		const offsets = getAlertOffsets(reminder.id);
		if (offsets.length === 0) offsets.push(0);

		for (const minutesBefore of offsets) {
			if (
				shouldFire(
					reminder,
					occurrenceAt,
					minutesBefore,
					now,
					settings.missedAlertHours,
				)
			) {
				void showReminderNotification(
					reminder,
					occurrenceAt,
					minutesBefore,
				);
				markAlertFired(reminder.id, occurrenceAt, minutesBefore);
				fired = true;
			}
		}

		if (reminder.recurrence_type === "once" && next <= now && !reminder.is_completed) {
			completeReminder(reminder.id, occurrenceAt);
			fired = true;
		}
	}

	if (tickImportedEvents(now, settings.missedAlertHours)) {
		fired = true;
	}

	if (fired) notifyListeners();
}

export function startScheduler() {
	if (interval) return;
	runSchedulerTick();
	notifyAllDayRemindersOnOpen();
	interval = setInterval(runSchedulerTick, 30_000);
}

export function stopScheduler() {
	if (interval) {
		clearInterval(interval);
		interval = null;
	}
}
