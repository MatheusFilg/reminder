import { ICS_IMPORT_WINDOW_DAYS } from "./ics";
import {
	clearGoogleAuthStored,
	getGoogleAuthStored,
	getValidGoogleAccessToken,
	setGoogleLastSyncAt,
} from "./googleAuth";
import { deleteImportedBySource, upsertImportedEvents } from "./importedEvents";
import type { UpsertImportedInput } from "./importedEvents";
import { db, getSettings } from "./db";
import { runSchedulerTick } from "./scheduler";

interface GoogleCalendarEventItem {
	id: string;
	summary?: string;
	description?: string;
	start?: { dateTime?: string; date?: string };
	end?: { dateTime?: string; date?: string };
	status?: string;
}

function syncWindow(now: Date, missedHours: number) {
	const from = new Date(now.getTime() - missedHours * 60 * 60 * 1000);
	const to = new Date(now);
	to.setDate(to.getDate() + ICS_IMPORT_WINDOW_DAYS);
	return { from, to, fromIso: from.toISOString(), toIso: to.toISOString() };
}

export function googleImportedExternalId(calendarId: string, eventId: string): string {
	return `${calendarId}::${eventId}`;
}

export function googleEventToUpsert(
	ev: GoogleCalendarEventItem,
	calendarId?: string,
): UpsertImportedInput | null {
	if (!ev.id || ev.status === "cancelled") return null;
	const start = ev.start;
	if (!start) return null;
	const allDay = !!start.date && !start.dateTime;
	let startsAt: string;
	let endsAt: string | null = null;
	if (allDay && start.date) {
		const [y, m, d] = start.date.split("-").map(Number);
		startsAt = new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
		if (ev.end?.date) {
			const [ey, em, ed] = ev.end.date.split("-").map(Number);
			endsAt = new Date(ey, em - 1, ed, 0, 0, 0, 0).toISOString();
		}
	} else if (start.dateTime) {
		startsAt = new Date(start.dateTime).toISOString();
		if (ev.end?.dateTime) {
			endsAt = new Date(ev.end.dateTime).toISOString();
		}
	} else {
		return null;
	}
	return {
		externalId: calendarId
			? googleImportedExternalId(calendarId, ev.id)
			: ev.id,
		summary: ev.summary?.trim() || "(Sem título)",
		description: ev.description?.trim() ?? "",
		startsAt,
		endsAt,
		allDay,
		source: "google",
	};
}

interface GoogleCalendarListEntry {
	id: string;
	summary?: string;
	hidden?: boolean;
	deleted?: boolean;
}

export function isGoogleCalendarScopeError(message: string): boolean {
	const m = message.toLowerCase();
	return (
		m.includes("permissão do google agenda insuficiente") ||
		m.includes("insufficient authentication scopes") ||
		m.includes("access_token_scope_insufficient")
	);
}

function googleCalendarApiError(status: number, bodyText: string): Error {
	if (status === 403 && isGoogleCalendarScopeError(bodyText)) {
		return new Error(
			"Permissão do Google Agenda insuficiente. Em Configurações: Desconectar → Conectar de novo (o escopo calendar.readonly precisa estar na tela de consentimento do Google Cloud).",
		);
	}
	return new Error(`Google Agenda (${status}): ${bodyText.slice(0, 180)}`);
}

export async function fetchAccessibleGoogleCalendars(
	accessToken: string,
): Promise<GoogleCalendarListEntry[]> {
	const items: GoogleCalendarListEntry[] = [];
	let pageToken: string | undefined;
	do {
		const params = new URLSearchParams({
			minAccessRole: "reader",
			maxResults: "250",
		});
		if (pageToken) params.set("pageToken", pageToken);
		const res = await fetch(
			`https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`,
			{ headers: { Authorization: `Bearer ${accessToken}` } },
		);
		if (!res.ok) {
			const text = await res.text();
			throw googleCalendarApiError(res.status, text);
		}
		const json = (await res.json()) as {
			items?: GoogleCalendarListEntry[];
			nextPageToken?: string;
		};
		items.push(...(json.items ?? []));
		pageToken = json.nextPageToken;
	} while (pageToken);
	return items.filter((c) => c.id && !c.deleted && !c.hidden);
}

