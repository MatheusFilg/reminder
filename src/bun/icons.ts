import { copyFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const APP_ICON_NAME = "dev.reminder.app";

export function installLinuxIcons(sourcePng: string) {
	if (!existsSync(sourcePng)) {
		throw new Error(`icon not found: ${sourcePng}`);
	}

	const hicolor = join(homedir(), ".local/share/icons/hicolor");
	for (const size of [22, 24, 32, 48, 128]) {
		const dir = join(hicolor, `${size}x${size}`, "apps");
		mkdirSync(dir, { recursive: true });
		copyFileSync(sourcePng, join(dir, `${APP_ICON_NAME}.png`));
	}

	const pixmaps = join(homedir(), ".local/share/pixmaps");
	mkdirSync(pixmaps, { recursive: true });
	copyFileSync(sourcePng, join(pixmaps, `${APP_ICON_NAME}.png`));

	return join(hicolor, "48x48", "apps", `${APP_ICON_NAME}.png`);
}
