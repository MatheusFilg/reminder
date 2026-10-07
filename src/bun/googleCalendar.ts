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

async function fetchGoogleEventsForCalendar(
	accessToken: string,
	calendarId: string,
	timeMin: string,
	timeMax: string,
): Promise<GoogleCalendarEventItem[]> {
	const items: GoogleCalendarEventItem[] = [];
	let pageToken: string | undefined;
	do {
		const params = new URLSearchParams({
			timeMin,
			timeMax,
			singleEvents: "true",
			orderBy: "startTime",
			maxResults: "250",
		});
		if (pageToken) params.set("pageToken", pageToken);
		const encodedId = encodeURIComponent(calendarId);
		const res = await fetch(
			`https://www.googleapis.com/calendar/v3/calendars/${encodedId}/events?${params}`,
			{ headers: { Authorization: `Bearer ${accessToken}` } },
		);
		if (!res.ok) {
			const text = await res.text();
			throw googleCalendarApiError(res.status, text);
		}
		const json = (await res.json()) as {
			items?: GoogleCalendarEventItem[];
			nextPageToken?: string;
		};
		items.push(...(json.items ?? []));
		pageToken = json.nextPageToken;
	} while (pageToken);
	return items;
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

export async function syncGoogleCalendarEvents(): Promise<{
	imported: number;
	error?: string;
}> {
	const accessToken = await getValidGoogleAccessToken();
	if (!accessToken) {
		return { imported: 0, error: "Conta Google não conectada." };
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

		for (const cal of calendars) {
			try {
				const raw = await fetchGoogleEventsForCalendar(
					accessToken,
					cal.id,
					timeMin,
					timeMax,
				);
				const calLabel = cal.summary?.trim();
				for (const ev of raw) {
					const mapped = googleEventToUpsert(ev, cal.id);
					if (!mapped) continue;
					if (calLabel && calendars.length > 1) {
						const title = mapped.summary;
						if (!title.startsWith(`${calLabel}:`)) {
							mapped.summary = `${calLabel}: ${title}`;
						}
					}
					ids.add(mapped.externalId);
					upserts.push(mapped);
				}
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
		pruneGoogleEventsNotInSet(ids, fromIso, toIso);
		setGoogleLastSyncAt(new Date().toISOString());
		runSchedulerTick();
		return { imported: imported + updated };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		if (isGoogleCalendarScopeError(message)) {
			clearGoogleAuthStored();
			return {
				imported: 0,
				error: `${message} Tokens antigos foram removidos — use Conectar Google de novo.`,
			};
		}
		return { imported: 0, error: message };
	}
}

export function disconnectGoogleCalendar() {
	clearGoogleAuthStored();
	deleteImportedBySource(db, "google");
	runSchedulerTick();
}

let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startGoogleCalendarBackgroundSync() {
	if (syncInterval) return;
	if (!getGoogleAuthStored()?.refreshToken) return;
	void syncGoogleCalendarEvents();
	syncInterval = setInterval(() => {
		if (!getGoogleAuthStored()?.refreshToken) return;
		void syncGoogleCalendarEvents();
	}, 30 * 60 * 1000);
}