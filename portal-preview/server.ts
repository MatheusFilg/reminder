import { join } from "path";

const PORT = 5199;
const root = import.meta.dir;
const repo = join(root, "..");

const routes: Record<string, string> = {
	"/": join(root, "index.html"),
	"/index.html": join(root, "index.html"),
	"/preview.js": join(root, "preview.js"),
	"/mainview/index.css": join(repo, "src/mainview/index.css"),
	"/assets/app-icon.png": join(repo, "assets/icon-128.png"),
	"/assets/themes/paradox/app-icon.png": join(
		repo,
		"assets/themes/paradox/app-icon.png",
	),
};

Bun.serve({
	port: PORT,
	hostname: "127.0.0.1",
	async fetch(req) {
		const path = new URL(req.url).pathname;
		const file = routes[path];
		if (!file) return new Response("Not found", { status: 404 });
		return new Response(Bun.file(file));
	},
});

console.log(`Reminder portal preview: http://127.0.0.1:${PORT}`);
