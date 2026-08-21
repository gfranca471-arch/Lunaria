# Alterações V22 — Cloudflare / Videochamada

## Videochamada

- Cloudflare RealtimeKit Core SDK carregado no navegador.
- Uma reunião RealtimeKit é criada/reutilizada por campanha.
- Token individual de participante é criado somente no backend.
- API Token do RealtimeKit nunca é enviado ao cliente.
- Participantes remotos são mapeados ao `socket.id` para preservar a UI existente.
- Áudio, vídeo e compartilhamento de tela dos participantes remotos são explicitamente assinados para a sala de até 8 jogadores.
- Limite ativo configurado acima do limite lógico da mesa para manter todos os participantes consumidos.
- Câmera, microfone, troca de dispositivo e compartilhamento de tela passam pelo RealtimeKit quando disponível.
- O mesmo jogador em PC + celular mantém a lógica de uma única identidade e fonte de mídia selecionável.
- WebRTC P2P anterior foi preservado como fallback de compatibilidade.

## Backend

- Integração REST com Cloudflare RealtimeKit para criar reunião e participante.
- Persistência do `realtimeKitMeetingId` junto à sala.
- Limpeza best-effort do participante RealtimeKit ao desconectar.
- `/health` informa `videoProvider` e `realtimeKitConfigured`.

## Cloudflare / GitHub

- `Dockerfile` para o servidor Node existente.
- `src/worker.mjs` roteando HTTP/WebSocket para o Container.
- `wrangler.jsonc` com Container singleton `basic`.
- `.dev.vars.example` sem segredos.
- `.dockerignore` e `.gitignore` ajustados.
- Scripts `cf:dev`, `cf:deploy` e `check` no `package.json`.
- Guia completo em `CLOUDFLARE_DEPLOY.md`.
