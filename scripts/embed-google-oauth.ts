/**
 * Gera googleOAuthBundled.ts a partir de REMINDER_GOOGLE_CLIENT_ID / REMINDER_GOOGLE_CLIENT_SECRET.
 * Usado no workflow de release (GitHub Actions secrets).
 */
import { writeFileSync } from "fs";
import { join } from "path";

const clientId = process.env.REMINDER_GOOGLE_CLIENT_ID?.trim() ?? "";
const clientSecret = process.env.REMINDER_GOOGLE_CLIENT_SECRET?.trim() ?? "";

if (!clientId || !clientSecret) {
	console.error(
		"embed-google-oauth: defina REMINDER_GOOGLE_CLIENT_ID e REMINDER_GOOGLE_CLIENT_SECRET",
	);
	process.exit(1);
}

const out = join(import.meta.dir, "../src/bun/googleOAuthBundled.ts");
const contents = `/**
 * Credenciais OAuth do app Reminder (release).
 * Gerado por scripts/embed-google-oauth.ts — não editar manualmente.
 */
export const BUNDLED_GOOGLE_CLIENT_ID = ${JSON.stringify(clientId)};
export const BUNDLED_GOOGLE_CLIENT_SECRET = ${JSON.stringify(clientSecret)};
`;

writeFileSync(out, contents, "utf-8");
console.log("embed-google-oauth: wrote", out);
