import type { ReminderRow } from "./types";
import { formatOccurrenceLabel } from "./recurrence";

const ALL_DAY_OPEN_ALERT = -1;

async function playLinuxNotificationSound() {
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
