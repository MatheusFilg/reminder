const app = document.getElementById("app");

const state = {
	view: "list",
	filter: "active",
	settings: {
		autostart: true,
		pausedGlobally: false,
		missedAlertHours: 24,
		pinned: false,
		theme: "system",
		themePack: "default",
	},
	items: [
		{
			id: 1,
			name: "Reunião de planejamento",
			meta: "Hoje · 15:00",
			desc: "",
			readOnly: false,
			group: "today",
		},
		{
			id: -1,
			name: "Stand-up (calendário)",
			meta: "Amanhã · 10:00",
			desc: "Importado do .ics",
			readOnly: true,
			group: "tomorrow",
		},
	],
};

function resolvedThemeMode(theme) {
	if (theme === "light") return "light";
	if (theme === "dark") return "dark";
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

function applyTheme() {
	const root = document.documentElement;
	const { theme, themePack } = state.settings;
	if (theme === "system") root.removeAttribute("data-theme");
	else root.setAttribute("data-theme", theme);
	root.setAttribute("data-theme-resolved", resolvedThemeMode(theme));
	if (themePack === "default") root.removeAttribute("data-pack");
	else root.setAttribute("data-pack", themePack);
}

function renderList() {
	const groups = { today: "Hoje", tomorrow: "Amanhã" };
	const byGroup = ["today", "tomorrow"]
		.map((g) => ({
			g,
			items: state.items.filter((i) => i.group === g),
		}))
		.filter((x) => x.items.length);

	return `
    <div class="toolbar">
      <input class="search" type="search" placeholder="Buscar..." />
      <div class="tabs">
        <button class="tab ${state.filter === "active" ? "active" : ""}" type="button" data-filter="active">Ativos</button>
        <button class="tab ${state.filter === "completed" ? "active" : ""}" type="button" data-filter="completed">Concluídos</button>
      </div>
    </div>
    <div class="content">
      ${byGroup
				.map(
					(g) => `
        <div class="group-title">${groups[g.g]}</div>
        ${g.items
					.map(
						(item) => `
          <div class="item">
            <div class="item-main">
              <p class="item-name">
                ${item.name}
                ${item.readOnly ? `<span class="badge-imported">Importado</span>` : ""}
              </p>
              <p class="item-meta">${item.meta}</p>
              ${item.desc ? `<p class="item-desc">${item.desc}</p>` : ""}
            </div>
          </div>`,
					)
					.join("")}
      `,
				)
				.join("")}
    </div>`;
}

function renderSettings() {
	const s = state.settings;
	return `
    <div class="settings">
      <div class="setting-card">
        <span class="setting-copy">
          <span class="setting-title">Aparência</span>
          <span class="setting-hint">Claro, escuro ou seguir o sistema</span>
        </span>
        <select id="theme-mode" class="setting-select" aria-label="Tema">
          <option value="system" ${s.theme === "system" ? "selected" : ""}>Sistema</option>
          <option value="light" ${s.theme === "light" ? "selected" : ""}>Claro</option>
          <option value="dark" ${s.theme === "dark" ? "selected" : ""}>Escuro</option>
        </select>
      </div>
      <label class="setting-card" for="theme-paradox">
        <span class="setting-copy">
          <span class="setting-title">Tema violeta</span>
          <span class="setting-hint">Pack Paradox (preview)</span>
        </span>
        <span class="toggle">
          <input type="checkbox" id="theme-paradox" ${s.themePack === "paradox" ? "checked" : ""} />
          <span class="toggle-ui" aria-hidden="true"></span>
        </span>
      </label>
      <p class="setting-about">Portal preview · Reminder v0.1.0</p>
    </div>`;
}

function render() {
	const paused = state.settings.pausedGlobally;
	app.innerHTML = `
    <header class="header">
      <div class="header-left">
        ${state.view === "settings" ? `<button class="icon-btn" id="back-btn" type="button" title="Voltar">←</button>` : ""}
        <div class="header-brand">
          <img class="header-logo" src="/assets/app-icon.png" alt="" width="36" height="36" />
          <div class="header-title">
            <h1>Reminder</h1>
            <span class="header-status">${paused ? "Notificações pausadas" : "Notificações ativas"}</span>
          </div>
        </div>
      </div>
      <div class="header-actions">
        <button class="icon-btn ${state.view === "settings" ? "on" : ""}" id="settings-btn" type="button" title="Configurações">⚙</button>
      </div>
    </header>
    ${state.view === "settings" ? renderSettings() : renderList()}
    ${state.view === "list" ? `<footer class="footer"><span>${state.items.length} lembrete(s)</span></footer>` : ""}
  `;

	document.getElementById("settings-btn")?.addEventListener("click", () => {
		state.view = "settings";
		render();
	});
	document.getElementById("back-btn")?.addEventListener("click", () => {
		state.view = "list";
		render();
	});
	document.getElementById("theme-mode")?.addEventListener("change", (e) => {
		state.settings.theme = e.target.value;
		applyTheme();
	});
	document.getElementById("theme-paradox")?.addEventListener("change", (e) => {
		state.settings.themePack = e.target.checked ? "paradox" : "default";
		applyTheme();
	});
	document.querySelectorAll("[data-filter]").forEach((btn) => {
		btn.addEventListener("click", () => {
			state.filter = btn.getAttribute("data-filter");
			render();
		});
	});
}

applyTheme();
render();
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
	if (state.settings.theme === "system") applyTheme();
});
