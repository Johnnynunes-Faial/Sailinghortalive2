# Sailing Horta Live 2 — v0.4.1

Alteração de coordenadas:
- Entrada no formato usado no Boating / navegação:
  - Latitude: 38º33.457'N
  - Longitude: 028º37.123'W
- Também continua a aceitar coordenadas decimais por compatibilidade.
- A biblioteca de bóias passa a mostrar as coordenadas em graus + minutos decimais.
- A lista de marcas do percurso também mostra o mesmo formato.
- Internamente, as coordenadas continuam guardadas em decimal no D1/Leaflet, evitando alterações à base de dados.
