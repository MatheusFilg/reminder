import type { Database } from "bun:sqlite";

export const IMPORTED_IGNORE_DDL = `
  CREATE TABLE IF NOT EXISTS imported_ignore_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title_norm TEXT NOT NULL UNIQUE,
    sample_title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

export interface ImportedIgnoreRule {
	id: number;
	titleNorm: string;
	sampleTitle: string;
	createdAt: string;
}

export function migrateImportedIgnore(database: Database) {
	database.exec(IMPORTED_IGNORE_DDL);
}

/** Título sem prefixo de agenda e sem acentos — base para comparar. */
export function normalizeImportedTitle(title: string): string {
	let t = title.trim();
	const colon = t.indexOf(":");
	if (colon > 0 && colon < 48) {
		t = t.slice(colon + 1).trim();
	}
	return t
		.toLowerCase()
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replace(/\s+/g, " ")
		.trim();
}

function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	const row = new Array<number>(b.length + 1);
	for (let j = 0; j <= b.length; j++) row[j] = j;
	for (let i = 1; i <= a.length; i++) {
		let prev = i - 1;
		row[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const tmp = row[j];
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
			prev = tmp;
		}
	}
	return row[b.length]!;
}

/** Mesmo título ou variação curta (ex.: reuniões semanais com mesmo nome). */
export function importedTitlesSimilar(aNorm: string, bNorm: string): boolean {
	if (!aNorm || !bNorm) return false;
	if (aNorm === bNorm) return true;
	const minLen = Math.min(aNorm.length, bNorm.length);
	const maxLen = Math.max(aNorm.length, bNorm.length);
	if (minLen >= 4) {
		if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) return true;
	}
	if (maxLen >= 5) {
		const dist = levenshtein(aNorm, bNorm);
		if (dist / maxLen <= 0.18) return true;
	}
	return false;
}

export function listImportedIgnoreRules(database: Database): ImportedIgnoreRule[] {
	const rows = database
		.query(
			`SELECT id, title_norm, sample_title, created_at
       FROM imported_ignore_rules ORDER BY created_at DESC`,
		)
		.all() as {
		id: number;
		title_norm: string;
		sample_title: string;
		created_at: string;
	}[];
	return rows.map((r) => ({
		id: r.id,
		titleNorm: r.title_norm,
		sampleTitle: r.sample_title,
		createdAt: r.created_at,
	}));
}

function loadIgnoreNorms(database: Database): string[] {
	return listImportedIgnoreRules(database).map((r) => r.titleNorm);
}

export function isImportedTitleIgnored(
	summary: string,
	ignoreNorms: string[],
): boolean {
	const norm = normalizeImportedTitle(summary);
	if (!norm) return false;
	return ignoreNorms.some((anchor) => importedTitlesSimilar(anchor, norm));
}

export function addImportedIgnoreRule(
	database: Database,
	sampleTitle: string,
): ImportedIgnoreRule {
	const titleNorm = normalizeImportedTitle(sampleTitle);
	database
		.query(
			`INSERT INTO imported_ignore_rules (title_norm, sample_title)
       VALUES (?, ?)
       ON CONFLICT(title_norm) DO UPDATE SET sample_title = excluded.sample_title`,
		)
		.run(titleNorm, sampleTitle.trim());
	const row = database
		.query(
			`SELECT id, title_norm, sample_title, created_at
       FROM imported_ignore_rules WHERE title_norm = ?`,
		)
		.get(titleNorm) as {
		id: number;
		title_norm: string;
		sample_title: string;
		created_at: string;
	};
	return {
		id: row.id,
		titleNorm: row.title_norm,
		sampleTitle: row.sample_title,
		createdAt: row.created_at,
	};
}

export function removeImportedIgnoreRule(database: Database, ruleId: number) {
	database.query("DELETE FROM imported_ignore_rules WHERE id = ?").run(ruleId);
}

export function deleteImportedEventsWithSimilarTitle(
	database: Database,
	anchorTitle: string,
): number {
	const anchorNorm = normalizeImportedTitle(anchorTitle);
	const rows = database
		.query("SELECT id, summary FROM imported_events")
		.all() as { id: number; summary: string }[];
	let removed = 0;
	for (const row of rows) {
		if (!importedTitlesSimilar(anchorNorm, normalizeImportedTitle(row.summary))) {
			continue;
		}
		database.query("DELETE FROM imported_events WHERE id = ?").run(row.id);
		removed++;
	}
	return removed;
}

export type DismissImportedMode = "hide" | "remove";

export function dismissImportedSimilar(
	database: Database,
	anchorTitle: string,
	mode: DismissImportedMode,
): { removed: number; ruleAdded: boolean } {
	const removed = deleteImportedEventsWithSimilarTitle(database, anchorTitle);
	let ruleAdded = false;
	if (mode === "hide") {
		addImportedIgnoreRule(database, anchorTitle);
		ruleAdded = true;
	}
	return { removed, ruleAdded };
}

export function filterIgnoredImportedSummaries<T extends { summary: string }>(
	rows: T[],
	database: Database,
): T[] {
	const norms = loadIgnoreNorms(database);
	if (norms.length === 0) return rows;
	return rows.filter((r) => !isImportedTitleIgnored(r.summary, norms));
}
