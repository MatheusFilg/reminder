import { BrowserWindow, PATHS, Screen, Tray, Utils } from "electrobun/bun";
import { getSettings, saveSettings } from "./db";
import { setAutostart } from "./autostart";
import { createReminderRPC } from "./rpc";
import { notifyAllDayRemindersOnOpen, startScheduler } from "./scheduler";
import { startGoogleCalendarBackgroundSync } from "./googleCalendar";
import { applyLinuxRoundedCorners } from "./roundX11";
import { installLinuxIcons, installLinuxTrayIcon } from "./icons";
import { resolveTrayIconPath, resolveTrayIconViewsUri } from "./themePack";
import { join } from "path";

const POPOVER_WIDTH = 440;
const POPOVER_HEIGHT = 640;
const CORNER_RADIUS = 16;
const ANCHOR_RIGHT = 96;
const ANCHOR_TOP = 10;

let popoverVisible = false;
let popoverWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let ignoreBlurUntil = 0;

const FALLBACK_POS = { x: 0, y: 0 };

function isRect(value: unknown): value is { x: number; y: number; width: number } {
	if (!value || typeof value !== "object") return false;
	const rect = value as { x?: unknown; y?: unknown; width?: unknown };
	return (
		typeof rect.x === "number" &&
		typeof rect.y === "number" &&
		typeof rect.width === "number"
	);
}

function getPopoverPosition() {
	try {
		const display = Screen.getPrimaryDisplay?.() ?? null;
		if (!display || !isRect(display.bounds)) return FALLBACK_POS;
		const bounds = display.bounds;
		const work = isRect(display.workArea) ? display.workArea : bounds;
		const panelOffset = work.y > bounds.y ? work.y : bounds.y + 36;
		return {
			x: bounds.x + bounds.width - POPOVER_WIDTH - ANCHOR_RIGHT,
			y: panelOffset + ANCHOR_TOP,
		};
	} catch {
		return FALLBACK_POS;
	}
}

function positionPopover() {
	if (!popoverWindow) return;
	const { x, y } = getPopoverPosition();
	popoverWindow.setPosition(x, y);
}

function roundPopover() {
	applyLinuxRoundedCorners(POPOVER_WIDTH, POPOVER_HEIGHT, CORNER_RADIUS);
}

function deferPopoverBlur(ms = 12_000) {
	ignoreBlurUntil = Math.max(ignoreBlurUntil, Date.now() + ms);
}

function showPopover() {
	if (!popoverWindow) return;
	ignoreBlurUntil = Date.now() + 350;
	positionPopover();
	popoverWindow.show();
	popoverWindow.setAlwaysOnTop(true);
	popoverVisible = true;
	roundPopover();
	setTimeout(roundPopover, 120);
	notifyAllDayRemindersOnOpen();
}

function isPinned() {
	return getSettings().pinned;
}

function hidePopover() {
	if (!popoverWindow) return;
	popoverWindow.hide();
	popoverVisible = false;
}

function setPinned(pinned: boolean) {
	popoverWindow?.setAlwaysOnTop(true);
	if (pinned) {
		showPopover();
	}
}

function emitUiEvent(reason: string) {
	popoverWindow?.webview?.rpc?.send["reminders-changed"]({ reason });
}

function buildTrayMenu() {
	const paused = getSettings().pausedGlobally;
	return [
		{ type: "normal" as const, label: "Abrir", action: "open" },
		{ type: "normal" as const, label: "Novo lembrete", action: "new" },
		{
			type: "normal" as const,
			label: paused ? "Retomar lembretes" : "Pausar todos",
			action: "pause",
		},
		{ type: "normal" as const, label: "Configurações", action: "settings" },
		{ type: "divider" as const },
		{ type: "normal" as const, label: "Sair", action: "quit" },
	];
}

function refreshTrayMenu() {
	tray?.setMenu(buildTrayMenu());
}

const viewsAssetsRoot = join(PATHS.VIEWS_FOLDER, "assets");
const TRAY_PANEL_SIZE = 22;

function resolveTrayImage(themePack: ReturnType<typeof getSettings>["themePack"]) {
	const viewsUri = resolveTrayIconViewsUri(themePack);
	const iconPath = resolveTrayIconPath(themePack, viewsAssetsRoot);
	if (process.platform === "linux") {
		try {
			const trayFile =
				themePack === "paradox" ? "tray-paradox.png" : "tray-default.png";
			return installLinuxTrayIcon(iconPath, trayFile);
		} catch {
			return viewsUri;
		}
	}
	return viewsUri;
}

function bindTrayClicked() {
	if (!tray) return;
	tray.on("tray-clicked", (event: { data?: { action?: string } }) => {
		const action = event.data?.action;
		if (action) {
			handleTrayAction(action);
			return;
		}
		if (popoverVisible) {
			hidePopover();
			return;
		}
		showPopover();
	});
}

/** GTK/Linux: setTrayImage sozinho não atualiza o ícone — recria o tray. */
function recreateTray() {
	const image = resolveTrayImage(getSettings().themePack);
	tray?.remove();
	tray = new Tray({
		title: "Reminder",
		image,
		template: false,
		width: TRAY_PANEL_SIZE,
		height: TRAY_PANEL_SIZE,
	});
	tray.setImage(image);
	tray.setMenu(buildTrayMenu());
	bindTrayClicked();
}

function refreshTrayImage() {
	recreateTray();
}

function handleTrayAction(action: string) {
	switch (action) {
		case "open":
			showPopover();
			break;
		case "new":
			showPopover();
			setTimeout(() => emitUiEvent("open-create"), 80);
			break;
		case "pause": {
			const settings = getSettings();
			saveSettings({ pausedGlobally: !settings.pausedGlobally });
			refreshTrayMenu();
			emitUiEvent("settings");
			break;
		}
		case "settings":
			showPopover();
			setTimeout(() => emitUiEvent("open-settings"), 80);
			break;
		case "quit":
			tray?.remove();
			Utils.quit();
			break;
	}
}

const initialPos = getPopoverPosition();

popoverWindow = new BrowserWindow({
	title: "Reminder",
	url: "views://mainview/index.html",
	rpc: createReminderRPC(
		() => popoverWindow?.webview,
		hidePopover,
		setPinned,
		() => {
			refreshTrayImage();
			emitUiEvent("theme");
		},
		deferPopoverBlur,
	),
	titleBarStyle: "hidden",
	transparent: false,
	hidden: true,
	styleMask: {
		Borderless: true,
		Titled: false,
		Closable: false,
		Miniaturizable: false,
		Resizable: false,
	},
	frame: {
		width: POPOVER_WIDTH,
		height: POPOVER_HEIGHT,
		x: initialPos.x,
		y: initialPos.y,
	},
});

popoverWindow.on("blur", () => {
	setTimeout(() => {
		if (Date.now() < ignoreBlurUntil) return;
		if (!popoverVisible) return;
		if (isPinned()) return;
		hidePopover();
	}, 80);
});

const bundledIcon = join(PATHS.VIEWS_FOLDER, "assets/dev.reminder.app.png");
try {
	installLinuxIcons(bundledIcon);
} catch {
	// ícone de menu/desktop opcional
}

refreshTrayImage();

const settings = getSettings();
setAutostart(settings.autostart);
startScheduler();
startGoogleCalendarBackgroundSync();
if (settings.pinned) {
	showPopover();
}
