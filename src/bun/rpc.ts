import { BrowserView, type RPCSchema } from "electrobun/bun";
import {
	ALERT_PRESETS,
	SNOOZE_PRESETS,
	type AppSettings,
	type ReminderFilter,
	type ReminderInput,
	type ReminderListItem,
} from "./types";
import {
	completeReminder,
	createReminder,
	deleteReminder,
	getAlertOffsets,
	getAllReminders,
	getCompletedOccurrences,
	getCompletedOccurrenceList,
	getReminderById,
	getSettings,
	saveSettings,
	snoozeReminder,
	updateReminder,
} from "./db";
import {
	formatOccurrenceLabel,
	getListGroup,
	getNextOccurrence,
	isAllDay,
	startOfDay,
} from "./recurrence";
import { setAutostart } from "./autostart";
import { notifyAllDayRemindersOnOpen, onSchedulerTick, runSchedulerTick } from "./scheduler";

export type ReminderRPC = {
	bun: RPCSchema<{
		requests: {
			getReminders: {
				params: { filter: ReminderFilter; search?: string };
				response: ReminderListItem[];
			};
			getReminder: {
				params: { id: number };
				response: ReminderInput & { id: number };
			};
			createReminder: {
				params: { input: ReminderInput };
				response: { id: number };
			};
			updateReminder: {
				params: { id: number; input: ReminderInput };
				response: { ok: boolean };
			};
			deleteReminder: {
				params: { id: number };
				response: { ok: boolean };
			};
			completeReminder: {
				params: { id: number; occurrenceAt: string };
				response: { ok: boolean };
			};
			snoozeReminder: {
				params: {
					id: number;
					occurrenceAt: string;
					snoozeMinutes: number;
				};
				response: { ok: boolean };
			};
			getSettings: { params: {}; response: AppSettings };
			updateSettings: {
				params: { partial: Partial<AppSettings> };
				response: AppSettings;
			};
			getPresets: {
				params: {};
				response: {
					alerts: typeof ALERT_PRESETS;
					snoozes: typeof SNOOZE_PRESETS;
				};
			};
			hidePopover: { params: {}; response: { ok: true } };
		};
		messages: {};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {
			"reminders-changed": { reason: string };
		};
	}>;
};

function isOnceFinished(reminder: ReturnType<typeof getAllReminders>[number], now = new Date()) {
	if (reminder.recurrence_type !== "once") return false;
	if (reminder.is_completed) return true;
	if (isAllDay(reminder)) {
		return startOfDay(new Date(reminder.starts_at)).getTime() < startOfDay(now).getTime();
	}
	return new Date(reminder.starts_at) <= now;
}

function buildListItem(
	reminder: ReturnType<typeof getAllReminders>[number],
	occurrence: Date,
	completed = false,
): ReminderListItem {
	return {
		id: reminder.id,
		name: reminder.name,
		description: reminder.description,
		recurrenceType: reminder.recurrence_type,
		nextOccurrence: occurrence.toISOString(),
		nextOccurrenceLabel: formatOccurrenceLabel(occurrence, new Date(), {
			completed,
			allDay: isAllDay(reminder),
		}),
		group: getListGroup(occurrence),
		alertOffsetsMinutes: getAlertOffsets(reminder.id),
		isPaused: !!reminder.is_paused,
		allDay: isAllDay(reminder),
	};
}

function toInput(
	reminder: NonNullable<ReturnType<typeof getReminderById>>,
): ReminderInput & { id: number } {
	return {
		id: reminder.id,
		name: reminder.name,
		description: reminder.description,
		recurrenceType: reminder.recurrence_type,
		startsAt: reminder.starts_at,
		weeklyDays: reminder.weekly_days
			? (JSON.parse(reminder.weekly_days) as number[])
			: [],
		recurrenceEndType: reminder.recurrence_end_type,
		recurrenceEndDate: reminder.recurrence_end_date,
		alertOffsetsMinutes: getAlertOffsets(reminder.id),
		allDay: isAllDay(reminder),
	};
}

