# Sailing Horta Live 2 — v0.20.0

## Medição a partir de um barco no Live

Ao clicar num barco no mapa aparece um painel com a opção **Medir distância**.

Depois podes:
- clicar num ponto do mapa; ou
- clicar noutro barco.

O browser calcula localmente:
- distância em milhas náuticas;
- rumo/bearing até ao destino;
- velocidade atual do barco selecionado;
- ETA à velocidade atual, quando a velocidade é >= 0,5 kn.

A linha de medição acompanha a posição quando o destino é outro barco.

Esta funcionalidade não cria novos pedidos ao Worker, Traccar, D1 ou APIs externas.
Usa apenas os dados Live que o site já recebeu e cálculos feitos no browser.

Mantém todas as funcionalidades da v0.19.
