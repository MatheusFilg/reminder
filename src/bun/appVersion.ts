import { Updater } from "electrobun/bun";

/** Versão da instalação (Resources/version.json), não o texto fixo na UI. */
export async function getAppVersionLabel(): Promise<string> {
	try {
		const info = await Updater.getLocalInfo();
		const v = info.version?.trim();
		return v || "dev";
	} catch {
		return "dev";
	}
}
