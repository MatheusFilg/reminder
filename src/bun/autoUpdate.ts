import { Updater } from "electrobun/bun";

/** Baixa atualização no startup; não reinicia na hora (evita “abrir e o app reabrir”). */
export async function maybeAutoUpdateOnStartup() {
	try {
		const local = await Updater.getLocalInfo();
		if (!local.channel || local.channel === "dev") return;
		if (!local.baseUrl?.trim()) return;

		const check = await Updater.checkForUpdate();
		if (!check.updateAvailable) return;

		await Updater.downloadUpdate();
	} catch (error) {
		console.warn("[Reminder] Auto-update:", error);
	}
}
