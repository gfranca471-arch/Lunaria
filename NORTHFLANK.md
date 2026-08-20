# Deploy no Northflank — Mesa RPG Online V22.1

## 1. Serviço

Crie um **Combined Service** ligado ao repositório do projeto.

- Build type: **Dockerfile**
- Dockerfile: `/Dockerfile`
- Build context: raiz do repositório
- Réplicas: **1**

> Esta versão mantém presença online, sockets e signaling WebRTC na memória do processo. Não aumente para múltiplas réplicas sem adicionar um adapter compartilhado para Socket.IO e coordenação de presença.

## 2. Rede

Exponha:

- Tipo: **HTTP**
- Porta interna: **3000**
- Health check: **GET /health**

Não é necessária uma segunda porta para Socket.IO: o signaling usa a mesma origem HTTP/HTTPS do site e faz upgrade para WebSocket.

## 3. Variáveis de ambiente

Mínimo:

```text
PORT=3000
HOST=0.0.0.0
PUBLIC_BASE_URL=https://SEU-DOMINIO-OU-SUBDOMINIO-NORTHFLANK
```

Persistência recomendada:

```text
DATABASE_URL=<URL de conexão do PostgreSQL>
DATABASE_TLS_ENABLED=<true ou false, conforme o addon>
```

TURN recomendado para chamada em redes móveis/restritas:

```text
TURN_URL=turn:SEU-TURN:3478?transport=udp,turns:SEU-TURN:5349?transport=tcp
TURN_USERNAME=<usuario>
TURN_CREDENTIAL=<senha>
```

Autorização Vampiro V6 via SMTP, se usada:

```text
V6_APPROVAL_EMAIL=v.f.lune@gmail.com
SMTP_USER=<conta SMTP>
SMTP_PASS=<credencial SMTP>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
```

## 4. Persistência sem PostgreSQL

Sem `DATABASE_URL`, o fallback é JSON. Para persistir em volume:

```text
ROOMS_DATA_FILE=/var/data/mesa-rpg/rooms.json
```

Monte um volume persistente em `/var/data`.

## 5. Regra de dois aparelhos

Para o mesmo Nome de Jogador:

1. O primeiro aparelho conectado é a fonte inicial de voz/vídeo.
2. O segundo entra somente recebendo.
3. A aba **Sala** mostra os aparelhos e permite escolher **Usar**.
4. Somente o escolhido publica câmera, microfone e compartilhamento de tela.
5. O outro recebe o aparelho ativo e todos os demais jogadores.
6. Música e som ambiente continuam independentes dessa seleção.
7. Se a fonte ativa cair, outro endpoint do mesmo jogador assume automaticamente.

## 6. Teste depois do deploy

Abra o site em computador e celular com o mesmo Nome de Jogador e confira:

- apenas um aparelho pede/usa câmera e microfone inicialmente;
- o segundo mostra modo **somente recepção**;
- o segundo recebe a câmera/voz do primeiro e dos demais jogadores;
- ao clicar **Usar** no segundo, o primeiro para de transmitir e continua recebendo;
- música e som ambiente continuam tocando normalmente nos dois;
- `/health` responde com `ok: true`.
