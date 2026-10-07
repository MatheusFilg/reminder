import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "bun:test";
import {
	resolveNotificationSoundPath,
	resolveTrayIconPath,
} from "./themePack";

describe("themePack", () => {
	test("resolveTrayIconPath falls back to default app icon", () => {
		const root = mkdtempSync(join(tmpdir(), "reminder-theme-"));
		writeFileSync(join(root, "dev.reminder.app.png"), "");
		const path = resolveTrayIconPath("default", root);
		expect(path).toEndWith("dev.reminder.app.png");
	});

	test("resolveTrayIconPath uses pack tray when present", () => {
		const root = mkdtempSync(join(tmpdir(), "reminder-theme-"));
		const packDir = join(root, "themes", "paradox");
		mkdirSync(packDir, { recursive: true });
		const packTray = join(packDir, "tray.png");
		writeFileSync(packTray, "");
		expect(resolveTrayIconPath("paradox", root)).toBe(packTray);
	});

	test("resolveNotificationSoundPath returns null when missing", () => {
		const root = mkdtempSync(join(tmpdir(), "reminder-theme-"));
		expect(resolveNotificationSoundPath("paradox", root)).toBeNull();
	});

	test("resolveNotificationSoundPath returns path when notify.oga exists", () => {
		const root = mkdtempSync(join(tmpdir(), "reminder-theme-"));
		const packDir = join(root, "themes", "paradox");
		mkdirSync(packDir, { recursive: true });
		const sound = join(packDir, "notify.oga");
		writeFileSync(sound, "");
		expect(resolveNotificationSoundPath("paradox", root)).toBe(sound);
	});
});
