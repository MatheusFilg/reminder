import Electrobun, { Electroview } from "electrobun/view";

type RecurrenceType = "once" | "daily" | "weekly" | "monthly";
type ReminderFilter = "active" | "completed";
type ListGroup = "today" | "tomorrow" | "upcoming" | "past";

interface ReminderListItem {
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
	source?: "local" | "ics" | "google";
	readOnly?: boolean;
	nameFull?: string;
	displayTags?: string[];
}

interface ReminderInput {
	name: string;
	description: string;
	recurrenceType: RecurrenceType;
	startsAt: string;
	weeklyDays: number[];
	recurrenceEndType: "never" | "until";
	recurrenceEndDate: string | null;
	alertOffsetsMinutes: number[];
	allDay: boolean;
}

type ThemeMode = "system" | "light" | "dark";
type ThemePackId = "default" | "paradox";

function themePackAppIconUri(pack: ThemePackId): string {
	if (pack === "paradox") {
		return "views://assets/themes/paradox/app-icon.png";
	}
	return "views://assets/app-icon.png";
}

type SettingsSection =
	| null
	| "general"
	| "appearance"
	| "calendars"
	| "notifications";

interface AppSettings {
	autostart: boolean;
	pausedGlobally: boolean;
	missedAlertHours: number;
	pinned: boolean;
	theme: ThemeMode;
	themePack: ThemePackId;
}

interface AlertPreset {
	label: string;
	minutes: number;
}

interface SnoozePreset {
	label: string;
	minutes: number;
}

interface GoogleCalendarStatus {
	configured: boolean;
	connected: boolean;
	email: string | null;
	lastSyncAt: string | null;
}

interface ImportedIgnoreRule {
	id: number;
	titleNorm: string;
	sampleTitle: string;
	createdAt: string;
}

type ReminderRPC = {
	bun: {
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
			deleteReminder: { params: { id: number }; response: { ok: boolean } };
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
				response: { alerts: AlertPreset[]; snoozes: SnoozePreset[] };
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
			getGoogleCalendarStatus: {
				params: {};
				response: GoogleCalendarStatus;
			};
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
	};
	webview: {
		requests: {};
		messages: {
			"reminders-changed": { reason: string };
		};
	};
};

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const GROUP_LABELS: Record<ListGroup, string> = {
	today: "Hoje",
	tomorrow: "Amanhã",
	upcoming: "Próximos",
	past: "Anteriores",
};

const app = document.getElementById("app")!;
const modalRoot = document.getElementById("modal-root")!;

const state = {
	view: "list" as "list" | "settings",
	settingsSection: null as SettingsSection,
	filter: "active" as ReminderFilter,
	search: "",
	searchOpen: false,
	items: [] as ReminderListItem[],
	settings: null as AppSettings | null,
	alerts: [] as AlertPreset[],
	snoozes: [] as SnoozePreset[],
	googleCalendar: null as GoogleCalendarStatus | null,
	importedIgnoreRules: [] as ImportedIgnoreRule[],
	modal: null as
		| null
		| { mode: "create" }
		| { mode: "edit"; id: number }
		| { mode: "delete"; id: number; name: string }
		| { mode: "imported-dismiss"; id: number; name: string }
		| { mode: "google-disconnect"; email: string | null },
};

const rpc = Electroview.defineRPC<ReminderRPC>({
	maxRequestTime: 180_000,
	handlers: {
		requests: {},
		messages: {
			"reminders-changed": ({ reason }) => {
				if (reason === "theme") {
					void electrobun.rpc!.request.getSettings({}).then((settings) => {
						state.settings = settings;
						applyThemeFromSettings(settings);
						bindSystemThemeListener(settings.theme);
					});
					return;
				}
				void refresh();
				if (reason === "open-create") openModal("create");
				if (reason === "open-settings") {
					state.view = "settings";
					state.settingsSection = null;
				}
			},
		},
	},
});

const electrobun = new Electrobun.Electroview({ rpc });

let nativePickerBlurGuard = false;
function bindNativePickerBlurGuard() {
	if (nativePickerBlurGuard) return;
	nativePickerBlurGuard = true;
	document.addEventListener(
		"mousedown",
		(e) => {
			const t = e.target;
			if (t instanceof HTMLSelectElement) {
				void electrobun.rpc!.request.deferPopoverBlur({ ms: 15_000 });
				return;
			}
			if (t instanceof HTMLInputElement) {
				const type = t.type;
				if (
					type === "file" ||
					type === "date" ||
					type === "time" ||
					type === "datetime-local"
				) {
					void electrobun.rpc!.request.deferPopoverBlur({ ms: 15_000 });
				}
			}
		},
		true,
	);
}
bindNativePickerBlurGuard();

const ICONS: Record<string, string> = {
	plus: `<path d="M5 12h14"/><path d="M12 5v14"/>`,
	minus: `<path d="M5 12h14"/>`,
	settings: `<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>`,
	pencil: `<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>`,
	trash: `<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>`,
	calendar: `<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>`,
	bell: `<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>`,
	bellOff: `<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742"/><path d="m2 2 20 20"/><path d="M8.668 3.01A6 6 0 0 1 18 8c0 .637-.12 1.231-.322 1.746"/>`,
	pin: `<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>`,
	arrowLeft: `<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>`,
	chevronRight: `<path d="m9 18 6-6-6-6"/>`,
	eyeOff: `<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>`,
	refreshCw: `<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>`,
	link2Off: `<path d="M9 17H7A5 5 0 0 1 7 7"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>`,
	search: `<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>`,
	x: `<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`,
};

