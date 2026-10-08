import { existsSync } from "fs";
import { join } from "path";
import type { ThemePackId } from "./types";

export function resolveThemePackAsset(
	pack: ThemePackId,
	fileName: string,
	viewsAssetsRoot: string,
	fallbackRelative: string,
): string {
	const packPath = join(viewsAssetsRoot, "themes", pack, fileName);
	if (existsSync(packPath)) return packPath;
	const fallback = join(viewsAssetsRoot, fallbackRelative);
	return existsSync(fallback) ? fallback : packPath;
}

/** Bandeja Paradox usa o mesmo PNG do cabeçalho (Pulse Grenade). */
const PARADOX_TRAY_FILE = "app-icon.png";

export function resolveTrayIconPath(
	pack: ThemePackId,
	viewsAssetsRoot: string,
): string {
	if (pack === "paradox") {
		return resolveThemePackAsset(
			pack,
			PARADOX_TRAY_FILE,
			viewsAssetsRoot,
			"dev.reminder.app.png",
		);
	}
	return resolveThemePackAsset(
		pack,
		"tray.png",
		viewsAssetsRoot,
		"dev.reminder.app.png",
	);
}

/** URI que o Tray do Electrobun resolve para o PNG no bundle. */
export function resolveTrayIconViewsUri(pack: ThemePackId): string {
	if (pack === "paradox") {
		return `views://assets/themes/paradox/${PARADOX_TRAY_FILE}`;
	}
	return "views://assets/themes/default/tray.png";
}

export {
	resolveNotificationSoundPath,
	resolveReminderSavedSoundPath,
	resolveThemePackSound,
} from "./themePackSounds";
