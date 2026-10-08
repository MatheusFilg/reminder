import { BrowserView, Utils, type RPCSchema } from "electrobun/bun";
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
	getImportedEventByIdDb,
	listImportedInWindowDb,
	saveSettings,
	snoozeReminder,
	updateReminder,
	upsertImportedEventsDb,
	dismissImportedSimilarDb,
	listImportedIgnoreRulesDb,
	removeImportedIgnoreRuleDb,
} from "./db";
import { ICS_IMPORT_WINDOW_DAYS } from "./ics";
import { prepareIcsImport } from "./icsImport";
import {
	formatImportedEventTitle,
	shouldHideImportedDescription,
} from "./importedDisplay";
import {
	IMPORTED_ALERT_OFFSETS_MINUTES,
	importedDbIdFromListId,
	isImportedListId,
	listIdForImported,
} from "./importedEvents";
import type { ImportedEventRow } from "./types";
import {
	formatOccurrenceLabel,
	getListGroup,
	getNextOccurrence,
	isAllDay,
	startOfDay,
} from "./recurrence";
import { setAutostart } from "./autostart";
import { playReminderSavedSound } from "./notifications";
import { notifyAllDayRemindersOnOpen, onSchedulerTick, runSchedulerTick } from "./scheduler";
import {
	getGoogleCalendarStatus,
	runGoogleOAuthConnect,
} from "./googleAuth";
import {
	disconnectGoogleCalendar,
	syncGoogleCalendarEvents,
	startGoogleCalendarBackgroundSync,
} from "./googleCalendar";
import type { GoogleCalendarStatus } from "./googleAuth";

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
			deferPopoverBlur: {
				params: { ms?: number };
				response: { ok: true };
			};
			importIcs: {
				params: { text: string };
				response: { imported: number; skipped: number; error?: string };
			};
			getGoogleCalendarStatus: { params: {}; response: GoogleCalendarStatus };
			connectGoogleCalendar: {
				params: {};
				response: { ok: boolean; email?: string; error?: string };
			};
			disconnectGoogleCalendar: { params: {}; response: { ok: true } };
			syncGoogleCalendar: {
				params: {};
				response: { imported: number; error?: string };
			};
			dismissImportedSimilar: {
				params: { listId: number; mode: "hide" | "remove" };
				response: { removed: number; ruleAdded: boolean; error?: string };
			};
			getImportedIgnoreRules: {
				params: {};
				response: {
					rules: {
						id: number;
						titleNorm: string;
						sampleTitle: string;
						createdAt: string;
					}[];
				};
			};
			removeImportedIgnoreRule: {
				params: { ruleId: number };
				response: { ok: true };
			};
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
		source: "local",
		readOnly: false,
	};
}

