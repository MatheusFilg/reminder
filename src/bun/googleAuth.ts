import { randomBytes } from "crypto";
import { db } from "./db";
import {
	GOOGLE_CALENDAR_SCOPE,
	GOOGLE_OAUTH_REDIRECT_PORT,
	GOOGLE_OAUTH_REDIRECT_URI,
	loadGoogleOAuthClientConfig,
	type GoogleOAuthClientConfig,
} from "./googleOAuthConfig";

const SETTINGS_KEYS = {
	refreshToken: "google_refresh_token",
	accessToken: "google_access_token",
	expiresAt: "google_token_expires_at",
	email: "google_account_email",
	lastSyncAt: "google_last_sync_at",
} as const;

export interface GoogleAuthStored {
	refreshToken: string;
	accessToken: string;
	expiresAt: number;
	email: string;
	lastSyncAt: string | null;
}

export interface GoogleCalendarStatus {
	configured: boolean;
	connected: boolean;
	email: string | null;
	lastSyncAt: string | null;
}

function readSetting(key: string): string | null {
	const row = db
		.query("SELECT value FROM settings WHERE key = ?")
		.get(key) as { value: string } | undefined;
	return row?.value ?? null;
}

function writeSetting(key: string, value: string) {
	db.query(
		"INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
	).run(key, value);
}

function deleteSetting(key: string) {
	db.query("DELETE FROM settings WHERE key = ?").run(key);
}

export function getGoogleAuthStored(): GoogleAuthStored | null {
	const refreshToken = readSetting(SETTINGS_KEYS.refreshToken);
	if (!refreshToken) return null;
	const accessToken = readSetting(SETTINGS_KEYS.accessToken) ?? "";
	const expiresAt = Number(readSetting(SETTINGS_KEYS.expiresAt) ?? 0);
	const email = readSetting(SETTINGS_KEYS.email) ?? "";
	const lastSyncAt = readSetting(SETTINGS_KEYS.lastSyncAt);
	return {
		refreshToken,
		accessToken,
		expiresAt,
		email,
		lastSyncAt,
	};
}

export function saveGoogleAuthStored(partial: {
	refreshToken: string;
	accessToken: string;
	expiresAt: number;
	email: string;
}) {
	writeSetting(SETTINGS_KEYS.refreshToken, partial.refreshToken);
	writeSetting(SETTINGS_KEYS.accessToken, partial.accessToken);
	writeSetting(SETTINGS_KEYS.expiresAt, String(partial.expiresAt));
	writeSetting(SETTINGS_KEYS.email, partial.email);
}

export function setGoogleLastSyncAt(iso: string) {
	writeSetting(SETTINGS_KEYS.lastSyncAt, iso);
}

export function clearGoogleAuthStored() {
	for (const key of Object.values(SETTINGS_KEYS)) {
		deleteSetting(key);
	}
}

export function getGoogleCalendarStatus(): GoogleCalendarStatus {
	const configured = loadGoogleOAuthClientConfig() !== null;
	const stored = getGoogleAuthStored();
	return {
		configured,
		connected: !!stored?.refreshToken,
		email: stored?.email || null,
		lastSyncAt: stored?.lastSyncAt,
	};
}

interface TokenResponse {
	access_token: string;
	expires_in: number;
	refresh_token?: string;
	token_type: string;
}

async function postToken(
	config: GoogleOAuthClientConfig,
	body: Record<string, string>,
): Promise<TokenResponse> {
	const res = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(body),
	});
	const json = (await res.json()) as TokenResponse & { error?: string };
	if (!res.ok) {
		throw new Error(json.error ?? `Token HTTP ${res.status}`);
	}
	return json;
}

export async function exchangeAuthorizationCode(
	code: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
	const config = loadGoogleOAuthClientConfig();
	if (!config) {
		throw new Error(
			"Credenciais Google não configuradas. Veja docs/google-cloud-oauth.md",
		);
	}
	const token = await postToken(config, {
		code,
		client_id: config.clientId,
		client_secret: config.clientSecret,
		redirect_uri: config.redirectUri,
		grant_type: "authorization_code",
	});
	if (!token.refresh_token) {
		throw new Error("Google não devolveu refresh_token. Tente desconectar e conectar de novo.");
	}
	return {
		accessToken: token.access_token,
		refreshToken: token.refresh_token,
		expiresAt: Date.now() + token.expires_in * 1000 - 60_000,
	};
}

