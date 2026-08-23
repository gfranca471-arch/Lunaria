# Lunaria V23 — Cloudflare Workers Free

Esta versão remove **Cloudflare Containers**, Docker, Express, Node server e Socket.IO do backend.

Arquitetura:

- **Cloudflare Worker**: rotas HTTP e arquivos do site.
- **Durable Object SQLite**: uma instância por campanha para presença, WebSocket, dados, tokens, mapa, fichas, música e sincronização em tempo real.
- **WebSocket nativo**: substitui Socket.IO sem mudar os nomes dos eventos usados por `mesa.html`.
- **Cloudflare RealtimeKit**: chamada de áudio/vídeo multiponto (SFU). O token é criado no servidor e a chave da API não vai para o navegador.
- **WebRTC P2P fallback**: continua disponível se o RealtimeKit não estiver configurado ou falhar.

## O que NÃO existe mais

- `Dockerfile`
- Cloudflare Container
- `server.js` / Express em produção
- PostgreSQL obrigatório
- plano Workers Paid obrigatório

## Deploy

Veja `CLOUDFLARE_FREE_DEPLOY.md`.

## Observação sobre arquivos grandes

No plano gratuito, imagens e áudios compartilhados são guardados em blocos no SQLite do Durable Object. A imagem de mapa não é convertida por `sharp`; JPEG/PNG/WebP etc. são mantidos no formato original.
