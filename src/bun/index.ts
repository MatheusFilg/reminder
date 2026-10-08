import { BrowserWindow, PATHS, Screen, Tray, Utils } from "electrobun/bun";
import { getSettings, saveSettings } from "./db";
import { setAutostart } from "./autostart";
import { createReminderRPC } from "./rpc";
import { notifyAllDayRemindersOnOpen, startScheduler } from "./scheduler";
import { startGoogleCalendarBackgroundSync } from "./googleCalendar";
import { applyLinuxRoundedCorners } from "./roundX11";
import { installLinuxIcons } from "./icons";
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

function refreshTrayImage() {
	if (!tray) return;
	const { themePack } = getSettings();
	const viewsUri = resolveTrayIconViewsUri(themePack);
	const iconPath = resolveTrayIconPath(themePack, viewsAssetsRoot);
	try {
		if (process.platform === "linux" && iconPath) {
			installLinuxIcons(iconPath);
			tray.setImage(iconPath);
		} else {
			tray.setImage(viewsUri);
		}
	} catch {
		tray.setImage("views://assets/dev.reminder.app.png");
	}
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
let trayIconPath = bundledIcon;
try {
	trayIconPath = installLinuxIcons(bundledIcon);
} catch {
	trayIconPath = "views://assets/dev.reminder.app.png";
}

tray = new Tray({
	title: "Reminder",
	image: trayIconPath,
	template: false,
	width: 48,
	height: 48,
});
tray.setImage(trayIconPath);

tray.setMenu(buildTrayMenu());
refreshTrayImage();

tray.on("tray-clicked", (event: { data?: { action?: string } }) => {
	const action = event.data?.action;
	// Clique direito / menu: action preenchida. Clique esquerdo: abre o app.
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

const settings = getSettings();
setAutostart(settings.autostart);
startScheduler();
startGoogleCalendarBackgroundSync();
if (settings.pinned) {
	showPopover();
}
