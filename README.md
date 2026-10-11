# Sailing Horta Live 2 — v0.23.0

- "Vento (Windy)" passa a **Previsão de vento**.
- Nova camada **Estações de vento** com METAR oficiais dos aeroportos dos Açores.
- Mostra direção, velocidade, rajada, hora da observação, temperatura e METAR bruto.
- Fonte: AviationWeather.gov.
- Só consulta quando a camada está ligada.
- Refresh após mover/zoom com debounce de 1,5 s.
- Evita repetir a mesma consulta no browser durante 5 min.
- Subpedido externo com cache Cloudflare de 5 min.
- Sem chave nova e sem alterações à base de dados.
