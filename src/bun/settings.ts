import type { AppSettings, ThemeMode, ThemePackId } from "./types";

export const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];
export const THEME_PACKS: ThemePackId[] = ["default", "paradox"];

export function parseThemeMode(value: string | undefined, fallback: ThemeMode): ThemeMode {
	if (value && THEME_MODES.includes(value as ThemeMode)) {
		return value as ThemeMode;
	}
	return fallback;
}

export function parseThemePack(value: string | undefined, fallback: ThemePackId): ThemePackId {
	if (value && THEME_PACKS.includes(value as ThemePackId)) {
		return value as ThemePackId;
	}
	return fallback;
}

export function appSettingsFromMap(
	map: Record<string, string>,
	defaults: AppSettings,
): AppSettings {
	return {
		autostart: map.autostart !== "false",
		pausedGlobally: map.pausedGlobally === "true",
		missedAlertHours: Number(map.missedAlertHours ?? defaults.missedAlertHours),
		pinned: map.pinned === "true",
		theme: parseThemeMode(map.theme, defaults.theme),
		themePack: parseThemePack(map.themePack, defaults.themePack),
	};
}
