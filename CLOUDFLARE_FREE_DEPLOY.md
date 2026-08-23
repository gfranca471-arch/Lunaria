# Implantar Lunaria no Cloudflare Workers Free

## 1. Substitua os arquivos do repositório GitHub

Envie o conteúdo desta pasta para a raiz do repositório da Lunaria.

Remova do repositório antigo, se ainda existirem:

- `Dockerfile`
- `.dockerignore`
- `server.js`
- `render.yaml`
- a pasta `data/`

A raiz nova deve conter principalmente:

- `package.json`
- `wrangler.jsonc`
- `src/worker.mjs`
- `public/index.html`
- `public/mesa.html`
- `public/free-socket.js`

## 2. Configuração do Build no Cloudflare

No Worker `lunaria`:

**Configurações → Construir**

Comando de implantação:

```text
npx wrangler deploy
```

Não use Docker e não use upload manual de arquivos.

O token automático do Workers Builds pode ser usado; esta versão não solicita `Containers: Edit`.

## 3. Primeiro deploy

Faça um commit no GitHub.

No registro correto desta versão NÃO deve aparecer:

```text
Building image lunaria-rpgcontainer
```

Deve aparecer o upload do Worker e dos assets, além da migração/binding do Durable Object.

## 4. RealtimeKit — áudio e vídeo de todos para todos

A mesa abre mesmo sem RealtimeKit, usando o fallback P2P. Para ativar a chamada multiponto, adicione no Cloudflare como **segredos/variáveis do Worker**:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_REALTIMEKIT_APP_ID
CLOUDFLARE_REALTIMEKIT_API_TOKEN
```

Opcional:

```text
CLOUDFLARE_REALTIMEKIT_PRESET
CLOUDFLARE_REALTIMEKIT_HOST_PRESET
CLOUDFLARE_REALTIMEKIT_PLAYER_PRESET
```

Se os presets ficarem vazios, o backend tenta localizar automaticamente um preset `group-call`.

Nunca coloque o `CLOUDFLARE_REALTIMEKIT_API_TOKEN` no GitHub.

## 5. URL pública e autorização V6

Depois que o Worker estiver publicado, configure:

```text
PUBLIC_BASE_URL=https://SEU-ENDERECO.workers.dev
V6_APPROVAL_EMAIL=SEU_EMAIL
```

O fluxo V6 usa FormSubmit via HTTP nesta versão gratuita; SMTP/Nodemailer não é necessário.

## 6. Teste da videochamada

Teste inicialmente com três navegadores/aparelhos na mesma campanha:

1. Narrador entra no PC.
2. Jogador A entra em outro aparelho.
3. Jogador B entra em outro aparelho.
4. Confirme que os três cards aparecem.
5. Ligue microfone/câmera nos três.
6. Confirme que cada aparelho recebe os outros dois simultaneamente.
7. Depois teste PC + celular com o mesmo nome de jogador; continua sendo um único jogador lógico.

## 7. Endpoint de diagnóstico

Abra:

```text
/health
```

O resultado esperado contém:

```json
{
  "ok": true,
  "storage": "durable-object-sqlite-free",
  "plan": "Workers Free compatible"
}
```

Quando as três credenciais do RealtimeKit estiverem presentes, `realtimeKitConfigured` deve aparecer como `true`.
