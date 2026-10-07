import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, test } from "bun:test";
import {
	buildDesktopEntry,
	resolveAutostartExec,
	setAutostart,
} from "./autostart";

describe("autostart", () => {
	test("resolveAutostartExec prefers sibling launcher over bun/js", () => {
		const dir = mkdtempSync(join(tmpdir(), "reminder-autostart-"));
		const bun = join(dir, "bun");
		const launcher = join(dir, "launcher");
		writeFileSync(bun, "");
		writeFileSync(launcher, "");
		expect(resolveAutostartExec(bun)).toBe(launcher);
	});

	test("desktop Exec delays then runs the quoted launcher, not a .js file", () => {
		const exec = "/home/user/.local/share/dev.reminder.app/stable/app/bin/launcher";
		const desktop = buildDesktopEntry(exec);
		expect(desktop).toContain(`Exec=/bin/sh -c "sleep 2; exec '${exec}'"`);
		expect(desktop).toContain("X-GNOME-Autostart-Delay=2");
		expect(desktop).not.toContain(".js");
	});

	test("setAutostart writes a systemd-parseable Exec line", () => {
		const dir = mkdtempSync(join(tmpdir(), "reminder-xdg-"));
		mkdirSync(dir, { recursive: true });
		const launcher =
			"/home/user/.local/share/dev.reminder.app/stable/app/bin/launcher";
		setAutostart(true, launcher, dir);
		const file = join(dir, "reminder.desktop");
		expect(existsSync(file)).toBe(true);
		const body = readFileSync(file, "utf8");
		expect(body).toContain(`exec '${launcher}'`);
	});
});
