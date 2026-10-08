import { Updater } from "electrobun/bun";

/** Verifica atualização no canal stable e aplica em background (reinicia o app). */
export async function maybeAutoUpdateOnStartup() {
	try {
		const local = await Updater.getLocalInfo();
		if (!local.channel || local.channel === "dev") return;
		if (!local.baseUrl?.trim()) return;

		const check = await Updater.checkForUpdate();
		if (!check.updateAvailable) return;

		await Updater.downloadUpdate();
		await Updater.applyUpdate();
	} catch (error) {
		console.warn("[Reminder] Auto-update:", error);
	}
}