export async function refreshGoogleAccessToken(
	refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number }> {
	const config = loadGoogleOAuthClientConfig();
	if (!config) {
		throw new Error("Credenciais Google não configuradas.");
	}
	const token = await postToken(config, {
		refresh_token: refreshToken,
		client_id: config.clientId,
		client_secret: config.clientSecret,
		grant_type: "refresh_token",
	});
	return {
		accessToken: token.access_token,
		expiresAt: Date.now() + token.expires_in * 1000 - 60_000,
	};
}

export async function fetchGoogleAccountEmail(
	accessToken: string,
): Promise<string> {
	const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (!res.ok) throw new Error(`userinfo HTTP ${res.status}`);
	const json = (await res.json()) as { email?: string };
	if (!json.email) throw new Error("E-mail da conta Google não disponível.");
	return json.email;
}

export async function getValidGoogleAccessToken(): Promise<string | null> {
	const stored = getGoogleAuthStored();
	if (!stored?.refreshToken) return null;
	if (stored.accessToken && stored.expiresAt > Date.now()) {
		return stored.accessToken;
	}
	const refreshed = await refreshGoogleAccessToken(stored.refreshToken);
	writeSetting(SETTINGS_KEYS.accessToken, refreshed.accessToken);
	writeSetting(SETTINGS_KEYS.expiresAt, String(refreshed.expiresAt));
	return refreshed.accessToken;
}

function buildAuthUrl(config: GoogleOAuthClientConfig, state: string): string {
	const params = new URLSearchParams({
		client_id: config.clientId,
		redirect_uri: config.redirectUri,
		response_type: "code",
		scope: `${GOOGLE_CALENDAR_SCOPE} email profile openid`,
		access_type: "offline",
		prompt: "consent",
		state,
	});
	return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function runGoogleOAuthConnect(
	openBrowser: (url: string) => void,
): Promise<{ email: string }> {
	const config = loadGoogleOAuthClientConfig();
	if (!config) {
		throw new Error(
			"Configure OAuth antes: docs/google-cloud-oauth.md (.secrets ou variáveis de ambiente).",
		);
	}

	const state = randomBytes(16).toString("hex");
	const authUrl = buildAuthUrl(config, state);

	const code = await new Promise<string>((resolve, reject) => {
		const server = Bun.serve({
			port: GOOGLE_OAUTH_REDIRECT_PORT,
			hostname: "127.0.0.1",
			fetch(req) {
				const url = new URL(req.url);
				if (url.pathname !== "/oauth/callback") {
					return new Response("Not found", { status: 404 });
				}
				const err = url.searchParams.get("error");
				if (err) {
					server.stop();
					reject(new Error(err));
					return new Response("Erro de autorização. Feche esta aba.", {
						status: 400,
					});
				}
				const gotState = url.searchParams.get("state");
				const gotCode = url.searchParams.get("code");
				if (gotState !== state || !gotCode) {
					server.stop();
					reject(new Error("Resposta OAuth inválida."));
					return new Response("Resposta inválida.", { status: 400 });
				}
				server.stop();
				resolve(gotCode);
				return new Response(
					"<html><body><p>Conta conectada. Volte ao Reminder.</p></body></html>",
					{ headers: { "Content-Type": "text/html; charset=utf-8" } },
				);
			},
		});

		openBrowser(authUrl);

		setTimeout(() => {
			server.stop();
			reject(new Error("Tempo esgotado ao conectar Google (3 min)."));
		}, 180_000);
	});

	const tokens = await exchangeAuthorizationCode(code);
	const email = await fetchGoogleAccountEmail(tokens.accessToken);
	saveGoogleAuthStored({ ...tokens, email });
	return { email };
}
