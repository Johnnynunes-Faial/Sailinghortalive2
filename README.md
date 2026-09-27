# Sailing Horta Live 2 — v0.10

## Meteorologia rápida no Live
Indicador compacto no topo com temperatura, vento médio em nós, direção e rajada.

A leitura corresponde ao centro da área visível do mapa e usa Open-Meteo.
Atualiza:
- ao abrir o mapa;
- quando deslocas o mapa para outra zona, depois de uma pequena pausa;
- automaticamente a cada 10 minutos.

Movimentos pequenos dentro da mesma zona reutilizam a leitura recente para evitar pedidos desnecessários.

## Rasto dos barcos nas Camadas
O rasto passou a ter o mesmo aspeto das restantes camadas:
- checkbox simples;
- cinzento/desativado sem uma regata em direto selecionada;
- disponível quando selecionas uma regata Live;
- mostra até aos últimos 2 NM;
- atualização a cada 20 segundos.

Mantém todas as funcionalidades da v0.9.3.
