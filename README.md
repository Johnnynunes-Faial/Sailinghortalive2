# Sailing Horta Live 2 — v0.15

## Cores globais dos barcos

Foi adicionada uma configuração global de cor por dispositivo Traccar.

No Admin existe agora o cartão:

**Barcos · cores**

Para cada barco:
- pode escolher-se uma cor manual com o seletor;
- pode voltar-se a **Automática** a qualquer momento;
- a escolha fica guardada na D1 pelo `traccar_device_id`.

A cor manual passa a ser usada em:
- Live Geral;
- Live de uma regata;
- rastos;
- Replay;
- rastos históricos no editor de percurso.

Se não existir configuração manual, mantém-se exatamente o algoritmo anterior de cor automática baseado no ID do dispositivo.

## Base de dados

A tabela `boat_settings` é criada automaticamente pelo Worker na primeira utilização.
Não é necessário executar SQL manualmente.
