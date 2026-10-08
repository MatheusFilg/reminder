import { Utils } from "electrobun/bun";

/**
 * Mostra notificação visual no Linux.
 * notify-send costuma falhar em alguns ambientes (ex.: libnotify desalinhada);
 * o app usa a API nativa do Electrobun e, se preciso, gdbus.
 */
export async function showLinuxDesktopNotification(
	title: string,
	body: string,
	subtitle = "Reminder",
): Promise<boolean> {
	try {
		Utils.showNotification({
			title,
			body,
			subtitle,
			silent: true,
		});
		return true;
	} catch {
		// continua para fallbacks
	}

	const okGdbus = await tryGdbusNotify(title, body);
	if (okGdbus) return true;

	return tryNotifySend(title, body);
}

async function tryGdbusNotify(title: string, body: string): Promise<boolean> {
	try {
		const proc = Bun.spawn(
			[
				"gdbus",
				"call",
				"--session",
				"--dest",
				"org.freedesktop.Notifications",
				"--object-path",
				"/org/freedesktop/Notifications",
				"--method",
				"org.freedesktop.Notifications.Notify",
				"Reminder",
				"0",
				"dialog-information",
				title,
				body,
				"[]",
				"{}",
				"-1",
			],
			{ stdout: "ignore", stderr: "pipe" },
		);
		const code = await proc.exited;
		return code === 0;
	} catch {
		return false;
	}
}

async function tryNotifySend(title: string, body: string): Promise<boolean> {
	try {
		const proc = Bun.spawn(
			[
				"notify-send",
				"--app-name=Reminder",
				"--icon=dialog-information",
				"--urgency=normal",
				title,
				body,
			],
			{ stdout: "ignore", stderr: "pipe" },
		);
		const code = await proc.exited;
		return code === 0;
	} catch {
		return false;
	}
}
