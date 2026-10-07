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

export function resolveNotificationSoundPath(
	pack: ThemePackId,
	viewsAssetsRoot: string,
): string | null {
	const soundPath = join(viewsAssetsRoot, "themes", pack, "notify.oga");
	return existsSync(soundPath) ? soundPath : null;
}
