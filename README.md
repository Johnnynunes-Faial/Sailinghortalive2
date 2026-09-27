# Sailing Horta Live 2 — v0.7 Replay básico

Mantém todas as funcionalidades anteriores e acrescenta:

- página pública /replay;
- lista de regatas terminadas;
- carregamento do histórico GPS diretamente do Traccar;
- conversão correta das horas Atlantic/Azores para UTC;
- percurso histórico e linhas de largada/chegada;
- player Play/Pausa;
- velocidades 1x / 5x / 10x / 30x;
- barra temporal;
- interpolação suave da posição e rumo dos barcos;
- até 2000 pontos por barco para manter o Replay leve.

Para uma regata antiga:
1. cria o evento com início e fim;
2. associa os participantes;
3. cria o percurso no Admin, mesmo depois da prova;
4. termina/marca a regata como concluída;
5. abre /replay.

O histórico GPS vem do Traccar para o intervalo do evento.
