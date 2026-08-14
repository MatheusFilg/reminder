import type { ListGroup, ReminderRow } from "./types";

export function parseWeeklyDays(json: string | null): number[] {
	if (!json) return [];
	try {
		return JSON.parse(json) as number[];
	} catch {
		return [];
	}
}

export function startOfDay(date: Date): Date {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
}

export function isAllDay(reminder: { all_day?: number }): boolean {
	return reminder.all_day === 1;
}

function endOfDay(date: Date): Date {
	const d = new Date(date);
	d.setHours(23, 59, 59, 999);
	return d;
}

function addDays(date: Date, days: number): Date {
	const d = new Date(date);
	d.setDate(d.getDate() + days);
	return d;
}

function clampMonthDay(year: number, month: number, day: number): number {
	const last = new Date(year, month + 1, 0).getDate();
	return Math.min(day, last);
}

function withTime(base: Date, template: Date): Date {
	const d = new Date(base);
	d.setHours(
		template.getHours(),
		template.getMinutes(),
		template.getSeconds(),
		template.getMilliseconds(),
	);
	return d;
}

function getRecurrenceEnd(reminder: ReminderRow): Date | null {
	if (reminder.recurrence_end_type !== "until" || !reminder.recurrence_end_date) {
		return null;
	}
	return endOfDay(new Date(reminder.recurrence_end_date));
}

function nextDaily(from: Date, template: Date): Date {
	const next = addDays(withTime(from, template), 1);
	return withTime(next, template);
}

function nextWeekly(from: Date, template: Date, days: number[]): Date {
	if (days.length === 0) return nextDaily(from, template);
	const sorted = [...days].sort((a, b) => a - b);
	for (let i = 1; i <= 7; i++) {
		const candidate = addDays(from, i);
		if (sorted.includes(candidate.getDay())) {
			return withTime(candidate, template);
		}
	}
	return withTime(addDays(from, 7), template);
}

function nextMonthly(from: Date, template: Date): Date {
	const targetDay = template.getDate();
	const d = new Date(from);
	d.setMonth(d.getMonth() + 1);
	const day = clampMonthDay(d.getFullYear(), d.getMonth(), targetDay);
	d.setDate(day);
	return withTime(d, template);
}

function advanceOccurrence(reminder: ReminderRow, from: Date): Date {
	const template = new Date(reminder.starts_at);
	switch (reminder.recurrence_type) {
		case "daily":
			return nextDaily(from, template);
		case "weekly":
			return nextWeekly(from, template, parseWeeklyDays(reminder.weekly_days));
		case "monthly":
			return nextMonthly(from, template);
		default:
			return from;
	}
}

export function getNextOccurrence(
	reminder: ReminderRow,
	completed: Set<string>,
	after = new Date(),
): Date | null {
	if (reminder.is_paused) return null;

	if (reminder.recurrence_type === "once") {
		if (reminder.is_completed) return null;
		return new Date(reminder.starts_at);
	}

	const end = getRecurrenceEnd(reminder);
	const template = new Date(reminder.starts_at);
	const cursor = isAllDay(reminder)
		? new Date(startOfDay(after).getTime() - 1)
		: after;
	let candidate =
		template > cursor ? template : advanceOccurrence(reminder, cursor);

	for (let i = 0; i < 500; i++) {
		if (end && candidate > end) return null;
		const key = candidate.toISOString();
		if (!completed.has(key)) return candidate;
		candidate = advanceOccurrence(reminder, candidate);
	}
	return null;
}

export function getListGroup(next: Date, now = new Date()): ListGroup {
	const today = startOfDay(now);
	const tomorrow = addDays(today, 1);
	const dayAfterTomorrow = addDays(today, 2);
	const nextDay = startOfDay(next);

	if (nextDay < today) return "past";
	if (nextDay < tomorrow) return "today";
	if (nextDay < dayAfterTomorrow) return "tomorrow";
	return "upcoming";
}

export function formatOccurrenceLabel(
	date: Date,
	now = new Date(),
	options: { completed?: boolean; allDay?: boolean } = {},
): string {
	const today = startOfDay(now);
	const tomorrow = addDays(today, 1);
	const nextDay = startOfDay(date);
	const dayPart = options.allDay
		? "dia todo"
		: date.toLocaleTimeString("pt-BR", {
				hour: "2-digit",
				minute: "2-digit",
			});

	if (nextDay < today) {
		const when = options.allDay
			? `${date.toLocaleDateString("pt-BR")} · dia todo`
			: `${date.toLocaleDateString("pt-BR")} ${dayPart}`;
		return options.completed || options.allDay ? when : `${when} · atrasado`;
	}
	if (nextDay.getTime() === today.getTime()) {
		return options.allDay ? "Hoje · dia todo" : `Hoje ${dayPart}`;
	}
	if (nextDay.getTime() === tomorrow.getTime()) {
		return options.allDay ? "Amanhã · dia todo" : `Amanhã ${dayPart}`;
	}
	return options.allDay
		? `${date.toLocaleDateString("pt-BR")} · dia todo`
		: `${date.toLocaleDateString("pt-BR")} ${dayPart}`;
}

export function getAlertFireTime(occurrence: Date, minutesBefore: number): Date {
	return new Date(occurrence.getTime() - minutesBefore * 60_000);
}
