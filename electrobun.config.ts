import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "Reminder",
		identifier: "dev.reminder.app",
		version: "0.1.0",
	},
	runtime: {
		exitOnLastWindowClosed: false,
	},
	build: {
		mainProcess: "cottontail",
		cottontail: {
			entrypoint: "src/bun/index.ts",
		},
		views: {
			mainview: {
				entrypoint: "src/mainview/index.ts",
			},
		},
		copy: {
			"src/mainview/index.html": "views/mainview/index.html",
			"src/mainview/index.css": "views/mainview/index.css",
			"assets/tray-icon.png": "views/assets/tray-icon.png",
			"assets/icon-128.png": "views/assets/app-icon.png",
			"assets/dev.reminder.app.png": "views/assets/dev.reminder.app.png",
			"assets/themes/default/tray.png": "views/assets/themes/default/tray.png",
			"assets/themes/paradox/tray.png": "views/assets/themes/paradox/tray.png",
			"assets/themes/paradox/app-icon.png":
				"views/assets/themes/paradox/app-icon.png",
			"assets/themes/paradox/notify-alert.mp3":
				"views/assets/themes/paradox/notify-alert.mp3",
			"assets/themes/paradox/reminder-saved.mp3":
				"views/assets/themes/paradox/reminder-saved.mp3",
		},
		mac: { bundleCEF: false },
		linux: { bundleCEF: false, icon: "assets/icon.png" },
		win: { bundleCEF: false },
	},
} satisfies ElectrobunConfig;
