import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";

const APP_ID = "dev.reminder.app";
const DESKTOP_NAME = "reminder.desktop";

function autostartDir() {
	return join(homedir(), ".config", "autostart");
}

function desktopFilePath(execPath: string) {
	return `[Desktop Entry]
Type=Application
Name=Reminder
Comment=App de lembretes na bandeja
Exec=${execPath}
Icon=dev.reminder.app
Terminal=false
Categories=Utility;
X-GNOME-Autostart-enabled=true
`;
}

export function setAutostart(enabled: boolean, execPath?: string) {
	const dir = autostartDir();
	const file = join(dir, DESKTOP_NAME);
	if (!enabled) {
		if (existsSync(file)) unlinkSync(file);
		return;
	}
	if (!execPath) return;
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(file, desktopFilePath(execPath), "utf8");
}

export { APP_ID };
