# Sailing Horta Live 2 — v0.18.0

## Rondagem das bóias

Foi acrescentada indicação de rondagem por evento/percurso.

- Cada bóia pode ficar sem indicação, Bombordo ou Estibordo.
- Bombordo aparece com seta curva vermelha.
- Estibordo aparece com seta curva verde.
- A opção pode ser escolhida ao criar uma nova bóia.
- Pode ser alterada posteriormente em "Marcas do percurso", inclusive no dia da regata.
- A mesma bóia da biblioteca pode ter rondagens diferentes em regatas diferentes.
- Waypoints não têm rondagem.
- A indicação aparece no Editor Admin, Live da regata e Replay.
- Percursos antigos continuam válidos e começam com "Sem indicação".

A coluna `rounding_side` é criada automaticamente na tabela `course_points`;
não é necessário executar SQL manualmente.
