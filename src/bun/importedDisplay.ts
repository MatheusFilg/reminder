export interface ImportedDisplayTitle {
	/** Título curto para lista e notificação. */
	title: string;
	/** Título original (tooltip, modais). */
	fullTitle: string;
	/** Tags extras (ex.: Feriado). */
	tags: string[];
}

/** Remove prefixo `email@dominio: ` comum em eventos do Google (conta única). */
export function stripLeadingEmailPrefix(title: string): string {
	const trimmed = title.trim();
	const match = trimmed.match(/^[^\s@]+@[^\s@]+\.[^\s@]+:\s*(.+)$/);
	return match ? match[1].trim() : trimmed;
}

/**
 * Normaliza títulos de eventos importados (calendário/ICS).
 * Ex.: "Feriados no Brasil: Nossa Senhora de Aparecida" → tag Feriado + "Nossa Senhora de Aparecida".
 */
export function formatImportedEventTitle(summary: string): ImportedDisplayTitle {
	const fullTitle = summary.trim() || "(Sem título)";
	let title = stripLeadingEmailPrefix(fullTitle);
	const tags: string[] = [];

	if (/feriado/i.test(fullTitle)) {
		tags.push("Feriado");
		const colon = title.indexOf(":");
		if (colon > 0 && colon < 56) {
			title = title.slice(colon + 1).trim();
		}
		title = title
			.replace(/^feriados?\s*(no\s+brasil)?\s*[-–—:]\s*/i, "")
			.replace(/^feriados?\s+/i, "")
			.trim();
	}

	if (!title) title = stripLeadingEmailPrefix(fullTitle) || fullTitle;

	return { title, fullTitle, tags };
}

/** Texto de ajuda que o Google coloca em feriados/datas comemorativas — não mostrar na lista. */
export function shouldHideImportedDescription(
	description: string,
	displayTags: string[],
): boolean {
	const desc = description.trim();
	if (!desc) return false;
	if (/^feriado$/i.test(desc)) return true;
	if (!displayTags.includes("Feriado")) return false;
	if (/^data comemorativa\b/i.test(desc)) return true;
	if (/para ocultar (as )?datas comemorativas/i.test(desc)) return true;
	return false;
}
