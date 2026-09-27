# Sailing Horta Live 2 — v0.9.3

Correção do Replay após introdução da lista de regatas.

Problema:
- na v0.9.2 o mapa só era inicializado no primeiro carregamento da página;
- como nessa altura aparecia apenas a lista de regatas, o elemento do mapa ainda não existia;
- depois de escolher uma regata, o mapa não era criado.

Correção:
- o mapa é agora inicializado quando uma regata é selecionada;
- é destruído ao voltar à lista;
- volta a ser criado corretamente ao escolher outra regata;
- o mapa faz `invalidateSize()` depois de montar;
- o percurso e os barcos são desenhados assim que mapa + dados estão disponíveis.

Mantém todas as melhorias da v0.9.2.
