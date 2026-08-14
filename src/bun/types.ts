export type RecurrenceType = "once" | "daily" | "weekly" | "monthly";
export type RecurrenceEndType = "never" | "until";
export type ReminderFilter = "active" | "completed";
export type ListGroup = "today" | "tomorrow" | "upcoming" | "past";

export interface ReminderRow {
	id: number;
	name: string;
	description: string;
	recurrence_type: RecurrenceType;
	starts_at: string;
	weekly_days: string | null;
	recurrence_end_type: RecurrenceEndType;
	recurrence_end_date: string | null;
	is_paused: number;
	is_completed: number;
	all_day: number;
	created_at: string;
	updated_at: string;
}

export interface ReminderInput {
	name: string;
	description: string;
	recurrenceType: RecurrenceType;
	startsAt: string;
	weeklyDays: number[];
	recurrenceEndType: RecurrenceEndType;
	recurrenceEndDate: string | null;
	alertOffsetsMinutes: number[];
	allDay: boolean;
}

export interface ReminderListItem {
	id: number;
	name: string;
	description: string;
	recurrenceType: RecurrenceType;
	nextOccurrence: string;
	nextOccurrenceLabel: string;
	group: ListGroup;
	alertOffsetsMinutes: number[];
	isPaused: boolean;
	allDay: boolean;
}

export interface AppSettings {
	autostart: boolean;
	pausedGlobally: boolean;
	missedAlertHours: number;
	pinned: boolean;
}

export interface AlertPreset {
	label: string;
	minutes: number;
}

export interface SnoozePreset {
	label: string;
	minutes: number;
}

export const ALERT_PRESETS: AlertPreset[] = [
	{ label: "Na hora", minutes: 0 },
	{ label: "15 minutos antes", minutes: 15 },
	{ label: "30 minutos antes", minutes: 30 },
	{ label: "1 hora antes", minutes: 60 },
	{ label: "2 horas antes", minutes: 120 },
	{ label: "1 dia antes", minutes: 1440 },
	{ label: "2 dias antes", minutes: 2880 },
	{ label: "1 semana antes", minutes: 10080 },
];

export const SNOOZE_PRESETS: SnoozePreset[] = [
	{ label: "5 min", minutes: 5 },
	{ label: "15 min", minutes: 15 },
	{ label: "30 min", minutes: 30 },
	{ label: "1 hora", minutes: 60 },
	{ label: "1 dia", minutes: 1440 },
];

export const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
