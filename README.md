# Sailing Horta Live 2 — v0.12 PWA

O site passa a poder ser instalado/adicionado ao ecrã principal como uma Progressive Web App (PWA).

Incluído:
- manifest.webmanifest;
- ícones 192x192 e 512x512;
- apple-touch-icon para iPhone/iPad;
- favicon;
- modo standalone, sem a barra normal do browser quando aberto pelo ícone;
- service worker leve;
- APIs Live/Admin nunca são colocadas em cache;
- páginas e assets usam rede primeiro, para que novas versões continuem a aparecer normalmente;
- cache serve apenas como fallback básico se a rede falhar.

Não foi criado modo offline para Live ou Replay, porque esses dados dependem do servidor.
