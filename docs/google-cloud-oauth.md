# Google Cloud — credenciais para Google Agenda (read-only)

Passo **manual** para você fazer antes da implementação OAuth no Reminder. Não commite `client_secret` nem JSON de credenciais.

## 1. Projeto no Google Cloud

1. Abra [Google Cloud Console](https://console.cloud.google.com/).
2. Crie um projeto (ex.: `reminder-local`) ou use um existente.
3. Anote o **Project ID**.

## 2. Ativar a API

1. **APIs & Services** → **Library**.
2. Busque **Google Calendar API**.
3. **Enable**.

## 3. Tela de consentimento OAuth

1. **APIs & Services** → **OAuth consent screen**.
2. Tipo: **External** (ou Internal se for só Workspace da sua org).
3. Preencha nome do app (ex. `Reminder`), e-mail de suporte, desenvolvedor.
4. **Scopes** → Add → filtre `calendar` → adicione:
   - `https://www.googleapis.com/auth/calendar.readonly`  
     (só leitura; suficiente para eventos read-only no Reminder)
5. **Test users**: enquanto o app estiver em *Testing*, adicione o(s) Gmail que vão conectar.
6. Salve.

## 4. Credenciais OAuth (desktop / app local)

O Reminder no Linux é app desktop (Electrobun), não site hospedado.

1. **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**.
2. Application type: **Web application** (recomendado para o Reminder).
   - **Authorized redirect URI:** `http://127.0.0.1:5198/oauth/callback` (porta fixa no código).
   - Alternativa: **Desktop app** se preferir; o redirect usado continua sendo o URI acima — adicione-o no console se o Google pedir.
3. Nome: ex. `Reminder Linux dev`.
4. **Create** → baixe o JSON ou copie **Client ID** e **Client secret**.

## 5. Onde guardar no repo (local, ignorado pelo git)

Crie na raiz do projeto (já ignorado em `.gitignore` se usar o nome abaixo):

```bash
mkdir -p .secrets
# Cole o JSON baixado como:
# .secrets/google-oauth-client.json
```

Formato esperado (exemplo):

```json
{
  "installed": {
    "client_id": "XXXX.apps.googleusercontent.com",
    "client_secret": "XXXX",
    "redirect_uris": ["http://127.0.0.1"]
  }
}
```

Ou variáveis de ambiente ao rodar o dev (alternativa):

```bash
export REMINDER_GOOGLE_CLIENT_ID="....apps.googleusercontent.com"
export REMINDER_GOOGLE_CLIENT_SECRET="...."
```

O código da feature deve ler **um** desses caminhos (a Trama/Malho documentam no card em Building).

## 6. Checklist antes de pedir implementação

- [ ] Calendar API ativada
- [ ] Scope `calendar.readonly` na tela de consentimento
- [ ] OAuth client criado (Desktop ou Web + redirect localhost)
- [ ] Seu Gmail em **Test users** (modo Testing)
- [ ] JSON ou env em `.secrets/` — **nunca** `git add` disso

## 7. Quando for para produção (depois)

- Publicar app na tela de consentimento (verificação Google se escopos sensíveis).
- Client ID de release separado do dev.
- Política de privacidade (app lê calendário; dados ficam só na máquina do usuário).

## Referência no produto

Card: `card-google-calendar-readonly` (fichário Backlog).  
Modelo de dados: mesmo de `.ics` → `imported_events` com `source: google`.
