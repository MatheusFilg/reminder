import { describe, expect, test } from "bun:test";
import type { AppSettings } from "./types";
import { appSettingsFromMap, parseThemeMode, parseThemePack } from "./settings";

const defaultSettings: AppSettings = {
	autostart: true,
	pausedGlobally: false,
	missedAlertHours: 24,
	pinned: false,
	theme: "system",
	themePack: "default",
};

describe("settings", () => {
	test("parseThemeMode rejects invalid values", () => {
		expect(parseThemeMode("dark", "system")).toBe("dark");
		expect(parseThemeMode("nope", "system")).toBe("system");
	});

	test("parseThemePack rejects invalid values", () => {
		expect(parseThemePack("paradox", "default")).toBe("paradox");
		expect(parseThemePack("x", "default")).toBe("default");
	});

	test("appSettingsFromMap merges theme fields", () => {
		const settings = appSettingsFromMap(
			{
				autostart: "true",
				pausedGlobally: "false",
				missedAlertHours: "12",
				pinned: "false",
				theme: "light",
				themePack: "paradox",
			},
			defaultSettings,
		);
		expect(settings.theme).toBe("light");
		expect(settings.themePack).toBe("paradox");
		expect(settings.missedAlertHours).toBe(12);
	});
});
