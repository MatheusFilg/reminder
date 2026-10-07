import { homedir } from "os";
import { dirname, join } from "path";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";

const APP_ID = "dev.reminder.app";
const DESKTOP_NAME = "reminder.desktop";

function autostartDir() {
	return join(homedir(), ".config", "autostart");
}

/** systemd-xdg-autostart exige um binário executável, não o JS empacotado. */
export function resolveAutostartExec(binPath = process.execPath): string {
	const launcher = join(dirname(binPath), "launcher");
	if (existsSync(launcher)) return launcher;
	return binPath;
}

export function buildDesktopEntry(execPath: string) {
	const escaped = execPath.replaceAll("'", "'\\''");
	// sleep: no boot o Screen do ElectroBun ainda não tem bounds (KDE/systemd ignora Delay).
	return `[Desktop Entry]
Type=Application
Name=Reminder
Comment=App de lembretes na bandeja
Exec=/bin/sh -c "sleep 2; exec '${escaped}'"
Icon=dev.reminder.app
Terminal=false
Hidden=false
Categories=Utility;
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=2
`;
}

export function setAutostart(
	enabled: boolean,
	execPath: string = resolveAutostartExec(),
	dir: string = autostartDir(),
) {
	const file = join(dir, DESKTOP_NAME);
	if (!enabled) {
		if (existsSync(file)) unlinkSync(file);
		return;
	}
	if (!execPath) return;
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(file, buildDesktopEntry(execPath), "utf8");
}

export { APP_ID };
