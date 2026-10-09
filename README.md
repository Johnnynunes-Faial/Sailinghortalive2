# Sailing Horta Live 2 — v0.16.1

## Remover dispositivo desconhecido

Na lista de dispositivos desconhecidos do Admin existe agora:
- Copiar ID
- Remover da lista

Ao remover um identificador:
- é apagado de unknown-devices.json;
- é apagado de unknown-devices.csv;
- o tracker-server.log não é alterado.

Se o mesmo identificador voltar a transmitir e continuar sem existir no Traccar,
o monitor volta a detetá-lo e adiciona-o novamente.

Requer o Monitor Traccar v2.1.