function importedListWindow(now: Date, missedHours: number) {
	const from = new Date(now.getTime() - missedHours * 60 * 60 * 1000);
	const to = new Date(now);
	to.setDate(to.getDate() + ICS_IMPORT_WINDOW_DAYS);
	return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

function buildImportedListItem(row: ImportedEventRow): ReminderListItem {
	const occurrence = new Date(row.starts_at);
	const display = formatImportedEventTitle(row.summary);
	const hideDesc = shouldHideImportedDescription(
		row.description,
		display.tags,
	);
	return {
		id: listIdForImported(row.id),
		name: display.title,
		nameFull: display.fullTitle,
		displayTags: display.tags.length ? display.tags : undefined,
		description: hideDesc ? "" : row.description,
		recurrenceType: "once",
		nextOccurrence: occurrence.toISOString(),
		nextOccurrenceLabel: formatOccurrenceLabel(occurrence, new Date(), {
			allDay: row.all_day === 1,
		}),
		group: getListGroup(occurrence),
		alertOffsetsMinutes: [...IMPORTED_ALERT_OFFSETS_MINUTES],
		isPaused: false,
		allDay: row.all_day === 1,
		source: row.source === "google" ? "google" : "ics",
		readOnly: true,
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
	onHide?: () => void,
	onPinnedChange?: (pinned: boolean) => void,
	onThemeChange?: () => void,
	onDeferPopoverBlur?: (ms: number) => void,
) {
	const emitChanged = (reason: string) => {
		getView()?.rpc?.send["reminders-changed"]({ reason });
	};

	onSchedulerTick(() => emitChanged("scheduler"));

	return BrowserView.defineRPC<ReminderRPC>({
		maxRequestTime: 180_000,
		handlers: {
			requests: {
				getReminders: ({ filter, search }) => {
					const query = search?.trim().toLowerCase() ?? "";
					const settings = getSettings();
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

					if (filter === "active") {
						const { fromIso, toIso } = importedListWindow(
							now,
							settings.missedAlertHours,
						);
						for (const row of listImportedInWindowDb(fromIso, toIso)) {
							items.push(buildImportedListItem(row));
						}
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
					if (isImportedListId(id)) {
						throw new Error("Eventos importados são somente leitura");
					}
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
					void playReminderSavedSound();
					return { id: row.id };
				},
				updateReminder: ({ id, input }) => {
					if (isImportedListId(id)) return { ok: false };
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
					if (isImportedListId(id)) {
						return { ok: false };
					}
					deleteReminder(id);
					emitChanged("delete");
					return { ok: true };
				},
				completeReminder: ({ id, occurrenceAt }) => {
					if (isImportedListId(id)) return { ok: false };
					completeReminder(id, occurrenceAt);
					emitChanged("complete");
					return { ok: true };
				},
				snoozeReminder: ({ id, occurrenceAt, snoozeMinutes }) => {
					if (isImportedListId(id)) return { ok: false };
					snoozeReminder(id, occurrenceAt, 0, snoozeMinutes);
					emitChanged("snooze");
					return { ok: true };
				},
				getSettings: () => getSettings(),
				updateSettings: ({ partial }) => {
					const next = saveSettings(partial);
					if (partial.autostart !== undefined) {
						setAutostart(next.autostart);
					}
					if (partial.pinned !== undefined) {
						onPinnedChange?.(next.pinned);
					}
					const themeTouched =
						partial.theme !== undefined || partial.themePack !== undefined;
					if (themeTouched) {
						onThemeChange?.();
					}
					emitChanged(themeTouched ? "theme" : "settings");
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
				deferPopoverBlur: ({ ms }) => {
					onDeferPopoverBlur?.(ms ?? 12_000);
					return { ok: true };
				},
				importIcs: ({ text }) => {
					const prepared = prepareIcsImport(text);
					if (prepared.error) {
						return {
							imported: 0,
							skipped: prepared.skipped,
							error: prepared.error,
						};
					}
					const { imported, updated } = upsertImportedEventsDb(prepared.events);
					runSchedulerTick();
					emitChanged("import-ics");
					return {
						imported: imported + updated,
						skipped: prepared.skipped,
					};
				},
				getGoogleCalendarStatus: () => getGoogleCalendarStatus(),
				connectGoogleCalendar: async () => {
					try {
						const { email } = await runGoogleOAuthConnect((url) => {
							Utils.openExternal(url);
						});
						const sync = await syncGoogleCalendarEvents();
						startGoogleCalendarBackgroundSync();
						emitChanged("google-calendar");
						if (sync.error) {
							return {
								ok: true,
								email,
								error: `Conectado, mas a sync falhou: ${sync.error}`,
							};
						}
						return { ok: true, email };
					} catch (e) {
						return {
							ok: false,
							error: e instanceof Error ? e.message : String(e),
						};
					}
				},
				disconnectGoogleCalendar: () => {
					disconnectGoogleCalendar();
					emitChanged("google-calendar");
					return { ok: true };
				},
				syncGoogleCalendar: async () => {
					const result = await syncGoogleCalendarEvents();
					emitChanged("google-calendar");
					return result;
				},
				dismissImportedSimilar: ({ listId, mode }) => {
					if (!isImportedListId(listId)) {
						return {
							removed: 0,
							ruleAdded: false,
							error: "Evento importado inválido.",
						};
					}
					const row = getImportedEventByIdDb(importedDbIdFromListId(listId));
					if (!row) {
						return {
							removed: 0,
							ruleAdded: false,
							error: "Evento não encontrado.",
						};
					}
					const result = dismissImportedSimilarDb(row.summary, mode);
					runSchedulerTick();
					emitChanged("imported-dismiss");
					return result;
				},
				getImportedIgnoreRules: () => ({
					rules: listImportedIgnoreRulesDb(),
				}),
				removeImportedIgnoreRule: ({ ruleId }) => {
					removeImportedIgnoreRuleDb(ruleId);
					emitChanged("imported-ignore-rules");
					return { ok: true };
				},
			},
			messages: {},
		},
	});
}