function icon(name: keyof typeof ICONS, size = 18) {
	return `<svg class="lucide" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

function iconGoogle(size = 20) {
	return `<svg class="icon-google" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>`;
}

const MONTH_LABELS = [
	"janeiro",
	"fevereiro",
	"março",
	"abril",
	"maio",
	"junho",
	"julho",
	"agosto",
	"setembro",
	"outubro",
	"novembro",
	"dezembro",
];

function pad2(n: number) {
	return String(n).padStart(2, "0");
}

function localDateParts(iso: string) {
	const d = new Date(iso);
	return {
		year: d.getFullYear(),
		month: d.getMonth() + 1,
		day: d.getDate(),
		hour: d.getHours(),
		minute: d.getMinutes(),
	};
}

function toIsoDate(year: number, month: number, day: number) {
	return `${year}-${pad2(month)}-${pad2(day)}`;
}

function formatIsoDateBR(isoDate: string) {
	const [year, month, day] = isoDate.split("-");
	if (!year || !month || !day) return "";
	return `${day}/${month}/${year}`;
}

function formatTime24(iso: string) {
	const d = localDateParts(iso);
	return `${pad2(d.hour)}:${pad2(d.minute)}`;
}

function parseDateBR(value: string) {
	const m = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
	if (!m) return null;
	const day = Number(m[1]);
	const month = Number(m[2]);
	const year = Number(m[3]);
	const test = new Date(year, month - 1, day);
	if (
		test.getFullYear() !== year ||
		test.getMonth() !== month - 1 ||
		test.getDate() !== day
	) {
		return null;
	}
	return { year, month, day };
}

function parseTime24(value: string) {
	const m = value.trim().match(/^(\d{2}):(\d{2})$/);
	if (!m) return null;
	const hour = Number(m[1]);
	const minute = Number(m[2]);
	if (hour > 23 || minute > 59) return null;
	return { hour, minute };
}

function maskDateBR(value: string) {
	const digits = value.replace(/\D/g, "").slice(0, 8);
	if (digits.length <= 2) return digits;
	if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
	return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function maskTime24(value: string) {
	const digits = value.replace(/\D/g, "").slice(0, 4);
	if (digits.length <= 2) return digits;
	return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function dateBRtoIso(value: string) {
	const parsed = parseDateBR(value);
	if (!parsed) return "";
	return toIsoDate(parsed.year, parsed.month, parsed.day);
}

function combineDateAndTime(dateStr: string, timeStr: string) {
	const date = parseDateBR(dateStr);
	const time = parseTime24(timeStr);
	if (!date || !time) return null;
	return new Date(
		date.year,
		date.month - 1,
		date.day,
		time.hour,
		time.minute,
		0,
		0,
	).toISOString();
}

function calendarDaysHtml(
	viewYear: number,
	viewMonth: number,
	selectedIso: string,
) {
	const first = new Date(viewYear, viewMonth - 1, 1);
	const startWeekday = first.getDay();
	const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
	const today = new Date();
	const todayIso = toIsoDate(
		today.getFullYear(),
		today.getMonth() + 1,
		today.getDate(),
	);
	const cells: string[] = [];
	for (let i = 0; i < startWeekday; i++) {
		cells.push(`<span class="cal-day empty"></span>`);
	}
	for (let day = 1; day <= daysInMonth; day++) {
		const iso = toIsoDate(viewYear, viewMonth, day);
		const classes = ["cal-day"];
		if (iso === selectedIso) classes.push("selected");
		if (iso === todayIso) classes.push("today");
		cells.push(
			`<button type="button" class="${classes.join(" ")}" data-day="${iso}">${day}</button>`,
		);
	}
	return cells.join("");
}

function bindMaskedInputs() {
	const date = document.getElementById("date") as HTMLInputElement;
	const time = document.getElementById("time") as HTMLInputElement;
	const endDate = document.getElementById(
		"end-date",
	) as HTMLInputElement | null;

	date.addEventListener("input", () => {
		date.value = maskDateBR(date.value);
	});
	time.addEventListener("input", () => {
		time.value = maskTime24(time.value);
	});
	endDate?.addEventListener("input", () => {
		endDate.value = maskDateBR(endDate.value);
	});
}

function bindCalendarSheet() {
	const form = document.getElementById("reminder-form") as HTMLFormElement;
	const sheet = document.getElementById("calendar-sheet") as HTMLDivElement;
	const label = document.getElementById("sheet-cal-label") as HTMLSpanElement;
	const grid = document.getElementById("sheet-cal-grid") as HTMLDivElement;
	let targetId = "date";
	let viewYear = new Date().getFullYear();
	let viewMonth = new Date().getMonth() + 1;

	const closeSheet = () => {
		sheet.classList.add("hidden");
		form.classList.remove("hidden");
	};

	const paint = () => {
		const field = document.getElementById(targetId) as HTMLInputElement;
		const selectedIso = dateBRtoIso(field.value);
		label.textContent = `${MONTH_LABELS[viewMonth - 1]} ${viewYear}`;
		grid.innerHTML = calendarDaysHtml(viewYear, viewMonth, selectedIso);
		grid.querySelectorAll<HTMLButtonElement>("[data-day]").forEach((btn) => {
			btn.addEventListener("click", () => {
				field.value = formatIsoDateBR(btn.dataset.day ?? "");
				closeSheet();
			});
		});
	};

	const openSheet = (id: string) => {
		targetId = id;
		const field = document.getElementById(id) as HTMLInputElement;
		const parsed =
			parseDateBR(field.value) ?? localDateParts(new Date().toISOString());
		viewYear = parsed.year;
		viewMonth = parsed.month;
		form.classList.add("hidden");
		sheet.classList.remove("hidden");
		paint();
	};

	document
		.querySelectorAll<HTMLButtonElement>("[data-open-calendar]")
		.forEach((btn) => {
			btn.addEventListener("click", () =>
				openSheet(btn.dataset.openCalendar ?? "date"),
			);
		});

	document.getElementById("sheet-back")?.addEventListener("click", closeSheet);
	sheet.querySelectorAll<HTMLButtonElement>("[data-cal-nav]").forEach((btn) => {
		btn.addEventListener("click", () => {
			viewMonth += Number(btn.dataset.calNav);
			if (viewMonth < 1) {
				viewMonth = 12;
				viewYear -= 1;
			} else if (viewMonth > 12) {
				viewMonth = 1;
				viewYear += 1;
			}
			paint();
		});
	});

	return { closeSheet, isOpen: () => !sheet.classList.contains("hidden") };
}

function defaultForm(): ReminderInput {
	const now = new Date();
	now.setDate(now.getDate() + 1);
	now.setMinutes(now.getMinutes() + 60 - (now.getMinutes() % 15));
	return {
		name: "",
		description: "",
		recurrenceType: "once",
		startsAt: now.toISOString(),
		weeklyDays: [now.getDay()],
		recurrenceEndType: "never",
		recurrenceEndDate: null,
		alertOffsetsMinutes: [1440, 60],
		allDay: false,
	};
}

let refreshSeq = 0;
let systemThemeMedia: MediaQueryList | null = null;

function resolvedThemeMode(theme: ThemeMode): "light" | "dark" {
	if (theme === "light") return "light";
	if (theme === "dark") return "dark";
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

function applyThemeFromSettings(settings: AppSettings) {
	const root = document.documentElement;
	if (settings.theme === "system") {
		root.removeAttribute("data-theme");
	} else {
		root.setAttribute("data-theme", settings.theme);
	}
	root.setAttribute("data-theme-resolved", resolvedThemeMode(settings.theme));
	if (settings.themePack === "default") {
		root.removeAttribute("data-pack");
	} else {
		root.setAttribute("data-pack", settings.themePack);
	}
	const logo = document.querySelector<HTMLImageElement>(".header-logo");
	if (logo) logo.src = themePackAppIconUri(settings.themePack);
}

function bindSystemThemeListener(theme: ThemeMode) {
	if (theme !== "system") {
		systemThemeMedia?.removeEventListener("change", onSystemThemeChange);
		systemThemeMedia = null;
		return;
	}
	if (!systemThemeMedia) {
		systemThemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
		systemThemeMedia.addEventListener("change", onSystemThemeChange);
	}
}

function onSystemThemeChange() {
	if (state.settings?.theme === "system") {
		applyThemeFromSettings(state.settings);
	}
}

async function refresh(mode: "full" | "list" = "full") {
	const seq = ++refreshSeq;
	const [items, settings, presets, googleCalendar, ignoreRules] = await Promise.all([
		electrobun.rpc!.request.getReminders({
			filter: state.filter,
			search: state.search,
		}),
		electrobun.rpc!.request.getSettings({}),
		electrobun.rpc!.request.getPresets({}),
		electrobun.rpc!.request.getGoogleCalendarStatus({}),
		electrobun.rpc!.request.getImportedIgnoreRules({}),
	]);
	if (seq !== refreshSeq) return;
	state.items = items;
	state.settings = settings;
	state.alerts = presets.alerts;
	state.snoozes = presets.snoozes;
	state.googleCalendar = googleCalendar;
	state.importedIgnoreRules = ignoreRules.rules;
	applyThemeFromSettings(settings);
	bindSystemThemeListener(settings.theme);

	if (mode === "list" && state.view === "list") {
		patchList();
		return;
	}
	render();
}

function patchList() {
	const content = document.querySelector(".content");
	if (!content) {
		render();
		return;
	}
	content.innerHTML = listItemsHtml();
	bindListActions();
	const count = document.querySelector(".footer span");
	if (count) count.textContent = `${state.items.length} lembrete(s)`;
}

function openModal(mode: "create" | "edit", id?: number) {
	state.modal =
		mode === "create" ? { mode: "create" } : { mode: "edit", id: id! };
	void renderModal();
}

function openDeleteModal(item: ReminderListItem) {
	state.modal = { mode: "delete", id: item.id, name: item.name };
	void renderModal();
}

function openImportedDismissModal(item: ReminderListItem) {
	state.modal = { mode: "imported-dismiss", id: item.id, name: item.name };
	void renderModal();
}

function openGoogleDisconnectModal() {
	state.modal = {
		mode: "google-disconnect",
		email: state.googleCalendar?.email ?? null,
	};
	void renderModal();
}

function closeModal() {
	state.modal = null;
	modalRoot.classList.add("hidden");
	modalRoot.setAttribute("aria-hidden", "true");
	modalRoot.innerHTML = "";
}

function renderDeleteModal(modal: {
	mode: "delete";
	id: number;
	name: string;
}) {
	modalRoot.classList.remove("hidden");
	modalRoot.setAttribute("aria-hidden", "false");
	modalRoot.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop"></div>
    <div class="modal modal-confirm" role="dialog" aria-modal="true" aria-labelledby="delete-title">
      <h2 id="delete-title">Excluir lembrete</h2>
      <p class="confirm-copy">
        O lembrete <strong>${escapeHtml(modal.name)}</strong> será removido. Esta ação não pode ser desfeita.
      </p>
      <div class="modal-actions">
        <button type="button" class="btn" id="cancel-modal">Cancelar</button>
        <button type="button" class="btn btn-danger-solid" id="confirm-delete">Excluir</button>
      </div>
    </div>
  `;

	const close = () => closeModal();
	document.getElementById("modal-backdrop")?.addEventListener("click", close);
	document.getElementById("cancel-modal")?.addEventListener("click", close);
	document
		.getElementById("confirm-delete")
		?.addEventListener("click", async () => {
			await electrobun.rpc!.request.deleteReminder({ id: modal.id });
			closeModal();
			await refresh();
		});
	document.addEventListener(
		"keydown",
		(e) => {
			if (e.key === "Escape") closeModal();
		},
		{ once: true },
	);
}

