# Sailing Horta Live 2 — v0.22.0

## Webcams Windy

Nova camada **Camadas → Webcams (Windy)**.

Comportamento:
- só faz pedidos quando a camada está ligada;
- ao ligar, procura webcams dentro da área visível do mapa;
- mostra no máximo as 5 mais próximas do centro do mapa;
- ao mover/alterar zoom, espera 1,5 s antes de atualizar;
- evita repetir o mesmo pedido durante pelo menos 15 s;
- ao clicar no ícone 📷 mostra nome, local, imagem disponível e ligação para a webcam;
- inclui a cortesia Windy exigida pelos termos da API.

A chave Windy NÃO fica no JavaScript público. O browser chama `/api/webcams`
e o Worker usa o secret `WINDY_WEBCAMS_KEY`.

Não há alterações à base de dados.
