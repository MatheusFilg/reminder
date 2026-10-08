import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Utils } from "electrobun/bun";
import {
	BUNDLED_GOOGLE_CLIENT_ID,
	BUNDLED_GOOGLE_CLIENT_SECRET,
} from "./googleOAuthBundled";

export const GOOGLE_OAUTH_REDIRECT_PORT = 5198;
export const GOOGLE_OAUTH_REDIRECT_URI = `http://127.0.0.1:${GOOGLE_OAUTH_REDIRECT_PORT}/oauth/callback`;
export const GOOGLE_CALENDAR_SCOPE =
	"https://www.googleapis.com/auth/calendar.readonly";

export interface GoogleOAuthClientConfig {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
}

function fromEnv(): GoogleOAuthClientConfig | null {
	const clientId = process.env.REMINDER_GOOGLE_CLIENT_ID?.trim();
	const clientSecret = process.env.REMINDER_GOOGLE_CLIENT_SECRET?.trim();
	if (!clientId || !clientSecret) return null;
	return {
		clientId,
		clientSecret,
		redirectUri: GOOGLE_OAUTH_REDIRECT_URI,
	};
}

function fromJsonFile(path: string): GoogleOAuthClientConfig | null {
	if (!existsSync(path)) return null;
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8")) as {
			installed?: { client_id?: string; client_secret?: string };
			web?: { client_id?: string; client_secret?: string };
		};
		const block = raw.installed ?? raw.web;
		const clientId = block?.client_id?.trim();
		const clientSecret = block?.client_secret?.trim();
		if (!clientId || !clientSecret) return null;
		return {
			clientId,
			clientSecret,
			redirectUri: GOOGLE_OAUTH_REDIRECT_URI,
		};
	} catch {
		return null;
	}
}

function fromBundled(): GoogleOAuthClientConfig | null {
	const clientId = BUNDLED_GOOGLE_CLIENT_ID.trim();
	const clientSecret = BUNDLED_GOOGLE_CLIENT_SECRET.trim();
	if (!clientId || !clientSecret) return null;
	return {
		clientId,
		clientSecret,
		redirectUri: GOOGLE_OAUTH_REDIRECT_URI,
	};
}

/** Dev: env ou .secrets. Release: credenciais embutidas no build (mantenedor). */
export function loadGoogleOAuthClientConfig(): GoogleOAuthClientConfig | null {
	return (
		fromEnv() ??
		fromJsonFile(join(process.cwd(), ".secrets", "google-oauth-client.json")) ??
		fromJsonFile(join(Utils.paths.userData, "google-oauth-client.json")) ??
		fromJsonFile(join(homedir(), ".config", "reminder", "google-oauth-client.json")) ??
		fromBundled()
	);
}

export function isGoogleOAuthConfigured(): boolean {
	return loadGoogleOAuthClientConfig() !== null;
}