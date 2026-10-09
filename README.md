# Sailing Horta Live 2 — v0.16

## Dispositivos desconhecidos — monitor local

Esta versão usa o monitor local instalado no PC do Traccar.

Não usa WebSocket do Traccar.
Não precisa de `web.showUnknownDevices=true`.
Não faz polling contínuo.

No fundo do Admin existe:
**Monitor Traccar → Dispositivos desconhecidos**

A lista só é consultada quando o administrador carrega em:
**Atualizar lista**

Fluxo:
tracker-server.log
→ monitor local
→ unknown-devices.json
→ endpoint local protegido
→ Cloudflare Tunnel
→ Worker
→ Admin

## Configuração necessária

1. Instalar/atualizar o pacote `Traccar-Unknown-Devices-Monitor-v2.zip`.
2. No Cloudflare Tunnel já existente, criar hostname público:
   `monitor.sailinghortalive.com`
   Serviço:
   `http://localhost:8765`
3. Copiar:
   `C:\ProgramData\TraccarUnknownMonitor\monitor-key.txt`
4. No Worker `sailinghortalive2`, criar Secret:
   `UNKNOWN_MONITOR_KEY`
   com essa chave.
5. Fazer deploy desta versão.

`UNKNOWN_MONITOR_URL` já está configurado no `wrangler.jsonc`.

## Segurança

O endpoint local exige a chave no header `X-Monitor-Key`.
A chave não fica no GitHub.
O navegador nunca recebe a chave.
A consulta passa pelo Worker e a rota pública do site continua em `/admin/api/*`, protegida pelo Cloudflare Access.
