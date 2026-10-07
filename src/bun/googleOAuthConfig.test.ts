import { describe, expect, test } from "bun:test";
import { GOOGLE_OAUTH_REDIRECT_URI } from "./googleOAuthConfig";

describe("googleOAuthConfig", () => {
	test("redirect URI includes oauth callback path", () => {
		expect(GOOGLE_OAUTH_REDIRECT_URI).toBe(
			"http://127.0.0.1:5198/oauth/callback",
		);
	});
});
