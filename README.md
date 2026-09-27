# Sailing Horta Live 2

Nova versão do Sailing Horta Live.

## Estrutura atual

- `/` — Live público
- `/admin` — administração (protegida por Cloudflare Access)
- `/api/live` — barcos ativos do Traccar
- `/api/events` — lista pública de regatas
- `/admin/api/events` — criação de regatas (protegida pelo Access)

## Cloudflare

Secrets necessários no Worker:

- `TRACCAR_USERNAME`
- `TRACCAR_PASSWORD`

Variável pública definida em `wrangler.jsonc`:

- `TRACCAR_URL=https://api.sailinghortalive.com`

Binding D1:

- `DB` → `sailinghortalive-db`

Cloudflare Access deve proteger:

- `sailinghortalive.com/admin`
- `sailinghortalive.com/admin/*`

## Privacidade

O Live só devolve barcos cuja última posição tenha menos de 10 minutos.
