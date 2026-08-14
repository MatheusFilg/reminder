import { BrowserWindow, PATHS, Screen, Tray, Utils } from "electrobun/bun";
import { getSettings, saveSettings } from "./db";
import { setAutostart } from "./autostart";
import { createReminderRPC } from "./rpc";
import { notifyAllDayRemindersOnOpen, startScheduler } from "./scheduler";
import { applyLinuxRoundedCorners } from "./roundX11";
import { installLinuxIcons } from "./icons";
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

function getPopoverPosition() {
	const display = Screen.getPrimaryDisplay();
	const bounds = display.bounds;
	const work = display.workArea ?? bounds;
	const panelOffset = work.y > bounds.y ? work.y : bounds.y + 36;
	const x = bounds.x + bounds.width - POPOVER_WIDTH - ANCHOR_RIGHT;
	const y = panelOffset + ANCHOR_TOP;
	return { x, y };
}

function positionPopover() {
	if (!popoverWindow) return;
	const { x, y } = getPopoverPosition();
	popoverWindow.setPosition(x, y);
}

function roundPopover() {
	applyLinuxRoundedCorners(POPOVER_WIDTH, POPOVER_HEIGHT, CORNER_RADIUS);
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

const execPath = process.argv[1] ?? "reminder";
const initialPos = getPopoverPosition();

popoverWindow = new BrowserWindow({
	title: "Reminder",
	url: "views://mainview/index.html",
	rpc: createReminderRPC(
		() => popoverWindow?.webview,
		execPath,
		hidePopover,
		setPinned,
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
setAutostart(settings.autostart, execPath);
startScheduler();
if (settings.pinned) {
	showPopover();
}
