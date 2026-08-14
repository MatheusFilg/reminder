# Reminder

App de lembretes para Linux: local, bandeja do sistema, sem nuvem.

Interface em português. Os dados ficam num SQLite no seu usuário (`~/.local/share/`).

## Instalar (Linux x64)

1. Baixe **[Reminder-Setup-linux-x64.tar.gz](https://github.com/MatheusFilg/reminder/releases/latest)** na página de releases.
2. Extraia e execute o instalador:

```bash
tar xzf Reminder-Setup-linux-x64.tar.gz
chmod +x installer
./installer
```

O instalador coloca o app em `~/.local/share/dev.reminder.app/` e cria o atalho no menu de aplicativos.

Se o ícone na área de trabalho abrir como texto, clique com o botão direito e escolha **Permitir iniciar**.

No GNOME, a bandeja precisa da extensão AppIndicator. Notificações usam `notify-send`.

## Desenvolvimento

Requer [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

Build de release:

```bash
bun run build
```

O instalador sai em `artifacts/stable-linux-x64-Reminder-Setup.tar.gz`.