export function createReminderRPC(
	getView: () => BrowserView | undefined,
	execPath: string,
	onHide?: () => void,
	onPinnedChange?: (pinned: boolean) => void,
) {
	const emitChanged = (reason: string) => {
		getView()?.rpc?.send["reminders-changed"]({ reason });
	};

	onSchedulerTick(() => emitChanged("scheduler"));

	return BrowserView.defineRPC<ReminderRPC>({
		maxRequestTime: 10_000,
		handlers: {
			requests: {
				getReminders: ({ filter, search }) => {
					const query = search?.trim().toLowerCase() ?? "";
					const now = new Date();
					const items: ReminderListItem[] = [];

					for (const reminder of getAllReminders()) {
						if (filter === "completed") {
							if (isOnceFinished(reminder, now)) {
								if (!reminder.is_completed) {
									completeReminder(reminder.id, reminder.starts_at);
								}
								items.push(
									buildListItem(reminder, new Date(reminder.starts_at), true),
								);
								continue;
							}
							for (const occurrenceAt of getCompletedOccurrenceList(
								reminder.id,
							)) {
								items.push(
									buildListItem(reminder, new Date(occurrenceAt), true),
								);
							}
							continue;
						}

						if (isOnceFinished(reminder, now)) continue;
						const completed = getCompletedOccurrences(reminder.id);
						const next = getNextOccurrence(reminder, completed, now);
						if (!next) continue;
						items.push(buildListItem(reminder, next));
					}

					return items
						.filter((item) =>
							query ? item.name.toLowerCase().includes(query) : true,
						)
						.sort((a, b) => {
							if (filter === "completed") {
								return (
									new Date(b.nextOccurrence).getTime() -
									new Date(a.nextOccurrence).getTime()
								);
							}
							const groupOrder = {
								today: 0,
								tomorrow: 1,
								upcoming: 2,
								past: 3,
							};
							return (
								groupOrder[a.group] - groupOrder[b.group] ||
								new Date(a.nextOccurrence).getTime() -
									new Date(b.nextOccurrence).getTime()
							);
						});
				},
				getReminder: ({ id }) => {
					const reminder = getReminderById(id);
					if (!reminder) throw new Error("Lembrete não encontrado");
					if (isOnceFinished(reminder) || reminder.is_completed) {
						throw new Error("Lembretes concluídos não podem ser editados");
					}
					return toInput(reminder);
				},
				createReminder: ({ input }) => {
					const row = createReminder(input);
					runSchedulerTick();
					notifyAllDayRemindersOnOpen();
					emitChanged("create");
					return { id: row.id };
				},
				updateReminder: ({ id, input }) => {
					const existing = getReminderById(id);
					if (!existing) return { ok: false };
					if (isOnceFinished(existing) || existing.is_completed) {
						return { ok: false };
					}
					const row = updateReminder(id, input);
					if (!row) return { ok: false };
					runSchedulerTick();
					notifyAllDayRemindersOnOpen();
					emitChanged("update");
					return { ok: true };
				},
				deleteReminder: ({ id }) => {
					deleteReminder(id);
					emitChanged("delete");
					return { ok: true };
				},
				completeReminder: ({ id, occurrenceAt }) => {
					completeReminder(id, occurrenceAt);
					emitChanged("complete");
					return { ok: true };
				},
				snoozeReminder: ({ id, occurrenceAt, snoozeMinutes }) => {
					snoozeReminder(id, occurrenceAt, 0, snoozeMinutes);
					emitChanged("snooze");
					return { ok: true };
				},
				getSettings: () => getSettings(),
				updateSettings: ({ partial }) => {
					const next = saveSettings(partial);
					if (partial.autostart !== undefined) {
						setAutostart(next.autostart, execPath);
					}
					if (partial.pinned !== undefined) {
						onPinnedChange?.(next.pinned);
					}
					emitChanged("settings");
					return next;
				},
				getPresets: () => ({
					alerts: ALERT_PRESETS,
					snoozes: SNOOZE_PRESETS,
				}),
				hidePopover: () => {
					onHide?.();
					return { ok: true };
				},
			},
			messages: {},
		},
	});
}
