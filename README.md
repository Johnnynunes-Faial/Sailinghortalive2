# Sailing Horta Live 2 — v0.9.1

Duas melhorias:

## 1. Alinhamento do rasto com o barco
O SVG do barco tinha dimensões visuais diferentes do contentor usado pelo Leaflet.
Isso fazia parecer que o rasto terminava alguns pixels ao lado do barco.

Agora:
- o centro visual do barco coincide com a posição GPS;
- aplica-se tanto ao Live como ao Replay;
- o ponto de rotação também coincide com o centro do SVG.

## 2. Rastos históricos no editor de percurso do Admin
No Admin > evento > Percurso existe agora:
- "Mostrar rastos históricos";
- carrega os tracks dessa regata através do histórico do Traccar;
- cada barco aparece com a sua cor;
- podes arrastar as bóias, waypoints e extremos das linhas sobre o rasto;
- depois "Guardar percurso" grava as novas posições.

Isto permite reconstruir/afinar posteriormente o percurso de uma regata usando o track real como referência.
