export interface ImportedDisplayTitle {
	/** Título curto para lista e notificação. */
	title: string;
	/** Título original (tooltip, modais). */
	fullTitle: string;
	/** Tags extras (ex.: Feriado). */
	tags: string[];
}

/**
 * Normaliza títulos de eventos importados (calendário/ICS).
 * Ex.: "Feriados no Brasil: Nossa Senhora de Aparecida" → tag Feriado + "Nossa Senhora de Aparecida".
 */
export function formatImportedEventTitle(summary: string): ImportedDisplayTitle {
	const fullTitle = summary.trim() || "(Sem título)";
	let title = fullTitle;
	const tags: string[] = [];

	if (/feriado/i.test(fullTitle)) {
		tags.push("Feriado");
		const colon = fullTitle.indexOf(":");
		if (colon > 0 && colon < 56) {
			title = fullTitle.slice(colon + 1).trim();
		}
		title = title
			.replace(/^feriados?\s*(no\s+brasil)?\s*[-–—:]\s*/i, "")
			.replace(/^feriados?\s+/i, "")
			.trim();
	}

	if (!title) title = fullTitle;

	return { title, fullTitle, tags };
}