function renderImportedDismissModal(modal: {
	mode: "imported-dismiss";
	id: number;
	name: string;
}) {
	modalRoot.classList.remove("hidden");
	modalRoot.setAttribute("aria-hidden", "false");
	modalRoot.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop"></div>
    <div class="modal modal-confirm" role="dialog" aria-modal="true" aria-labelledby="imported-dismiss-title">
      <h2 id="imported-dismiss-title">Eventos importados semelhantes</h2>
      <p class="confirm-copy">
        Aplicar a todos com título igual ou parecido com
        <strong>${escapeHtml(modal.name)}</strong> (inclui outras datas, ex. toda sexta).
      </p>
      <div class="modal-actions modal-actions-stack">
        <button type="button" class="btn btn-primary" id="imported-hide-similar">Ocultar e não avisar</button>
        <button type="button" class="btn" id="imported-remove-similar">Remover só agora</button>
        <button type="button" class="btn" id="cancel-modal">Cancelar</button>
      </div>
      <p class="setting-hint modal-foot-hint">Ocultar: some da lista e não volta na sync. Remover só agora: apaga desta vez; na próxima sync pode voltar.</p>
    </div>
  `;

	const close = () => closeModal();
	const run = async (mode: "hide" | "remove") => {
		const result = await electrobun.rpc!.request.dismissImportedSimilar({
			listId: modal.id,
			mode,
		});
		closeModal();
		if (result.error) {
			alert(result.error);
			return;
		}
		await refresh();
	};
	document.getElementById("modal-backdrop")?.addEventListener("click", close);
	document.getElementById("cancel-modal")?.addEventListener("click", close);
	document
		.getElementById("imported-hide-similar")
		?.addEventListener("click", () => void run("hide"));
	document
		.getElementById("imported-remove-similar")
		?.addEventListener("click", () => void run("remove"));
	document.addEventListener(
		"keydown",
		(e) => {
			if (e.key === "Escape") closeModal();
		},
		{ once: true },
	);
}

function renderGoogleDisconnectModal(modal: {
	mode: "google-disconnect";
	email: string | null;
}) {
	const accountLine = modal.email
		? `Conta <strong>${escapeHtml(modal.email)}</strong>. `
		: "";
	modalRoot.classList.remove("hidden");
	modalRoot.setAttribute("aria-hidden", "false");
	modalRoot.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop"></div>
    <div class="modal modal-confirm" role="dialog" aria-modal="true" aria-labelledby="google-disconnect-title">
      <h2 id="google-disconnect-title">Desvincular Google Agenda?</h2>
      <p class="confirm-copy">
        ${accountLine}Os tokens saem só deste computador. Os <strong>eventos importados</strong> da Google Agenda somem da lista e os <strong>avisos</strong> ligados a eles são removidos. Seus lembretes criados no app não são apagados.
      </p>
      <div class="modal-actions">
        <button type="button" class="btn" id="cancel-modal">Cancelar</button>
        <button type="button" class="btn btn-danger-solid" id="confirm-google-disconnect">Desvincular</button>
      </div>
    </div>
  `;

	const close = () => closeModal();
	document.getElementById("modal-backdrop")?.addEventListener("click", close);
	document.getElementById("cancel-modal")?.addEventListener("click", close);
	document
		.getElementById("confirm-google-disconnect")
		?.addEventListener("click", async () => {
			await electrobun.rpc!.request.disconnectGoogleCalendar({});
			closeModal();
			const status = document.getElementById("google-status");
			if (status) {
				status.hidden = false;
				status.classList.remove("import-error");
				status.textContent = "Conta desvinculada.";
			}
			await refresh();
		});
	document.addEventListener(
		"keydown",
		(e) => {
			if (e.key === "Escape") closeModal();
		},
		{ once: true },
	);
}

