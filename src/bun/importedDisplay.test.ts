import { describe, expect, test } from "bun:test";
import { formatImportedEventTitle } from "./importedDisplay";

describe("formatImportedEventTitle", () => {
	test("feriado brasileiro com prefixo de agenda", () => {
		const r = formatImportedEventTitle(
			"Feriados no Brasil: Nossa Senhora de Aparecida",
		);
		expect(r.tags).toEqual(["Feriado"]);
		expect(r.title).toBe("Nossa Senhora de Aparecida");
		expect(r.fullTitle).toContain("Feriados no Brasil");
	});

	test("título curto sem feriado", () => {
		const r = formatImportedEventTitle("Reunião de equipe");
		expect(r.tags).toEqual([]);
		expect(r.title).toBe("Reunião de equipe");
	});

	test("feriado sem dois pontos", () => {
		const r = formatImportedEventTitle("Feriado Municipal");
		expect(r.tags).toEqual(["Feriado"]);
		expect(r.title).toBe("Municipal");
	});
});
