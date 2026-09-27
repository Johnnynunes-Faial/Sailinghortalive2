# Sailing Horta Live 2 — v0.8.3

Correção definitiva do clique nos barcos durante o Replay em Play.

A causa era o ícone HTML do barco ser recriado continuamente para atualizar o rumo.
Mesmo mantendo o marcador Leaflet, o elemento visual era substituído várias vezes por segundo,
o que fazia perder o clique/toque durante a reprodução.

Nesta versão:
- o marcador e o respetivo elemento HTML permanecem estáveis;
- a posição continua a atualizar normalmente;
- o rumo é atualizado diretamente no desenho do barco, sem recriar o ícone;
- o ícone só é recriado quando ligas/desligas os nomes;
- clicar/tocar nos barcos durante Play deve funcionar normalmente;
- podes fechar o painel e selecionar outro barco sem fazer Pause.