function listItemsHtml() {
	const groups: ListGroup[] =
		state.filter === "completed"
			? ["today", "past"]
			: ["today", "tomorrow", "upcoming"];
	const grouped = groups
		.map((g) => ({
			group: g,
			items: state.items.filter((i) => i.group === g),
		}))
		.filter((g) => g.items.length > 0);

	if (grouped.length === 0) {
		return `<div class="empty">Nenhum lembrete ${
			state.filter === "completed" ? "concluído" : "ativo"
		}.</div>`;
	}

	return grouped
		.map(
			(g) => `
        <section class="list-section" aria-labelledby="section-${g.group}">
          <h2 class="group-title" id="section-${g.group}">${GROUP_LABELS[g.group]}</h2>
          <div class="list-section-items">
        ${g.items
					.map(
						(item) => `
          <div class="item" data-id="${item.id}">
            <div class="item-main">
              <p class="item-name">
                <span class="item-name-text" title="${escapeHtml(item.nameFull ?? item.name)}">${escapeHtml(item.name)}</span>
                <span class="item-name-badges">
                ${(item.displayTags ?? [])
									.map(
										(tag) =>
											`<span class="item-tag">${escapeHtml(tag)}</span>`,
									)
									.join("")}
                ${
									item.readOnly
										? `<span class="badge-imported-icon" title="Importado do calendário" role="img" aria-label="Importado">${icon("calendar", 12)}</span>`
										: ""
								}
                </span>
              </p>
              <p class="item-meta">${escapeHtml(item.nextOccurrenceLabel)}</p>
              ${
								item.description
									? `<p class="item-desc">${escapeHtml(item.description)}</p>`
									: ""
							}
            </div>
            <div class="item-actions">
              ${
								state.filter === "completed" || item.readOnly
									? ""
									: `<button class="action-btn" data-edit="${item.id}" title="Editar" aria-label="Editar">${icon("pencil", 16)}</button>`
							}
              ${
								item.readOnly
									? `<button class="action-btn" data-dismiss-imported="${item.id}" title="Ocultar ou remover semelhantes" aria-label="Ocultar importados semelhantes">${icon("eyeOff", 16)}</button>`
									: `<button class="action-btn danger" data-delete="${item.id}" title="Excluir" aria-label="Excluir">${icon("trash", 16)}</button>`
							}
            </div>
          </div>`,
					)
					.join("")}
          </div>
        </section>
      `,
		)
		.join("");
}

function renderList() {
	return `
    <div class="toolbar">
      <div class="tabs">
        <button class="tab ${state.filter === "active" ? "active" : ""}" data-filter="active">Ativos</button>
        <button class="tab ${state.filter === "completed" ? "active" : ""}" data-filter="completed">Concluídos</button>
      </div>
    </div>
    <div class="content">${listItemsHtml()}</div>
  `;
}

function formatGoogleSyncLabel(iso: string | null) {
	if (!iso) return "Ainda não sincronizado";
	try {
		return `Última sync: ${new Date(iso).toLocaleString("pt-BR")}`;
	} catch {
		return "Última sync registrada";
	}
}

function themeModeLabel(theme: ThemeMode) {
	if (theme === "light") return "Claro";
	if (theme === "dark") return "Escuro";
	return "Sistema";
}

function googleCalendarHubSubtitle(g: GoogleCalendarStatus | null) {
	if (!g?.configured) return "OAuth não configurado";
	if (g.connected) return g.email ?? "Conta conectada";
	return "Nenhuma conta conectada";
}

function settingsHubRow(
	section: Exclude<SettingsSection, null>,
	title: string,
	subtitle: string,
	badge?: number,
) {
	const badgeHtml =
		badge && badge > 0
			? `<span class="settings-hub-badge" aria-label="${badge} oculto(s)">${badge}</span>`
			: "";
	return `<button type="button" class="settings-hub-row" data-settings-section="${section}">
      <span class="setting-copy">
        <span class="setting-title">${escapeHtml(title)}</span>
        <span class="setting-hint">${escapeHtml(subtitle)}</span>
      </span>
      <span class="settings-hub-row-trail">
        ${badgeHtml}
        <span class="settings-hub-chevron">${icon("chevronRight", 18)}</span>
      </span>
    </button>`;
}

function renderSettingsHub(s: AppSettings) {
	const g = state.googleCalendar;
	const hiddenCount = state.importedIgnoreRules.length;
	const appearanceSub = `${themeModeLabel(s.theme)}${s.themePack === "paradox" ? " · Paradox" : ""}`;
	return `
    <div class="settings settings-hub">
      <label class="setting-card" for="paused">
        <span class="setting-copy">
          <span class="setting-title">Pausar todos os lembretes</span>
          <span class="setting-hint">Silencia notificações até você retomar</span>
        </span>
        <span class="toggle">
          <input type="checkbox" id="paused" ${s.pausedGlobally ? "checked" : ""} />
          <span class="toggle-ui" aria-hidden="true"></span>
        </span>
      </label>
      <div class="settings-hub-nav">
        ${settingsHubRow(
					"notifications",
					"Notificações",
					hiddenCount > 0
						? `Avisos perdidos: até ${s.missedAlertHours} h · ${hiddenCount} oculta(s)`
						: `Avisos perdidos: até ${s.missedAlertHours} h`,
					hiddenCount > 0 ? hiddenCount : undefined,
				)}
        ${settingsHubRow("appearance", "Aparência", appearanceSub)}
        ${settingsHubRow("calendars", "Calendários", googleCalendarHubSubtitle(g))}
        ${settingsHubRow(
					"general",
					"Geral",
					s.autostart ? "Inicia com o sistema" : "Não inicia com o sistema",
				)}
      </div>
      <p class="setting-about setting-about-hub">Reminder v0.1.1</p>
    </div>`;
}

