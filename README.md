# Sailing Horta Live 2 — v0.8.2

Correção do clique nos barcos durante o Replay em Play.

Problema:
- os marcadores eram destruídos e recriados continuamente durante a reprodução;
- enquanto o Replay estava em Play, isso fazia com que um clique pudesse perder-se antes de selecionar o barco.

Correção:
- os marcadores dos barcos passam a ser persistentes;
- durante o Play apenas atualizamos posição, rumo e ícone;
- clicar/tocar num barco funciona com o Replay em movimento;
- podes fechar o painel e selecionar imediatamente outro barco sem fazer Pause;
- os rastos continuam a atualizar normalmente numa camada separada.

Mantém todas as funcionalidades da v0.8.1.
