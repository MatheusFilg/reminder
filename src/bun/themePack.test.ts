import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "bun:test";
import {
	resolveNotificationSoundPath,
	resolveReminderSavedSoundPath,
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

	test("resolveNotificationSoundPath prefers notify-alert.mp3", () => {
		const root = mkdtempSync(join(tmpdir(), "reminder-theme-"));
		const packDir = join(root, "themes", "paradox");
		mkdirSync(packDir, { recursive: true });
		const mp3 = join(packDir, "notify-alert.mp3");
		writeFileSync(mp3, "");
		writeFileSync(join(packDir, "notify.oga"), "");
		expect(resolveNotificationSoundPath("paradox", root)).toBe(mp3);
	});

	test("resolveNotificationSoundPath falls back to notify.oga", () => {
		const root = mkdtempSync(join(tmpdir(), "reminder-theme-"));
		const packDir = join(root, "themes", "paradox");
		mkdirSync(packDir, { recursive: true });
		const sound = join(packDir, "notify.oga");
		writeFileSync(sound, "");
		expect(resolveNotificationSoundPath("paradox", root)).toBe(sound);
	});

	test("resolveReminderSavedSoundPath returns path when mp3 exists", () => {
		const root = mkdtempSync(join(tmpdir(), "reminder-theme-"));
		const packDir = join(root, "themes", "paradox");
		mkdirSync(packDir, { recursive: true });
		const sound = join(packDir, "reminder-saved.mp3");
		writeFileSync(sound, "");
		expect(resolveReminderSavedSoundPath("paradox", root)).toBe(sound);
	});
});