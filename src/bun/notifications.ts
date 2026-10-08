import { PATHS } from "electrobun/bun";
import { join } from "path";
import { getSettings } from "./db";
import type { ImportedEventRow, ReminderRow } from "./types";
import { formatOccurrenceLabel } from "./recurrence";
import {
	resolveNotificationSoundPath,
	resolveReminderSavedSoundPath,
} from "./themePack";

const ALL_DAY_OPEN_ALERT = -1;

/** Volume linear 0–65536 (paplay). Sons do pack Paradox um pouco abaixo do máximo. */
const PARADOX_ALERT_VOLUME = Math.round(65536 * 0.6);
const PARADOX_SAVE_VOLUME = Math.round(65536 * 0.52);

async function playLinuxSoundFile(
	path: string,
	waitMs = 500,
	volume?: number,
): Promise<boolean> {
	try {
		const args =
			volume !== undefined
				? ["paplay", `--volume=${volume}`, path]
				: ["paplay", path];
		const proc = Bun.spawn(args, {
			stdout: "ignore",
			stderr: "ignore",
		});
		const exited = await Promise.race([
			proc.exited,
			Bun.sleep(waitMs).then(() => null),
		]);
		return exited === 0;
	} catch {
		return false;
	}
}

async function playLinuxNotificationSound() {
	const { themePack } = getSettings();
	const custom = resolveNotificationSoundPath(
		themePack,
		join(PATHS.VIEWS_FOLDER, "assets"),
	);
	if (
		custom &&
		(await playLinuxSoundFile(
			custom,
			500,
			themePack === "paradox" ? PARADOX_ALERT_VOLUME : undefined,
		))
	)
		return;
	try {
		const proc = Bun.spawn(["canberra-gtk-play", "-i", "message-new-instant"], {
			stdout: "ignore",
			stderr: "ignore",
		});
		const exited = await Promise.race([
			proc.exited,
			Bun.sleep(500).then(() => null),
		]);
		if (exited === 0) return;
	} catch {
		// fallback below
	}
	try {
		Bun.spawn(["paplay", "/usr/share/sounds/freedesktop/stereo/message.oga"], {
			stdout: "ignore",
			stderr: "ignore",
		});
	} catch {
		// no sound backend available
	}
}

/** Som ao criar lembrete (pack Paradox: reminder-saved.mp3). */
export async function playReminderSavedSound() {
	const { themePack } = getSettings();
	const custom = resolveReminderSavedSoundPath(
		themePack,
		join(PATHS.VIEWS_FOLDER, "assets"),
	);
	if (!custom) return;
	if (process.platform === "linux") {
		const volume =
			themePack === "paradox" ? PARADOX_SAVE_VOLUME : undefined;
		await playLinuxSoundFile(custom, 3000, volume);
	}
}

function notificationBody(reminder: ReminderRow, when: string, occurrence: Date) {
	const whenLine = `Lembrete ${when} · ${formatOccurrenceLabel(occurrence)}`;
	const description = reminder.description.trim();
	return description ? `${description}\n${whenLine}` : whenLine;
}

async function showLinuxNotification(title: string, body: string) {
	const proc = Bun.spawn(
		[
			"notify-send",
			"--app-name=Reminder",
			"--icon=appointment-soon",
			"--urgency=normal",
			title,
			body,
		],
		{ stdout: "ignore", stderr: "ignore" },
	);
	await proc.exited;
}

function importedNotificationBody(
	event: ImportedEventRow,
	when: string,
	occurrence: Date,
) {
	const whenLine = `Evento importado ${when} · ${formatOccurrenceLabel(occurrence)}`;
	const description = event.description.trim();
	return description ? `${description}\n${whenLine}` : whenLine;
}

export async function showImportedEventNotification(
	event: ImportedEventRow,
	occurrenceAt: string,
	minutesBefore: number,
) {
	const occurrence = new Date(occurrenceAt);
	const when =
		minutesBefore === ALL_DAY_OPEN_ALERT || minutesBefore === -1
			? "hoje · dia todo"
			: minutesBefore === 0
				? "agora"
				: minutesBefore < 60
					? `em ${minutesBefore} min`
					: minutesBefore === 60
						? "em 1 hora"
						: formatOccurrenceLabel(occurrence);

	const title = event.summary;
	const body = importedNotificationBody(event, when, occurrence);

	if (process.platform === "linux") {
		await showLinuxNotification(title, body);
		await playLinuxNotificationSound();
		return;
	}

	const { Utils } = await import("electrobun/bun");
	Utils.showNotification({
		title,
		body,
		subtitle: "Reminder · Importado",
		silent: false,
	});
}

export async function showReminderNotification(
	reminder: ReminderRow,
	occurrenceAt: string,
	minutesBefore: number,
) {
	const occurrence = new Date(occurrenceAt);
	const when =
		minutesBefore === ALL_DAY_OPEN_ALERT || minutesBefore === -1
			? "hoje · dia todo"
			: minutesBefore === 0
				? "agora"
			: minutesBefore < 60
				? `em ${minutesBefore} min`
				: minutesBefore === 60
					? "em 1 hora"
					: minutesBefore === 1440
						? "amanhã"
						: formatOccurrenceLabel(occurrence);

	const title = reminder.name;
	const body = notificationBody(reminder, when, occurrence);

	if (process.platform === "linux") {
		await showLinuxNotification(title, body);
		await playLinuxNotificationSound();
		return;
	}

	const { Utils } = await import("electrobun/bun");
	Utils.showNotification({
		title,
		body,
		subtitle: "Reminder",
		silent: false,
	});
}
