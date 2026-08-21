# Mesa RPG Online V22 — GitHub + Cloudflare

Esta versão foi preparada para migrar a hospedagem sem reescrever o restante da mesa.

## Arquitetura desta versão

- **Cloudflare Worker + Container:** executa o servidor Node/Express/Socket.IO já usado pelo projeto.
- **Uma instância do Container:** evita que uma mesma sala Socket.IO seja dividida entre processos nesta etapa da migração.
- **Cloudflare RealtimeKit:** transporta áudio, câmera e compartilhamento de tela da chamada multiponto.
- **Interface existente:** as câmeras continuam aparecendo nos cards da própria mesa; não foi substituída por uma tela de conferência externa.
- **Fallback WebRTC P2P:** se o RealtimeKit não estiver configurado ou falhar ao iniciar, a mesa ainda tenta usar a chamada antiga.
- **PostgreSQL externo:** recomendado/necessário para persistência real das campanhas. O armazenamento local do Container não deve ser usado como banco permanente.

## O que mudou na videochamada

Antes, cada navegador criava uma conexão WebRTC para cada outro navegador da sala (malha P2P). Agora, quando o RealtimeKit está configurado, cada aparelho entra na reunião multiponto da campanha e a mídia é distribuída pela infraestrutura WebRTC da Cloudflare.

O servidor cria/reutiliza **uma reunião por campanha** e cria um participante RealtimeKit para cada endpoint conectado. A chave da API nunca é enviada ao navegador; o navegador recebe somente o token temporário do participante.

A lógica de múltiplos aparelhos foi preservada: PC e celular podem pertencer ao mesmo jogador. A mesa continua escolhendo qual endpoint é a fonte ativa de câmera/microfone, evitando duplicar o jogador na interface.

---

# 1. Criar o RealtimeKit na Cloudflare

1. Entre no painel da Cloudflare.
2. Abra **Realtime > RealtimeKit**.
3. Crie um **App** para produção.
4. Confirme que existe um preset de **Group Call** que permita aos participantes:
   - enviar áudio;
   - enviar vídeo;
   - receber áudio/vídeo dos demais;
   - compartilhar tela, se desejado.
5. Copie o **App ID**.
6. Copie o **Account ID** da conta Cloudflare.
7. Crie um **API Token** com permissão `Realtime` ou `Realtime Admin`.

> O nome exato do preset pode ser informado em `CLOUDFLARE_REALTIMEKIT_PRESET`. Se a variável ficar vazia, o servidor tenta localizar automaticamente um preset de Group Call.

