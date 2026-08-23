# Mudanças V23 Free

- Cloudflare Container removido.
- Docker removido.
- Node/Express/Socket.IO do backend removidos.
- `RpgContainer` foi mantido como nome da classe para reutilizar a migração/binding já iniciado no projeto, mas agora é um Durable Object comum.
- Persistência migrada para Durable Object SQLite do Workers Free.
- Sincronização em tempo real migrada para WebSocket nativo.
- `mesa.html` continua usando a mesma interface `on/emit` por uma pequena camada `free-socket.js`, reduzindo o risco de quebrar a UI.
- RealtimeKit preservado como transporte principal de áudio/vídeo multiponto.
- Fallback WebRTC P2P preservado.
- Imagens e áudios grandes são armazenados em blocos SQLite separados para não inflar o estado principal da sala.
- Upload de mapa mantém o arquivo original; não depende mais do `sharp`.
- Aprovação Vampiro V6 adaptada para HTTP/FormSubmit, sem Nodemailer/SMTP obrigatório.
