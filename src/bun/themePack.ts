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

export function resolveTrayIconPath(
	pack: ThemePackId,
	viewsAssetsRoot: string,
): string {
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
		return "views://assets/themes/paradox/tray.png";
	}
	return "views://assets/themes/default/tray.png";
}

export {
	resolveNotificationSoundPath,
	resolveReminderSavedSoundPath,
	resolveThemePackSound,
} from "./themePackSounds";