## Variáveis obrigatórias para o vídeo

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_REALTIMEKIT_APP_ID
CLOUDFLARE_REALTIMEKIT_API_TOKEN
```

Recomendado:

```text
CLOUDFLARE_REALTIMEKIT_PRESET
```

Opcional, se quiser permissões diferentes entre narrador e jogador:

```text
CLOUDFLARE_REALTIMEKIT_HOST_PRESET
CLOUDFLARE_REALTIMEKIT_PLAYER_PRESET
```

---

# 2. Persistência das campanhas

Use uma URL PostgreSQL persistente em:

```text
DATABASE_URL
```

Se você já possui um PostgreSQL externo funcionando, pode manter a mesma `DATABASE_URL` durante a migração.

Sem PostgreSQL, o servidor ainda inicia usando JSON local, porém os dados gravados no filesystem do Container podem não sobreviver a reinicializações/mudanças da instância. Para produção, não dependa desse fallback.

---

# 3. Colocar este projeto no GitHub

Envie **todo o conteúdo desta pasta** para o repositório. Os arquivos principais para Cloudflare são:

```text
Dockerfile
wrangler.jsonc
src/worker.mjs
.dev.vars.example
server.js
mesa.html
package.json
```

Não envie segredos. O `.gitignore` já bloqueia `.dev.vars` e `.env`.

---

# 4. Conectar o GitHub à Cloudflare

Fluxo recomendado:

1. Cloudflare > **Workers & Pages**.
2. **Create application**.
3. Escolha **Import a repository**.
4. Conecte sua conta GitHub e selecione o repositório da Mesa RPG.
5. O nome do Worker deve ser **`mesa-rpg-online`**, para coincidir com `wrangler.jsonc`.
6. Para produção, use como comando de deploy:

```bash
npx wrangler deploy
```

7. Salve e faça o primeiro deploy.

Este projeto usa Container; a implantação de produção precisa executar `wrangler deploy` para construir/publicar a imagem do Container.

---

# 5. Cadastrar variáveis e segredos no Worker

Depois de criar o Worker, adicione nas configurações de **Variables and Secrets**:

Obrigatórios:

```text
CLOUDFLARE_ACCOUNT_ID = seu Account ID
CLOUDFLARE_REALTIMEKIT_APP_ID = seu App ID
CLOUDFLARE_REALTIMEKIT_API_TOKEN = seu token Realtime (SECRET)
DATABASE_URL = sua conexão PostgreSQL (SECRET)
```

Recomendado:

```text
CLOUDFLARE_REALTIMEKIT_PRESET = nome exato do preset Group Call
PUBLIC_BASE_URL = https://seu-dominio.com
```

Se usa o fluxo de autorização/e-mail do V6, mantenha também:

```text
V6_APPROVAL_EMAIL
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASS
```

Os valores `TURN_URL`, `TURN_USERNAME` e `TURN_CREDENTIAL` só são necessários para o **fallback P2P**; o caminho principal da chamada passa a ser RealtimeKit.

---

# 6. Teste obrigatório da videochamada

Faça o primeiro teste com pelo menos **3 endpoints**, porque duas telas não validam bem uma chamada multiponto.

### Teste A — três jogadores

- Jogador 1: PC / Chrome
- Jogador 2: outro PC ou notebook
- Jogador 3: celular em 4G/5G ou outro Wi-Fi

Confirme em todos:

- [ ] vê a própria câmera corretamente;
- [ ] vê os outros dois jogadores;
- [ ] ouve os outros dois jogadores;
- [ ] os outros dois o ouvem;
- [ ] ligar/desligar câmera atualiza para todos;
- [ ] mutar/desmutar microfone atualiza para todos;
- [ ] sair e entrar novamente recupera a chamada;
- [ ] trocar Wi-Fi/4G e reconectar não duplica o card do jogador.

### Teste B — mesmo jogador em PC + celular

1. Entre com o mesmo jogador nos dois aparelhos.
2. Escolha o celular como fonte de câmera/microfone.
3. Confirme que o PC recebe a câmera/áudio do celular como a mídia daquele jogador.
4. Troque a fonte para o PC.
5. Confirme que não surgem dois jogadores lógicos na mesa.

### Teste C — sala cheia

Teste progressivamente com 4, 6 e 8 jogadores. Verifique principalmente áudio simultâneo, reconexão e estabilidade em celulares.

---

# 7. Como saber se está usando RealtimeKit

Abra:

```text
/health
```

Com RealtimeKit configurado corretamente, deve aparecer:

```json
{
  "videoProvider": "cloudflare-realtimekit",
  "realtimeKitConfigured": true
}
```

Ao entrar na mesa, o chat do sistema também informa:

```text
☁️ Chamada multiponto conectada pelo Cloudflare RealtimeKit.
```

Se aparecer `webrtc-p2p-fallback`, confira o App ID, Account ID, token e nome do preset.

---

# 8. Desenvolvimento local

Copie:

```text
.dev.vars.example
```

para:

```text
.dev.vars
```

Preencha os valores e rode:

```bash
npm install
npm run cf:dev
```

Para testar somente o servidor Node fora do Worker/Container:

```bash
npm install
npm run dev
```

Para validar sintaxe do servidor:

```bash
npm run check
```

---

# 9. Observação importante sobre escala

`wrangler.jsonc` está com `max_instances: 1` propositalmente. O servidor atual guarda presença Socket.IO e parte do estado transitório das salas em memória. Aumentar para várias instâncias agora poderia colocar jogadores da mesma campanha em processos diferentes.

Depois que a versão Cloudflare + RealtimeKit estiver validada, uma segunda fase pode mover estado de sala para Durable Objects/D1/R2 e permitir escalar o servidor horizontalmente sem alterar a videochamada.

---

# 10. Custo da infraestrutura Cloudflare nesta arquitetura

Na data desta versão (21/08/2026):

- **Cloudflare Containers** exige **Workers Paid**, cujo plano base começa em **US$ 5/mês** e inclui uma franquia mensal de uso de Containers.
- **RealtimeKit** está em **Beta e sem cobrança durante a Beta**. A Cloudflare informa que, após GA, o preço planejado para participante de áudio/vídeo é de **US$ 0,002 por minuto de participante**.

Confira o painel e a documentação de preços da Cloudflare antes de colocar a aplicação em produção, pois valores e condições podem mudar.
