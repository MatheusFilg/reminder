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

export function googleEventToUpsert(ev: GoogleCalendarEventItem): UpsertImportedInput | null {
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
		externalId: ev.id,
		summary: ev.summary?.trim() || "(Sem título)",
		description: ev.description?.trim() ?? "",
		startsAt,
		endsAt,
		allDay,
		source: "google",
	};
}

async function fetchAllGoogleEvents(
	accessToken: string,
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
		const res = await fetch(
			`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
			{ headers: { Authorization: `Bearer ${accessToken}` } },
		);
		if (!res.ok) {
			const text = await res.text();
			throw new Error(`Calendar API ${res.status}: ${text.slice(0, 200)}`);
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
		const raw = await fetchAllGoogleEvents(
			accessToken,
			from.toISOString(),
			to.toISOString(),
		);
		const upserts: UpsertImportedInput[] = [];
		const ids = new Set<string>();
		for (const ev of raw) {
			const mapped = googleEventToUpsert(ev);
			if (!mapped) continue;
			ids.add(mapped.externalId);
			upserts.push(mapped);
		}
		const { imported, updated } = upsertImportedEvents(db, upserts);
		pruneGoogleEventsNotInSet(ids, fromIso, toIso);
		setGoogleLastSyncAt(new Date().toISOString());
		runSchedulerTick();
		return { imported: imported + updated };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
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