function renderSettingsNotifications(s: AppSettings) {
	const rules = state.importedIgnoreRules;
	return `
    <div class="settings">
      <div class="setting-card">
        <span class="setting-copy">
          <span class="setting-title">Avisos perdidos</span>
          <span class="setting-hint">Disparar atrasados até este limite</span>
        </span>
        <div class="stepper">
          <button type="button" class="stepper-btn" id="missed-dec" aria-label="Diminuir horas">${icon("minus", 14)}</button>
          <input id="missed" type="number" min="1" max="72" value="${s.missedAlertHours}" />
          <span class="stepper-unit">h</span>
          <button type="button" class="stepper-btn" id="missed-inc" aria-label="Aumentar horas">${icon("plus", 14)}</button>
        </div>
      </div>
      <div class="setting-card setting-card-column">
        <span class="setting-copy">
          <span class="setting-title">Notificações ocultadas</span>
          <span class="setting-hint">Importados com título semelhante não aparecem nem geram aviso após nova sync.</span>
        </span>
        ${
					rules.length > 0
						? `<ul class="ignore-rules-list">
          ${rules
						.map(
							(rule) => `
            <li class="ignore-rule">
              <span class="ignore-rule-title">${escapeHtml(rule.sampleTitle)}</span>
              <button type="button" class="btn btn-danger ignore-rule-remove" data-ignore-rule="${rule.id}">Permitir de novo</button>
            </li>`,
						)
						.join("")}
        </ul>`
						: `<p class="settings-empty">Nenhuma notificação ocultada.</p>`
				}
      </div>
    </div>`;
}

function renderSettingsAppearance(s: AppSettings) {
	return `
    <div class="settings">
      <div class="setting-card">
        <span class="setting-copy">
          <span class="setting-title">Aparência</span>
          <span class="setting-hint">Claro, escuro ou seguir o sistema</span>
        </span>
        <select id="theme-mode" class="setting-select" aria-label="Tema">
          <option value="system" ${s.theme === "system" ? "selected" : ""}>Sistema</option>
          <option value="light" ${s.theme === "light" ? "selected" : ""}>Claro</option>
          <option value="dark" ${s.theme === "dark" ? "selected" : ""}>Escuro</option>
        </select>
      </div>
      <label class="setting-card" for="theme-paradox">
        <span class="setting-copy">
          <span class="setting-title">Paradox</span>
          <span class="setting-hint">Paleta azul, ícone Pulse Grenade e sons temáticos ao avisar e ao salvar lembrete (fan work)</span>
        </span>
        <span class="toggle">
          <input type="checkbox" id="theme-paradox" ${s.themePack === "paradox" ? "checked" : ""} />
          <span class="toggle-ui" aria-hidden="true"></span>
        </span>
      </label>
    </div>`;
}

function renderSettingsGeneral(s: AppSettings) {
	return `
    <div class="settings">
      <label class="setting-card" for="autostart">
        <span class="setting-copy">
          <span class="setting-title">Iniciar com o sistema</span>
          <span class="setting-hint">Abre o Reminder ao ligar o computador</span>
        </span>
        <span class="toggle">
          <input type="checkbox" id="autostart" ${s.autostart ? "checked" : ""} />
          <span class="toggle-ui" aria-hidden="true"></span>
        </span>
      </label>
    </div>`;
}

