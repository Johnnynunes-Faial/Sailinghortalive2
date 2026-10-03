# Sailing Horta Live 2 — v0.13

Duas melhorias no mapa e meteorologia.

## Windy acompanha a área do mapa
Ao ativar “Vento (Windy)”, o site lê o centro e o zoom atuais do mapa principal.
O Windy abre nessa mesma zona em vez de abrir sempre no Faial.

Exemplo:
- selecionas uma regata em São Miguel;
- o mapa enquadra São Miguel;
- ativas Windy;
- o Windy abre centrado em São Miguel.

## Mapa marítimo
Todos os mapas Leaflet passam a usar:
- OpenStreetMap como cartografia base;
- OpenSeaMap por cima, com informação náutica/seamarks.

Foi aplicado a:
- Live;
- Replay;
- editor de percurso do Admin.

O OpenSeaMap é uma camada marítima sobre o mapa base, por isso mantemos estradas/costa/terra e acrescentamos a informação náutica.