const GOOGLE_SYNC_TOKEN_KEY_PREFIX = "google_sync_token:";
const APP_OPEN_SYNC_DEBOUNCE_MS = 5 * 60 * 1000;

let lastAppOpenSyncAt = 0;

let onGoogleCalendarSyncComplete: ((result: {
	imported: number;
	error?: string;
}) => void) | null = null;

export function setGoogleCalendarSyncCompleteListener(
	listener: ((result: { imported: number; error?: string }) => void) | null,
) {
	onGoogleCalendarSyncComplete = listener;
}

interface GoogleEventsPage {
	items: GoogleCalendarEventItem[];
	nextPageToken?: string;
	nextSyncToken?: string;
}

function readCalendarSyncToken(calendarId: string): string | null {
	const row = db
		.query("SELECT value FROM settings WHERE key = ?")
		.get(`${GOOGLE_SYNC_TOKEN_KEY_PREFIX}${calendarId}`) as
		| { value: string }
		| undefined;
	return row?.value ?? null;
}

function writeCalendarSyncToken(calendarId: string, token: string) {
	db.query(
		"INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
	).run(`${GOOGLE_SYNC_TOKEN_KEY_PREFIX}${calendarId}`, token);
}

function clearCalendarSyncToken(calendarId: string) {
	db.query("DELETE FROM settings WHERE key = ?").run(
		`${GOOGLE_SYNC_TOKEN_KEY_PREFIX}${calendarId}`,
	);
}

export function clearGoogleCalendarSyncTokens() {
	db.query("DELETE FROM settings WHERE key LIKE ?").run(
		`${GOOGLE_SYNC_TOKEN_KEY_PREFIX}%`,
	);
}

function deleteGoogleImportedByExternalId(externalId: string) {
	db.query(
		"DELETE FROM imported_events WHERE source = 'google' AND external_id = ?",
	).run(externalId);
}

function importedStartsInWindow(startsAt: string, from: Date, to: Date): boolean {
	const t = new Date(startsAt).getTime();
	return t >= from.getTime() && t <= to.getTime();
}

async function fetchGoogleEventsPage(
	accessToken: string,
	calendarId: string,
	params: URLSearchParams,
): Promise<GoogleEventsPage> {
	const encodedId = encodeURIComponent(calendarId);
	const res = await fetch(
		`https://www.googleapis.com/calendar/v3/calendars/${encodedId}/events?${params}`,
		{ headers: { Authorization: `Bearer ${accessToken}` } },
	);
	if (!res.ok) {
		const text = await res.text();
		throw googleCalendarApiError(res.status, text);
	}
	return (await res.json()) as GoogleEventsPage;
}

async function fetchGoogleEventsForCalendar(
	accessToken: string,
	calendarId: string,
	timeMin: string,
	timeMax: string,
): Promise<{ items: GoogleCalendarEventItem[]; nextSyncToken: string | null }> {
	const items: GoogleCalendarEventItem[] = [];
	let pageToken: string | undefined;
	let nextSyncToken: string | null = null;
	do {
		const params = new URLSearchParams({
			timeMin,
			timeMax,
			singleEvents: "true",
			orderBy: "startTime",
			maxResults: "250",
		});
		if (pageToken) params.set("pageToken", pageToken);
		const json = await fetchGoogleEventsPage(accessToken, calendarId, params);
		items.push(...(json.items ?? []));
		pageToken = json.nextPageToken;
		if (json.nextSyncToken) nextSyncToken = json.nextSyncToken;
	} while (pageToken);
	return { items, nextSyncToken };
}

async function fetchGoogleEventsIncremental(
	accessToken: string,
	calendarId: string,
	syncToken: string,
): Promise<
	| { kind: "ok"; items: GoogleCalendarEventItem[]; nextSyncToken: string | null }
	| { kind: "reset" }
