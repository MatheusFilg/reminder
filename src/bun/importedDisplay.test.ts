import { describe, expect, test } from "bun:test";
import {
	formatImportedEventTitle,
	shouldHideImportedDescription,
} from "./importedDisplay";

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

	test("remove prefixo de e-mail do Google", () => {
		const r = formatImportedEventTitle(
			"matheus.almeida@mv.com.br: CONSULTA ORTOPEDIA",
		);
		expect(r.title).toBe("CONSULTA ORTOPEDIA");
		expect(r.fullTitle).toContain("@mv.com.br");
		expect(r.tags).toEqual([]);
	});
});

describe("shouldHideImportedDescription", () => {
	test("texto padrão Google em feriado", () => {
		expect(
			shouldHideImportedDescription(
				"Data comemorativa Para ocultar as datas comemorativas, acesse…",
				["Feriado"],
			),
		).toBe(true);
	});

	test("consulta real não esconde", () => {
		expect(
			shouldHideImportedDescription("Sala 3, levar exames", []),
		).toBe(false);
	});
});
