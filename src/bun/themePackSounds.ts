import { existsSync } from "fs";
import { join } from "path";
import type { ThemePackId } from "./types";

export function resolveThemePackSound(
	pack: ThemePackId,
	viewsAssetsRoot: string,
	fileNames: string[],
): string | null {
	if (pack === "default") return null;
	for (const fileName of fileNames) {
		const soundPath = join(viewsAssetsRoot, "themes", pack, fileName);
		if (existsSync(soundPath)) return soundPath;
	}
	return null;
}

export function resolveNotificationSoundPath(
	pack: ThemePackId,
	viewsAssetsRoot: string,
): string | null {
	return resolveThemePackSound(pack, viewsAssetsRoot, [
		"notify-alert.mp3",
		"notify.oga",
	]);
}

export function resolveReminderSavedSoundPath(
	pack: ThemePackId,
	viewsAssetsRoot: string,
): string | null {
	return resolveThemePackSound(pack, viewsAssetsRoot, ["reminder-saved.mp3"]);
}