> {
	const items: GoogleCalendarEventItem[] = [];
	let pageToken: string | undefined;
	let token = syncToken;
	let nextSyncToken: string | null = null;
	do {
		const params = new URLSearchParams({
			maxResults: "250",
			showDeleted: "true",
		});
		if (pageToken) {
			params.set("pageToken", pageToken);
		} else {
			params.set("syncToken", token);
		}
		const encodedId = encodeURIComponent(calendarId);
		const res = await fetch(
			`https://www.googleapis.com/calendar/v3/calendars/${encodedId}/events?${params}`,
			{ headers: { Authorization: `Bearer ${accessToken}` } },
		);
		if (res.status === 410) {
			return { kind: "reset" };
		}
		if (!res.ok) {
			const text = await res.text();
			throw googleCalendarApiError(res.status, text);
		}
		const json = (await res.json()) as GoogleEventsPage;
		items.push(...(json.items ?? []));
		pageToken = json.nextPageToken;
		if (json.nextSyncToken) nextSyncToken = json.nextSyncToken;
	} while (pageToken);
	return { kind: "ok", items, nextSyncToken };
}

function decorateGoogleSummary(
	mapped: UpsertImportedInput,
	calLabel: string | undefined,
	multiCalendar: boolean,
) {
	if (calLabel && multiCalendar) {
		const title = mapped.summary;
		if (!title.startsWith(`${calLabel}:`)) {
			mapped.summary = `${calLabel}: ${title}`;
		}
	}
}

function collectGoogleEventChanges(
	raw: GoogleCalendarEventItem[],
	calendarId: string,
	calLabel: string | undefined,
	multiCalendar: boolean,
	from: Date,
	to: Date,
): { upserts: UpsertImportedInput[]; ids: Set<string> } {
	const upserts: UpsertImportedInput[] = [];
	const ids = new Set<string>();
	for (const ev of raw) {
		if (!ev.id) continue;
		const externalId = googleImportedExternalId(calendarId, ev.id);
		if (ev.status === "cancelled") {
			deleteGoogleImportedByExternalId(externalId);
			continue;
		}
		const mapped = googleEventToUpsert(ev, calendarId);
		if (!mapped) continue;
		if (!importedStartsInWindow(mapped.startsAt, from, to)) continue;
		decorateGoogleSummary(mapped, calLabel, multiCalendar);
		ids.add(mapped.externalId);
		upserts.push(mapped);
	}
	return { upserts, ids };
}

function pruneGoogleEventsNotInSet(externalIds: Set<string>, fromIso: string, toIso: string) {
	const rows = db
		.query(
			`SELECT external_id FROM imported_events
       WHERE source = 'google' AND starts_at >= ? AND starts_at <= ?`,
		)
		.all(fromIso, toIso) as { external_id: string }[];
	for (const row of rows) {
		if (!externalIds.has(row.external_id)) {
			db.query(
				"DELETE FROM imported_events WHERE source = 'google' AND external_id = ?",
			).run(row.external_id);
		}
	}
}