function renderSettingsCalendars() {
	const g = state.googleCalendar;
	return `
    <div class="settings">
      <div class="setting-card setting-card-column">
        <span class="setting-copy">
          <span class="setting-title">Google Agenda</span>
          <span class="setting-hint">Todas as agendas visíveis da conta (leitura, ~90 dias). Tokens ficam só neste computador.</span>
        </span>
        ${
					!g?.configured
						? `<p class="import-status import-error">Credenciais OAuth ausentes. Siga <code>docs/google-cloud-oauth.md</code> (redirect <code>http://127.0.0.1:5198/oauth/callback</code>).</p>`
						: g.connected
							? `<p class="google-account">${escapeHtml(g.email ?? "Conta conectada")}</p>
               <p class="setting-hint">${formatGoogleSyncLabel(g.lastSyncAt)}</p>`
							: `<p class="setting-hint">Nenhuma conta conectada.</p>`
				}
        <div class="google-actions">
          <button type="button" class="google-icon-btn google-icon-btn-primary" id="google-connect" title="Conectar Google" aria-label="Conectar Google" ${!g?.configured || g?.connected ? "disabled" : ""}>${iconGoogle(20)}</button>
          <button type="button" class="google-icon-btn" id="google-sync" title="Sincronizar agora" aria-label="Sincronizar agora" ${!g?.connected ? "disabled" : ""}>${icon("refreshCw", 18)}</button>
          <button type="button" class="google-icon-btn google-icon-btn-danger" id="google-disconnect" title="Desvincular conta Google" aria-label="Desvincular conta Google" ${!g?.connected ? "disabled" : ""}>${icon("link2Off", 20)}</button>
        </div>
        <p class="import-status" id="google-status" hidden></p>
      </div>
      <div class="setting-card setting-card-column">
        <span class="setting-copy">
          <span class="setting-title">Importar calendário (.ics)</span>
          <span class="setting-hint">Próximos 90 dias, somente leitura. Recorrências (RRULE) são ignoradas.</span>
        </span>
        <input type="file" id="ics-file" accept=".ics,text/calendar" class="setting-file" />
        <p class="import-status" id="import-status" hidden></p>
      </div>
    </div>`;
}

function renderSettings() {
	const s = state.settings;
	if (!s) return "";
	if (state.settingsSection === "notifications") return renderSettingsNotifications(s);
	if (state.settingsSection === "appearance") return renderSettingsAppearance(s);
	if (state.settingsSection === "general") return renderSettingsGeneral(s);
	if (state.settingsSection === "calendars") return renderSettingsCalendars();
	return renderSettingsHub(s);
}

function render() {
	const paused = state.settings?.pausedGlobally;
	const pinned = state.settings?.pinned;
	const listSearchOpen = state.view === "list" && state.searchOpen;
	app.innerHTML = `
    <header class="header ${listSearchOpen ? "header-search-mode" : ""}">
      <div class="header-left">
        ${state.view === "settings" ? `<button class="icon-btn" id="back-btn" title="Voltar">${icon("arrowLeft")}</button>` : ""}
        ${
					listSearchOpen
						? `
        <div class="header-search-wrap">
          <input class="search header-search" type="search" placeholder="Buscar..." value="${escapeHtml(state.search)}" id="search-input" autocomplete="off" aria-label="Buscar lembretes" />
          <button type="button" class="icon-btn" id="search-close" title="Fechar busca" aria-label="Fechar busca">${icon("x", 16)}</button>
        </div>`
						: `
        <div class="header-brand">
          <img class="header-logo" src="${themePackAppIconUri(state.settings?.themePack ?? "default")}" alt="" width="36" height="36" />
          <div class="header-title">
            <h1>Reminder</h1>
            <span class="header-status">
              ${icon(paused ? "bellOff" : "bell", 13)}
              ${paused ? "Notificações pausadas" : "Notificações ativas"}
            </span>
          </div>
        </div>`
				}
      </div>
      <div class="header-actions">
        ${
					state.view === "list" && !listSearchOpen
						? `<button type="button" class="icon-btn ${state.search.trim() ? "on" : ""}" id="search-toggle" title="Buscar" aria-label="Buscar">${icon("search", 18)}</button>`
						: ""
				}
        <button class="icon-btn" id="add-btn" title="Novo lembrete" aria-label="Novo lembrete">${icon("plus")}</button>
        <button class="icon-btn ${state.view === "settings" ? "on" : ""}" id="settings-btn" title="Configurações" aria-label="Configurações">${icon("settings")}</button>
        <button class="icon-btn ${pinned ? "on" : ""}" id="pin-btn" title="${pinned ? "Desafixar" : "Fixar janela"}" aria-label="${pinned ? "Desafixar" : "Fixar janela"}">${icon("pin")}</button>
      </div>
    </header>
    ${state.view === "settings" ? `<div class="content content-settings">${renderSettings()}</div>` : renderList()}
    ${state.view === "settings" ? "" : `<footer class="footer"><span>${state.items.length} lembrete(s)</span></footer>`}
  `;

	bindMainEvents();
}

function bindMainEvents() {
	document
		.getElementById("add-btn")
		?.addEventListener("click", () => openModal("create"));
	document.getElementById("pin-btn")?.addEventListener("click", async () => {
		const next = !state.settings?.pinned;
		state.settings = await electrobun.rpc!.request.updateSettings({
			partial: { pinned: next },
		});
		render();
	});
	document.getElementById("settings-btn")?.addEventListener("click", () => {
		state.searchOpen = false;
		state.view = "settings";
		state.settingsSection = null;
		render();
	});
	document.getElementById("back-btn")?.addEventListener("click", () => {
		if (state.settingsSection) {
			state.settingsSection = null;
			render();
			return;
		}
		state.view = "list";
		state.settingsSection = null;
		render();
	});

	document.querySelectorAll("[data-settings-section]").forEach((btn) => {
		btn.addEventListener("click", () => {
			const section = btn.getAttribute(
				"data-settings-section",
			) as Exclude<SettingsSection, null>;
			state.settingsSection = section;
			render();
		});
	});

	document.getElementById("search-toggle")?.addEventListener("click", () => {
		state.searchOpen = true;
		render();
	});
	document.getElementById("search-close")?.addEventListener("click", () => {
		state.searchOpen = false;
		render();
	});
	const searchInput = document.getElementById(
		"search-input",
	) as HTMLInputElement | null;
	searchInput?.addEventListener("input", (e) => {
		state.search = (e.target as HTMLInputElement).value;
		void refresh("list");
	});
	searchInput?.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			state.searchOpen = false;
			render();
		}
	});
	if (searchInput) {
		requestAnimationFrame(() => searchInput.focus());
	}

	document.querySelectorAll("[data-filter]").forEach((btn) => {
		btn.addEventListener("click", () => {
			state.filter = btn.getAttribute("data-filter") as ReminderFilter;
			void refresh();
		});
	});

	bindListActions();

	document
		.getElementById("autostart")
		?.addEventListener("change", async (e) => {
			await electrobun.rpc!.request.updateSettings({
				partial: { autostart: (e.target as HTMLInputElement).checked },
			});
			await refresh();
		});
	document.getElementById("paused")?.addEventListener("change", async (e) => {
		await electrobun.rpc!.request.updateSettings({
			partial: { pausedGlobally: (e.target as HTMLInputElement).checked },
		});
		await refresh();
	});
	document.getElementById("missed")?.addEventListener("change", async (e) => {
		const raw = Number((e.target as HTMLInputElement).value);
		const val = Math.min(72, Math.max(1, Number.isFinite(raw) ? raw : 24));
		(e.target as HTMLInputElement).value = String(val);
		await electrobun.rpc!.request.updateSettings({
			partial: { missedAlertHours: val },
		});
	});
	const nudgeMissed = async (delta: number) => {
		const input = document.getElementById("missed") as HTMLInputElement | null;
		if (!input) return;
		const val = Math.min(72, Math.max(1, Number(input.value || 24) + delta));
		input.value = String(val);
		await electrobun.rpc!.request.updateSettings({
			partial: { missedAlertHours: val },
		});
	};
	document
		.getElementById("missed-dec")
		?.addEventListener("click", () => void nudgeMissed(-1));
	document
		.getElementById("missed-inc")
		?.addEventListener("click", () => void nudgeMissed(1));
	document.getElementById("theme-mode")?.addEventListener("change", async (e) => {
		const theme = (e.target as HTMLSelectElement).value as ThemeMode;
		state.settings = await electrobun.rpc!.request.updateSettings({
			partial: { theme },
		});
		applyThemeFromSettings(state.settings);
		bindSystemThemeListener(state.settings.theme);
	});
	document
		.getElementById("theme-paradox")
		?.addEventListener("change", async (e) => {
			const checked = (e.target as HTMLInputElement).checked;
			state.settings = await electrobun.rpc!.request.updateSettings({
				partial: { themePack: checked ? "paradox" : "default" },
			});
			applyThemeFromSettings(state.settings);
			bindSystemThemeListener(state.settings.theme);
		});
	document.getElementById("google-connect")?.addEventListener("click", async () => {
		const status = document.getElementById("google-status");
		if (status) {
			status.hidden = false;
			status.classList.remove("import-error");
			status.textContent = "Abrindo o Google no navegador…";
		}
		const result = await electrobun.rpc!.request.connectGoogleCalendar({});
		if (status) {
			status.hidden = false;
			if (!result.ok) {
				status.classList.add("import-error");
				status.textContent = result.error ?? "Não foi possível conectar.";
			} else {
				status.classList.remove("import-error");
				status.textContent = result.error
					? result.error
					: `Conectado como ${result.email ?? "conta Google"}.`;
			}
		}
		await refresh();
	});
	document.getElementById("google-sync")?.addEventListener("click", async () => {
		const status = document.getElementById("google-status");
		if (status) {
			status.hidden = false;
			status.textContent = "Sincronizando…";
		}
		const result = await electrobun.rpc!.request.syncGoogleCalendar({});
		if (status) {
			status.hidden = false;
			if (result.error) {
				status.classList.add("import-error");
				status.textContent = result.error;
			} else {
				status.classList.remove("import-error");
				status.textContent = `${result.imported} evento(s) atualizado(s).`;
			}
		}
		await refresh();
	});
	document.getElementById("google-disconnect")?.addEventListener("click", () => {
		openGoogleDisconnectModal();
	});
	document.getElementById("ics-file")?.addEventListener("change", async (e) => {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		const status = document.getElementById("import-status");
		if (!file || !status) return;
		status.hidden = false;
		status.textContent = "Importando…";
		try {
			const text = await file.text();
			const result = await electrobun.rpc!.request.importIcs({ text });
			if (result.error) {
				status.textContent = result.error;
				status.classList.add("import-error");
			} else {
				status.classList.remove("import-error");
				status.textContent = `${result.imported} evento(s) importado(s)${
					result.skipped ? `, ${result.skipped} ignorado(s)` : ""
				}.`;
				await refresh();
			}
		} catch {
			status.textContent = "Não foi possível importar o arquivo.";
			status.classList.add("import-error");
		}
		input.value = "";
	});
	document.querySelectorAll(".ignore-rule-remove").forEach((btn) => {
		btn.addEventListener("click", async () => {
			const ruleId = Number(btn.getAttribute("data-ignore-rule"));
			if (!ruleId) return;
			await electrobun.rpc!.request.removeImportedIgnoreRule({ ruleId });
			await refresh();
		});
	});
}

function bindListActions() {
	document.querySelectorAll("[data-edit]").forEach((btn) => {
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			openModal("edit", Number(btn.getAttribute("data-edit")));
		});
	});

	document.querySelectorAll("[data-delete]").forEach((btn) => {
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const id = Number(btn.getAttribute("data-delete"));
			const item = state.items.find((i) => i.id === id);
			if (!item) return;
			openDeleteModal(item);
		});
	});

	document.querySelectorAll("[data-dismiss-imported]").forEach((btn) => {
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			const id = Number(btn.getAttribute("data-dismiss-imported"));
			const item = state.items.find((i) => i.id === id);
			if (!item) return;
			openImportedDismissModal(item);
		});
	});
}

async function renderModal() {
	if (!state.modal) return;

	if (state.modal.mode === "delete") {
		renderDeleteModal(state.modal);
		return;
	}

	if (state.modal.mode === "imported-dismiss") {
		renderImportedDismissModal(state.modal);
		return;
	}

	if (state.modal.mode === "google-disconnect") {
		renderGoogleDisconnectModal(state.modal);
		return;
	}

	let form: ReminderInput;
	if (state.modal.mode === "edit") {
		const data = await electrobun.rpc!.request.getReminder({
			id: state.modal.id,
		});
		form = data;
	} else {
		form = defaultForm();
	}

	const startParts = localDateParts(form.startsAt);
	const startDateBR = formatIsoDateBR(
		toIsoDate(startParts.year, startParts.month, startParts.day),
	);
	const startTime = formatTime24(form.startsAt);
	const endDateBR = form.recurrenceEndDate
		? formatIsoDateBR(
				toIsoDate(
					localDateParts(form.recurrenceEndDate).year,
					localDateParts(form.recurrenceEndDate).month,
					localDateParts(form.recurrenceEndDate).day,
				),
			)
		: "";

	modalRoot.classList.remove("hidden");
	modalRoot.setAttribute("aria-hidden", "false");
	modalRoot.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop"></div>
    <div class="modal" role="dialog" aria-modal="true">
      <h2>${state.modal.mode === "create" ? "Novo lembrete" : "Editar lembrete"}</h2>
      <form id="reminder-form">
        <div class="field">
          <label for="name">Nome *</label>
          <input id="name" required value="${escapeAttr(form.name)}" />
        </div>
        <div class="field">
          <label for="description">Descrição</label>
          <textarea id="description">${escapeHtml(form.description)}</textarea>
        </div>
        <label class="all-day-row" for="all-day">
          <span>
            <span class="setting-title">Dia todo</span>
            <span class="setting-hint">Tarefa do dia, sem horário. Aviso ao abrir o app.</span>
          </span>
          <span class="toggle">
            <input type="checkbox" id="all-day" ${form.allDay ? "checked" : ""} />
            <span class="toggle-ui" aria-hidden="true"></span>
          </span>
        </label>
        <p class="all-day-hint ${form.allDay ? "" : "hidden"}" id="all-day-hint">Você será avisado ao abrir o Reminder neste dia.</p>
        <div class="row-2" id="datetime-row">
          <div class="field">
            <label for="date">Data *</label>
            <div class="date-field">
              <input id="date" required placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10" value="${startDateBR}" />
              <button type="button" class="cal-btn" data-open-calendar="date" aria-label="Abrir calendário">${icon("calendar", 16)}</button>
            </div>
          </div>
          <div class="field" id="time-field">
            <label for="time">Hora *</label>
            <input id="time" placeholder="hh:mm" inputmode="numeric" maxlength="5" value="${startTime}" />
          </div>
        </div>
        <div class="field">
          <label for="recurrence">Recorrência</label>
          <select id="recurrence">
            <option value="once" ${form.recurrenceType === "once" ? "selected" : ""}>Pontual</option>
            <option value="daily" ${form.recurrenceType === "daily" ? "selected" : ""}>Diário</option>
            <option value="weekly" ${form.recurrenceType === "weekly" ? "selected" : ""}>Semanal</option>
            <option value="monthly" ${form.recurrenceType === "monthly" ? "selected" : ""}>Mensal</option>
          </select>
        </div>
        <div class="field" id="weekly-field" style="display:${form.recurrenceType === "weekly" ? "block" : "none"}">
          <label>Dias da semana</label>
          <div class="weekdays">
            ${WEEKDAY_LABELS.map(
							(label, i) => `
              <label class="weekday">
                <input type="checkbox" name="weekday" value="${i}" ${form.weeklyDays.includes(i) ? "checked" : ""} />
                <span>${label}</span>
              </label>`,
						).join("")}
          </div>
        </div>
        <div class="field">
          <label for="end-type">Fim da recorrência</label>
          <select id="end-type">
            <option value="never" ${form.recurrenceEndType === "never" ? "selected" : ""}>Sem fim</option>
            <option value="until" ${form.recurrenceEndType === "until" ? "selected" : ""}>Até uma data</option>
          </select>
        </div>
        <div class="field" id="end-date-field" style="display:${form.recurrenceEndType === "until" ? "block" : "none"}">
          <label for="end-date">Data final</label>
          <div class="date-field">
            <input id="end-date" placeholder="dd/mm/aaaa" inputmode="numeric" maxlength="10" value="${endDateBR}" />
            <button type="button" class="cal-btn" data-open-calendar="end-date" aria-label="Abrir calendário">${icon("calendar", 16)}</button>
          </div>
        </div>
        <div class="field" id="alerts-field">
          <label>Avisos</label>
          <div class="alert-chips" id="alerts" role="group" aria-label="Avisos">
            ${state.alerts
							.map((a) => {
								const on = form.alertOffsetsMinutes.includes(a.minutes);
								return `<button type="button" class="chip${on ? " selected" : ""}" data-minutes="${a.minutes}" aria-pressed="${on}">${a.label}</button>`;
							})
							.join("")}
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" id="cancel-modal">Cancelar</button>
          <button type="submit" class="btn btn-primary">${state.modal.mode === "create" ? "Criar" : "Salvar"}</button>
        </div>
      </form>
      <div class="calendar-sheet hidden" id="calendar-sheet">
        <button type="button" class="back-link" id="sheet-back">← Voltar</button>
        <h3>Escolher data</h3>
        <div class="cal-header">
          <button type="button" data-cal-nav="-1" aria-label="Mês anterior">‹</button>
          <span id="sheet-cal-label"></span>
          <button type="button" data-cal-nav="1" aria-label="Próximo mês">›</button>
        </div>
        <div class="cal-weekdays">${WEEKDAY_LABELS.map((d) => `<span>${d[0]}</span>`).join("")}</div>
        <div class="cal-grid" id="sheet-cal-grid"></div>
      </div>
    </div>
  `;

	const allDay = document.getElementById("all-day") as HTMLInputElement;
	const syncAllDay = () => {
		const on = allDay.checked;
		const timeField = document.getElementById("time-field")!;
		const timeInput = document.getElementById("time") as HTMLInputElement;
		const alertsField = document.getElementById("alerts-field")!;
		const hint = document.getElementById("all-day-hint")!;
		document.getElementById("datetime-row")?.classList.toggle("row-2-solo", on);
		timeField.style.display = on ? "none" : "block";
		timeInput.required = !on;
		alertsField.style.display = on ? "none" : "block";
		hint.classList.toggle("hidden", !on);
	};
	allDay.addEventListener("change", syncAllDay);
	syncAllDay();

	const recurrence = document.getElementById("recurrence") as HTMLSelectElement;
	recurrence.addEventListener("change", () => {
		const weeklyField = document.getElementById("weekly-field")!;
		weeklyField.style.display =
			recurrence.value === "weekly" ? "block" : "none";
	});

	const endType = document.getElementById("end-type") as HTMLSelectElement;
	endType.addEventListener("change", () => {
		const endDateField = document.getElementById("end-date-field")!;
		endDateField.style.display = endType.value === "until" ? "block" : "none";
	});

	document.querySelectorAll<HTMLButtonElement>(".chip").forEach((chip) => {
		chip.addEventListener("click", () => {
			const selected = chip.classList.toggle("selected");
			chip.setAttribute("aria-pressed", String(selected));
		});
	});

	bindMaskedInputs();
	const calendar = bindCalendarSheet();

	const close = () => {
		document.removeEventListener("keydown", onKey);
		closeModal();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key !== "Escape") return;
		if (calendar.isOpen()) {
			calendar.closeSheet();
			return;
		}
		close();
	};

	document.getElementById("modal-backdrop")?.addEventListener("click", close);
	document.getElementById("cancel-modal")?.addEventListener("click", close);
	document.addEventListener("keydown", onKey);

	document
		.getElementById("reminder-form")
		?.addEventListener("submit", async (e) => {
			e.preventDefault();
			const input = readForm();
			if (!input) {
				alert(
					"Informe a data no formato dd/mm/aaaa. Se não for dia todo, informe a hora no formato hh:mm (24h).",
				);
				return;
			}
			if (state.modal?.mode === "create") {
				await electrobun.rpc!.request.createReminder({ input });
			} else if (state.modal?.mode === "edit") {
				await electrobun.rpc!.request.updateReminder({
					id: state.modal.id,
					input,
				});
			}
			close();
			await refresh();
		});
}

