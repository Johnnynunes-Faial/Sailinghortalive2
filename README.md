# Sailing Horta Live 2 — v0.12.2

Melhorias:
- imagem Open Graph para partilha do site em Facebook, WhatsApp, LinkedIn e outras plataformas;
- metatags OG/Twitter adicionadas ao `<head>`;
- imagem de partilha guardada em `/social-share.jpg`;
- reforço do `apple-touch-icon` para iOS com tamanho explícito 180x180;
- cache-busting nos ícones da PWA para forçar atualização;
- cache do service worker atualizada.

Nota iOS:
Se já tinhas o site guardado no ecrã principal, o iOS pode manter o ícone antigo em cache.
Remove o atalho/app antigo e volta a adicionar depois do deploy.
