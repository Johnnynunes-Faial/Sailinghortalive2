# Sailing Horta Live 2 — v0.3.1

Correção das linhas de largada e chegada.

- Linha de largada = 2 extremos independentes.
- Linha de chegada = 2 extremos independentes.
- Cada extremo pode ser arrastado no mapa.
- O trajeto visual liga o ponto médio da largada às marcas e depois ao ponto médio da chegada.
- As linhas são guardadas por evento numa tabela própria `course_lines`.
- Bóias e waypoints continuam em `course_points`.
- Eliminar um evento elimina também as suas linhas.
- A tabela `course_lines` é criada automaticamente pelo Worker na primeira utilização.
