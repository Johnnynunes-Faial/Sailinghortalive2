# Sailing Horta Live 2 — v0.11

## Cache persistente do Replay em D1

Os tracks históricos deixam de ser pedidos ao Traccar sempre que alguém abre um Replay.

Funcionamento:
- na primeira abertura de uma regata, cada barco é procurado na cache D1;
- se ainda não existir, o Worker pede o histórico desse barco ao Traccar;
- o track processado é guardado na tabela `replay_track_cache`;
- nas aberturas seguintes, o track vem diretamente da D1;
- o percurso, bóias e linhas continuam a ser lidos das tabelas normais do evento.

Isto significa que podes continuar a ajustar o percurso de uma regata no Admin sem voltar a descarregar os tracks do Traccar.

A cache é validada pelo intervalo início/fim. Se alterares o horário da regata, o sistema ignora automaticamente o track antigo e volta a recolher o intervalo correto.

Se o Traccar estiver temporariamente indisponível, essa falha não é gravada como um Replay vazio.

A tabela é criada automaticamente pelo Worker; não precisas executar SQL manualmente.
