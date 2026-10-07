# Maestri — Reminder

Playbook do workspace **Reminder** no Maestri (espelhado do Expede/Gestor).

## Ground

- Branch **`main`** no Ground.
- Maestro coordena: Trama, Norte, Semente, Forja; Malho, Cinzel, Crivo; fichários Backlog → Building → Review → Shipped.

## Time (codinomes)

| Agente   | Função              | Role no workspace |
|----------|---------------------|-------------------|
| Norte    | Gerente de produto  | `Norte`           |
| Trama    | Planejamento        | `R-Trama`         |
| Malho    | Desenvolvimento     | `R-Malho`         |
| Cinzel   | Design UI/UX        | `R-Cinzel`        |
| Crivo    | QA                  | `R-Crivo`         |
| Semente  | Invenções / backlog | `R-Semente`       |
| Forja    | Terminal (dev/test) | `R-Forja`         |

Recrutar **sem** `--preset` (herda Cursor Agent), salvo pedido explícito.

## Ciclo

1. **Semente** → notas com tag **invenção** no Backlog.
2. **Norte** valida escopo; Maestro promove para Building.
3. **Trama** escreve o plano; Maestro autoriza **Malho**.
4. UI tocada → opinião mínima do **Cinzel**.
5. Card vai para **Review**; **Crivo** aprova; depois **Shipped**.

## Stack

- Bun + Electrobun, TypeScript
- `src/bun/` — scheduler, DB SQLite, notificações, RPC
- `src/mainview/` — UI (pt-BR)
- `bun run dev` | `bun test` | `bun run build`

## Andares

Para features grandes, criar andar git-isolado e colocar Malho, Cinzel e Crivo no andar (ver `docs/MAESTRI.md` do Expede).
