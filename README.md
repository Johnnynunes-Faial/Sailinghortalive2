# Sailing Horta Live 2 — v0.24.0

## Polling adaptativo do Live

- Vista Geral sem nenhuma regata em direto: `/api/live` a cada 10 segundos.
- Vista Geral com pelo menos uma regata em direto: 2 segundos.
- Regata selecionada: 2 segundos.

Os dispositivos continuam a transmitir normalmente para o Traccar. Esta alteração
reduz apenas a frequência com que o browser consulta o Live quando não há regata em direto.

Mantém as restantes funcionalidades da v0.23.2.