function readForm(): ReminderInput | null {
	const recurrenceType = (
		document.getElementById("recurrence") as HTMLSelectElement
	).value as RecurrenceType;
	const weeklyDays = [
		...document.querySelectorAll<HTMLInputElement>(
			'input[name="weekday"]:checked',
		),
	].map((el) => Number(el.value));
	const alertOffsetsMinutes = [
		...document.querySelectorAll<HTMLButtonElement>(".chip.selected"),
	].map((el) => Number(el.dataset.minutes));
	const endType = (document.getElementById("end-type") as HTMLSelectElement)
		.value as "never" | "until";
	const endDate = (document.getElementById("end-date") as HTMLInputElement)
		.value;
	const dateValue = (document.getElementById("date") as HTMLInputElement).value;
	const allDay = (document.getElementById("all-day") as HTMLInputElement)
		.checked;
	const timeValue = (document.getElementById("time") as HTMLInputElement).value;
	const startsAt = combineDateAndTime(dateValue, allDay ? "00:00" : timeValue);
	if (!startsAt) return null;

	let recurrenceEndDate: string | null = null;
	if (endType === "until" && endDate) {
		const parsedEnd = parseDateBR(endDate);
		if (!parsedEnd) return null;
		recurrenceEndDate = new Date(
			parsedEnd.year,
			parsedEnd.month - 1,
			parsedEnd.day,
			23,
			59,
			59,
		).toISOString();
	}

	return {
		name: (document.getElementById("name") as HTMLInputElement).value,
		description: (document.getElementById("description") as HTMLTextAreaElement)
			.value,
		recurrenceType,
		startsAt,
		weeklyDays: weeklyDays.length ? weeklyDays : [new Date().getDay()],
		recurrenceEndType: endType,
		recurrenceEndDate,
		alertOffsetsMinutes: allDay
			? []
			: alertOffsetsMinutes.length > 0
				? alertOffsetsMinutes
				: [0],
		allDay,
	};
}

function escapeHtml(text: string) {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function escapeAttr(text: string) {
	return escapeHtml(text).replaceAll("'", "&#39;");
}

void refresh();
