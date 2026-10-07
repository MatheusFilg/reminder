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
	const { inWindow, skipped } = filterEventsInImportWindow(parsed, now);
	const events = inWindow.map(parsedToUpsert);

	return {
		events,
		imported: events.length,
		skipped,
	};
}
