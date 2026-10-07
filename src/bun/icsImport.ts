import {
	filterEventsInImportWindow,
	MAX_ICS_TEXT_LENGTH,
	parseIcs,
} from "./ics";
import { parsedToUpsert } from "./importedEvents";
import type { UpsertImportedInput } from "./importedEvents";

export function prepareIcsImport(text: string, now = new Date()) {
	if (text.length > MAX_ICS_TEXT_LENGTH) {
		return {
			events: [] as UpsertImportedInput[],
			imported: 0,
			skipped: 0,
			error: "Arquivo muito grande (máx. 2 MB).",
		};
	}

	const parsed = parseIcs(text);
	if (parsed.length === 0) {
		return {
			events: [] as UpsertImportedInput[],
			imported: 0,
			skipped: 0,
			error: "Nenhum evento reconhecível no arquivo (ou só recorrências RRULE).",
		};
	}
	const { inWindow, skipped } = filterEventsInImportWindow(parsed, now);
	const events = inWindow.map(parsedToUpsert);
	if (events.length === 0 && skipped === 0) {
		return {
			events: [],
			imported: 0,
			skipped: 0,
			error: "Nenhum evento dentro da janela de 90 dias.",
		};
	}

	return {
		events,
		imported: events.length,
		skipped,
	};
}