export async function syncGoogleCalendarEvents(options?: {
	forceFull?: boolean;
}): Promise<{
	imported: number;
	error?: string;
}> {
	const accessToken = await getValidGoogleAccessToken();
	if (!accessToken) {
		const result = { imported: 0, error: "Conta Google não conectada." };
		onGoogleCalendarSyncComplete?.(result);
		return result;
	}

	if (options?.forceFull) {
		clearGoogleCalendarSyncTokens();
	}

	const settings = getSettings();
	const now = new Date();
	const { from, to, fromIso, toIso } = syncWindow(now, settings.missedAlertHours);

	try {
		const timeMin = from.toISOString();
		const timeMax = to.toISOString();
		const calendars = await fetchAccessibleGoogleCalendars(accessToken);
		if (calendars.length === 0) {
			return { imported: 0, error: "Nenhuma agenda Google acessível nesta conta." };
		}

		const upserts: UpsertImportedInput[] = [];
		const ids = new Set<string>();
		const errors: string[] = [];

		const multiCalendar = calendars.length > 1;
		let anyFullSync = false;
		for (const cal of calendars) {
			try {
				const calLabel = cal.summary?.trim();
				let storedToken = readCalendarSyncToken(cal.id);
				let raw: GoogleCalendarEventItem[] = [];
				let nextSyncToken: string | null = null;
				let didFullSync = false;

				if (storedToken) {
					const incremental = await fetchGoogleEventsIncremental(
						accessToken,
						cal.id,
						storedToken,
					);
					if (incremental.kind === "reset") {
						clearCalendarSyncToken(cal.id);
						storedToken = null;
					} else {
						raw = incremental.items;
						nextSyncToken = incremental.nextSyncToken;
					}
				}

				if (!storedToken) {
					const full = await fetchGoogleEventsForCalendar(
						accessToken,
						cal.id,
						timeMin,
						timeMax,
					);
					raw = full.items;
					nextSyncToken = full.nextSyncToken;
					didFullSync = true;
				}

				if (nextSyncToken) {
					writeCalendarSyncToken(cal.id, nextSyncToken);
				}

				const { upserts: calUpserts, ids: calIds } = collectGoogleEventChanges(
					raw,
					cal.id,
					calLabel,
					multiCalendar,
					from,
					to,
				);
				upserts.push(...calUpserts);
				for (const id of calIds) ids.add(id);
				if (didFullSync) anyFullSync = true;
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				errors.push(message);
			}
		}

		if (upserts.length === 0 && errors.length === calendars.length) {
			return {
				imported: 0,
				error: errors[0] ?? "Não foi possível ler eventos das agendas.",
			};
		}
		const { imported, updated } = upsertImportedEvents(db, upserts);
		if (anyFullSync) {
			pruneGoogleEventsNotInSet(ids, fromIso, toIso);
		}
		setGoogleLastSyncAt(new Date().toISOString());
		runSchedulerTick();
		const result = { imported: imported + updated };
		onGoogleCalendarSyncComplete?.(result);
		return result;
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		if (isGoogleCalendarScopeError(message)) {
			clearGoogleCalendarSyncTokens();
			clearGoogleAuthStored();
			const result = {
				imported: 0,
				error: `${message} Tokens antigos foram removidos — use Conectar Google de novo.`,
			};
			onGoogleCalendarSyncComplete?.(result);
			return result;
		}
		const result = { imported: 0, error: message };
		onGoogleCalendarSyncComplete?.(result);
		return result;
	}
}

export function disconnectGoogleCalendar() {
	stopGoogleCalendarBackgroundSync();
	clearGoogleCalendarSyncTokens();
	clearGoogleAuthStored();
	deleteImportedBySource(db, "google");
	runSchedulerTick();
}

export async function maybeSyncGoogleCalendarOnAppOpen(): Promise<{
	imported: number;
	error?: string;
} | null> {
	if (!getGoogleAuthStored()?.refreshToken) return null;
	const now = Date.now();
	if (now - lastAppOpenSyncAt < APP_OPEN_SYNC_DEBOUNCE_MS) return null;
	lastAppOpenSyncAt = now;
	return syncGoogleCalendarEvents();
}

let syncInterval: ReturnType<typeof setInterval> | null = null;

function googleSyncIntervalMs(): number {
	return getSettings().googleCalendarSyncIntervalMinutes * 60 * 1000;
}

function stopGoogleCalendarBackgroundSync() {
	if (syncInterval) {
		clearInterval(syncInterval);
		syncInterval = null;
	}
}

function scheduleGoogleCalendarBackgroundSync() {
	stopGoogleCalendarBackgroundSync();
	if (!getGoogleAuthStored()?.refreshToken) return;
	syncInterval = setInterval(() => {
		if (!getGoogleAuthStored()?.refreshToken) return;
		void syncGoogleCalendarEvents();
	}, googleSyncIntervalMs());
}

export function restartGoogleCalendarBackgroundSync() {
	scheduleGoogleCalendarBackgroundSync();
}

export function startGoogleCalendarBackgroundSync() {
	if (!getGoogleAuthStored()?.refreshToken) return;
	const hadInterval = syncInterval !== null;
	scheduleGoogleCalendarBackgroundSync();
	if (!hadInterval) {
		void syncGoogleCalendarEvents();
	}
}