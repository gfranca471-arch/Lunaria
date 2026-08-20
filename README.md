# Mesa RPG Online — V22.1 Northflank

Versão preparada para **Northflank via Dockerfile**, com foco em estabilidade do chat de voz/vídeo e uso de dois aparelhos pelo mesmo jogador.

## Regra de voz e vídeo com dois aparelhos

Quando computador e celular entram com o mesmo Nome de Jogador na mesma campanha:

- continuam contando como **um único jogador**;
- o primeiro aparelho conectado fica como fonte inicial da chamada;
- o segundo aparelho entra automaticamente em **modo somente recepção** e não toma câmera/microfone sozinho;
- na aba **Sala**, o jogador escolhe qual aparelho será o ativo usando o botão **Usar**;
- somente o aparelho ativo pode publicar câmera, microfone e compartilhamento de tela;
- o aparelho secundário recebe o áudio e o vídeo do aparelho ativo e de todos os demais jogadores;
- ao trocar a fonte, o aparelho anterior encerra imediatamente câmera/microfone/tela e continua apenas recebendo;
- se o aparelho ativo desconectar, um aparelho restante do mesmo jogador assume automaticamente;
- **Música e Som ambiente não são afetados** pela escolha do aparelho de chamada: continuam sendo reproduzidos/sincronizados separadamente em cada navegador.

A restrição é aplicada em duas camadas: o cliente WebRTC não envia tracks no aparelho passivo e o servidor rejeita estado de câmera/microfone/tela vindo de um endpoint que não seja a fonte selecionada.

### Correção V22.1 — publicação de áudio/vídeo

- ao ativar ou trocar o aparelho de voz/vídeo, os tracks locais são recolocados nos `RTCRtpSender`;
- a conexão é renegociada para garantir que o aparelho ativo saia de recepção para envio real;
- os transceivers de áudio e vídeo agora têm referências fixas por conexão, evitando associação com o transceiver errado após reconexões;
- o monitor da malha WebRTC verifica periodicamente se um sender perdeu seu track e corrige automaticamente;
- a regra de fonte única por jogador permanece inalterada.

## Deploy no Northflank

1. Envie esta pasta para um repositório GitHub/GitLab/Bitbucket.
2. No Northflank, crie um **Combined Service** apontando para o repositório.
3. Use **Dockerfile** como método de build, com contexto na raiz e arquivo `/Dockerfile`.
4. Exponha uma porta pública **HTTP 3000**. O Northflank publica HTTP/HTTPS externamente e encaminha para essa porta do contêiner.
5. Configure health check HTTP em **`/health`** na porta 3000.
6. Mantenha **1 réplica** nesta versão. A presença online e o signaling Socket.IO/WebRTC ainda ficam na memória do processo; múltiplas réplicas exigiriam um adapter compartilhado (ex.: Redis) para não separar jogadores da mesma sala.
7. Configure as variáveis de ambiente necessárias.

Variáveis recomendadas:

```text
PORT=3000
HOST=0.0.0.0
PUBLIC_BASE_URL=https://SEU-DOMINIO-OU-SUBDOMINIO-NORTHFLANK
DATABASE_URL=<conexão PostgreSQL>
DATABASE_TLS_ENABLED=<true ou false, conforme o addon>
TURN_URL=turn:SEU-TURN:3478?transport=udp,turns:SEU-TURN:5349?transport=tcp
TURN_USERNAME=<usuário TURN>
TURN_CREDENTIAL=<senha TURN>
```

Para a autorização de campanhas Vampiro V6, quando usar SMTP:

```text
V6_APPROVAL_EMAIL=v.f.lune@gmail.com
SMTP_USER=<conta que enviará o e-mail>
SMTP_PASS=<senha de aplicativo / credencial SMTP>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
```

### Persistência no Northflank

A opção recomendada é definir `DATABASE_URL` com PostgreSQL. Sem banco, o servidor usa `.runtime/rooms.json`; esse arquivo fica no filesystem do contêiner e pode desaparecer quando o serviço for recriado. Como alternativa, é possível montar um volume persistente e apontar, por exemplo:

```text
ROOMS_DATA_FILE=/var/data/mesa-rpg/rooms.json
```

Para voz/vídeo em 4G/5G, CGNAT, Wi-Fi corporativo e NAT restritivo, configure um servidor **TURN**. O Northflank hospeda o servidor HTTP/Socket.IO de signaling; a mídia WebRTC continua peer-to-peer ou passa pelo TURN quando necessário.

---

## Mesa RPG Online — V20.2

Atualização focada em campanhas independentes por sistema, mídia multidispositivo, ficha Vampiro V6 Alpha ampliada e som dos dados.

## Mudanças da V20.2

- **Autorização Vampiro V6 é feita uma única vez na criação da campanha pelo Narrador.** Depois que a campanha recebe aprovação, `v6Authorized=true` fica persistido; narrador e jogadores entram normalmente nos próximos acessos sem novo pedido.
- **Ordem das câmeras é definida pelo Narrador e persistida por jogador.** Os botões ◀/▶ nos cards dos jogadores reorganizam a fileira para todos. A ordem usa a identidade lógica do jogador, não o socket, e permanece salva mesmo depois que a mesa fecha/reabre ou o jogador troca de aparelho.
- A identidade da campanha agora é **Sistema + Nome da Campanha**. O mesmo nome e até a mesma senha podem existir em Lobisomem, Vampiro V5, Vampiro V6, D&D e Changeling sem colisão.
- Narrador **e jogador** escolhem o sistema ao entrar; a senha continua obrigatória.
- Dois aparelhos com o mesmo Nome de Jogador continuam contando como um único jogador. Quando há dois aparelhos, a aba Sala permite escolher qual deles envia **câmera e microfone**. O segundo aparelho entra somente como receptor e nunca toma a mídia automaticamente.
- A saída de áudio continua automática pelo sistema operacional. Seletores de câmera/microfone só aparecem se existirem múltiplas entradas.
- Vampiro V6 Alpha ganhou Atributos, 13 Habilidades, Disciplinas, Lifepaths, Recursos, Vitae, Willpower, Humanity Scale, Beast/Nature, Quickening, geração sugerida e contadores automáticos de pontos para os estágios com orçamento de criação conhecido.
- Rolagens 3D agora têm efeito sonoro sintetizado e sincronizado com a animação local de cada participante.
- A geometria dos dados aprovada na V14+ não foi alterada.
- Lobisomem permanece baseado na 3ª Edição/Revisada, em português, incluindo Fianna.

## Campanhas independentes

Internamente, uma campanha é identificada por `sistema:nome-normalizado`. Assim, por exemplo, `Noite Eterna` em Lobisomem e `Noite Eterna` em Vampiro V6 são duas campanhas diferentes, com senhas, fichas, mapas, tokens e músicas independentes. Senhas nunca são exibidas em listas públicas.

## Vampiro V6

A V6 continua sendo Alpha Playtest. A interface segue o modelo de criação guiada do GhoulApp como referência de experiência, mas não copia seu código ou seus assets. Regras ainda instáveis ficam editáveis para facilitar futuras atualizações do playtest.

# 🎲 Mesa RPG Online — V19

Mesa virtual de RPG com dados 3D, cenário e tokens compartilhados, fichas persistentes, música sincronizada e chamada WebRTC.

## Entrada na campanha

Não existe código de sala para o usuário. Narrador e jogadores informam apenas:

- Nome de Jogador
- Nome da Campanha / Sala
- Senha

Narrador e jogador escolhem o sistema. O Nome da Campanha é normalizado dentro daquele sistema: não é possível duplicar o mesmo nome no mesmo sistema apenas mudando maiúsculas, espaços ou acentos, mas o mesmo nome pode existir em sistemas diferentes. Quem entra precisa informar o sistema, o nome da campanha e a senha correta.

A identidade persistente do personagem é **Sistema + Campanha + Nome de Jogador**. Dois aparelhos conectados com o mesmo Nome de Jogador pertencem ao mesmo jogador, usam a mesma ficha/perfil e ocupam uma única vaga; cada aparelho mantém seu próprio socket WebRTC.

## Sistemas

- 🐺 Lobisomem: O Apocalipse
- 🧛 Vampiro: A Máscara V5
- 🩸 Vampiro: A Máscara V6 — Alpha Playtest
- ⚔️ Dungeons & Dragons 5E (2024 Core + opções legado)
- 🦋 Changeling: O Sonhar — C20 (estrutura-base; será refinada com a ficha de referência)

### Conteúdo ampliado das fichas

- **Lobisomem:** ficha mantida na 3ª Edição/Revisada em português, incluindo Fianna e as tribos clássicas.
- **Vampiro V5:** seleção dos 14 clãs modernos, preservando nomes legados para compatibilidade.
- **Vampiro V6 Alpha:** criador/ficha separado da V5, usando apenas categorias publicamente confirmadas do playtest atual.
- **D&D 5E:** 12 classes do PHB 2024, 10 espécies, 16 antecedentes e sugestões das 48 subclasses do PHB 2024, além de campos livres para legado/suplementos.
- **Changeling C20:** atributos, habilidades, Artes, Reinos, Antecedentes, Glamour, Força de Vontade, Banalidade, Birthrights/Frailties e opções-base de Kith/Gallain. A ficha final será alinhada à referência que ainda será enviada.

## Autorização para criar campanha Vampiro V6

O Narrador **não digita código de autorização**.

Ao tentar criar uma campanha nova com o sistema Vampiro V6, o servidor envia um pedido de aprovação para:

`v.f.lune@gmail.com`

O e-mail contém botões/link para **Autorizar** ou **Recusar**. O Narrador pode permanecer na tela; após a aprovação, a campanha é criada automaticamente. O pedido expira em 30 minutos.

### Variáveis necessárias no Northflank para o e-mail

```text
V6_APPROVAL_EMAIL=v.f.lune@gmail.com
SMTP_USER=<conta que enviará o e-mail>
SMTP_PASS=<senha de aplicativo / credencial SMTP>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
PUBLIC_BASE_URL=https://SEU-DOMINIO-OU-SUBDOMINIO-NORTHFLANK
```

Para Gmail, `SMTP_PASS` deve ser uma senha de aplicativo/credencial SMTP válida da conta usada em `SMTP_USER`.

## Câmera, microfone e vários aparelhos

A chamada é uma malha WebRTC: cada aparelho possui conexão direta com os demais endpoints da sala. Para cada par existe somente um iniciador de negociação, reduzindo colisões de ofertas.

Quando o mesmo jogador usa computador + celular:

- continua sendo exibido como um único jogador;
- o aparelho selecionado na aba Sala é a única fonte de câmera/microfone/tela daquele jogador;
- o outro aparelho fica somente recebendo a chamada;
- o aparelho passivo recebe inclusive o áudio/vídeo do aparelho ativo do próprio jogador;
- computador ou celular podem ser escolhidos como fonte a qualquer momento;
- música e som ambiente continuam independentes da seleção de voz/vídeo.

A saída de áudio (fone/Bluetooth/alto-falante) é escolhida automaticamente pelo navegador/sistema operacional. A interface só mostra seleção de **câmera** ou **microfone** quando mais de uma entrada daquele tipo estiver disponível.

Para redes móveis, CGNAT, redes corporativas ou NAT restritivo, configure TURN:

```text
TURN_URL=<url do servidor TURN>
TURN_USERNAME=<usuário>
TURN_CREDENTIAL=<senha>
```

Sem TURN, STUN/WebRTC não consegue garantir conectividade entre todas as combinações de redes.

## Sincronização da mesa

São sincronizados para todos na mesma campanha:

- cenário;
- tokens, posição, tamanho, borda e marca ✕ de morto;
- rolagens 3D e resultados;
- histórico de testes (mais recente no topo);
- música, play/pause, posição e loop;
- presença e estado de mídia dos jogadores.

Zoom/pan do cenário transforma a mesma camada dos tokens, por isso eles acompanham proporcionalmente o mapa.

## Persistência

Sala, sistema, senha, fichas, perfis, cenário, tokens, músicas e histórico podem ser persistidos em PostgreSQL quando `DATABASE_URL` está configurada. Sem PostgreSQL, há fallback privado em `.runtime/rooms.json`. Ele fica separado dos arquivos públicos do site, mas ainda depende de armazenamento persistente da hospedagem para sobreviver a recriações do serviço.

## Regras especiais dos dados

- D20: mostra os resultados sem classificar sucesso/falha.
- D100: sucesso quando o resultado é **igual ou inferior** ao alvo.
- Vampiro V5: Fome substitui dados normais; não aumenta o pool.
- Vampiro V6 Alpha: usa D10 comum e evita inventar resolução ainda não publicada integralmente.

## Instalação

```bash
npm install
npm start
```

No Northflank, use o `Dockerfile` da raiz, porta HTTP `3000` e health check `/health`. Os arquivos `index.html`, `mesa.html`, `server.js`, `package.json` e `Dockerfile` devem permanecer no mesmo diretório raiz do serviço.


## V19.1 — autorização V6 e Lobisomem 3ª Edição

- A autorização de campanha Vampiro V6 não depende mais obrigatoriamente de `SMTP_USER`/`SMTP_PASS`.
- Quando SMTP não existe, o servidor usa FormSubmit como relay para `V6_APPROVAL_EMAIL`. No primeiro uso, confirme a ativação recebida nesse e-mail e use o botão **Reenviar pedido** na tela de espera.
- SMTP continua suportado opcionalmente se as variáveis forem definidas manualmente.
- A ficha de Lobisomem foi revertida para a linha clássica da 3ª Edição/Revisada: as tribos clássicas da 3ª Edição/Revisada em português, incluindo Fianna e Portadores da Luz Interior, e campos Natureza, Comportamento e Seita no lugar dos campos de Patrono/Favor/Ban de W5.


## V20.1
- Vampiro V6: prioridades de Atributos 7/5/3 por Físicos, Sociais e Mentais.
- Dois aparelhos do mesmo jogador: áudio/vídeo do aparelho remoto selecionado agora podem ser reproduzidos no computador.
- Seleção explícita entre os aparelhos do mesmo jogador na aba Sala.

## V20.3
- O Narrador define a ordem das câmeras por número, em vez de setas.
- Os jogadores aparecem como `001 Nome`, `002 Nome`, `003 Nome` etc.
- Alterar uma posição insere o jogador naquele número e desloca os demais, sem duplicar posições.
- A ordem é persistida na própria campanha por `ownerKey`, mantendo a posição mesmo após desconectar, fechar o jogo ou trocar de aparelho.



## V20.4
- Grade quadrada opcional sobre o mapa, configurada somente pelo Narrador.
- O Narrador pode mostrar/ocultar a grade, ajustar o tamanho dos quadrados e alinhar a grade horizontal/verticalmente.
- Configuração da grade sincronizada para toda a sala e persistida junto da campanha.
- Opção **Encaixar token** faz a movimentação parar no centro dos quadrados.
- A grade pertence à mesma camada transformada do cenário, portanto acompanha zoom e deslocamento do mapa.

## V21 — mapa em camadas, tokens HD, D&D e desempenho

### Sincronização do mapa
O servidor é a fonte de verdade para cenário, grade, tokens, objetos, névoa, luzes, efeitos, templates e ciclo dia/noite. Ao entrar/reconectar, o cliente solicita um `scene-sync` completo. Alterações são enviadas a todos os membros da campanha.

### Ferramentas do Narrador
A pequena barra lateral direita reúne:
- Névoa de guerra: ocultar/revelar tudo, pincéis, retângulo, círculo, polígono e borracha.
- Luzes: fogueira, vela, tocha, lâmpada, magia e luz lunar; raio, intensidade, cor e oscilação.
- Iluminação dinâmica leve: linha de visão baseada nos tokens, com paredes desenhadas pelo Narrador.
- Efeitos: chuva, tempestade, neve, névoa, fogo, fumaça, folhas, magia, escuridão, sol, relâmpagos, sangue, água, ondas, teias, gás, insetos e poeira.
- Objetos/imagens sobre o mapa, independentes do cenário.
- Camadas individuais para mapa, grade, tokens, objetos, luz, efeitos, fog, templates e visão.
- Ciclo dia/noite, incluindo ambiente diurno/noturno opcional escolhido da biblioteca de áudio.
- Templates D&D: círculo, cone, linha e quadrado, com Bola de Fogo pronta e destaque de tokens dentro da área.

### Tokens
A imagem original é mantida; zoom e posição do rosto são aplicados somente na renderização. Também é possível adicionar moldura PNG/WebP transparente. A marca de personagem morto é recortada exatamente pelo círculo do token.

### D&D
Subclasses passam a usar seleção no padrão visual da ficha e nomes em português. A aba Magias possui Espaços de Magia e uma lista por nível (truques a 9º), com estado Conhecida/Preparada e remoção durante a campanha.

### Áudio e desempenho
A biblioteca de música e efeitos é persistida na sala, mas arquivos de áudio não são mais reenviados integralmente no `room-joined`: os clientes recebem metadados e carregam apenas a faixa necessária quando ela toca. Isso reduz o tráfego que compete com WebRTC. Efeitos visuais usam um único canvas com orçamento de partículas adaptativo e limite de atualização; câmeras usam bitrate/framerate adaptativos conforme o número de jogadores.

### Dados persistentes separados do código
O servidor usa `DATABASE_URL` como armazenamento principal quando disponível e mantém um espelho JSON separado em `ROOMS_DATA_FILE`. Sem a variável, o fallback local é `.runtime/rooms.json`, uma pasta privada ignorada pelo servidor estático e separada dos arquivos públicos do site.

Para Northflank, o recomendado é manter `DATABASE_URL` configurado. Se desejar que **o arquivo JSON em si** sobreviva a deploys/reinícios, anexe um volume persistente em `/var/data` e configure:

```
ROOMS_DATA_FILE=/var/data/mesa-rpg/rooms.json
```

Sem PostgreSQL ou volume persistente, o arquivo local fica sujeito ao ciclo de vida do contêiner. O arquivo `render.yaml` foi removido desta versão para evitar configuração conflitante com o Northflank.

### Vampiro V6
A autorização continua vinculada à campanha e ocorre apenas na primeira criação. Campanhas já aprovadas entram normalmente. A Narradora `Nanda Salima` cria uma nova campanha V6 diretamente, sem solicitar o e-mail de autorização.


## V21.2 — câmeras maiores e alça superior
- Cards de vídeo ampliados no desktop e no celular, mantendo a faixa horizontal para economizar área do mapa.
- Alça de arrasto visível acima da faixa de câmeras. Ao começar a arrastar, a faixa entra automaticamente no modo flutuante.
- O botão ⇱ continua disponível para fixar/flutuar manualmente.
- Posição flutuante continua salva localmente no aparelho.

## V21.3 — câmeras individuais verticais

- Cada janela de vídeo agora usa proporção vertical (150×210 px no desktop; 132×180 px no celular).
- A ordem 001/002/003 continua definindo a posição inicial dos jogadores.
- Cada card possui sua própria alça `•••` acima da janela; arrastar move somente aquele jogador.
- O card arrastado passa a flutuar livremente sobre a tela sem deslocar os demais da ordem original.
- A posição livre é preservada durante a sessão mesmo quando o layout de vídeo é re-renderizado.
- Duplo clique na alça devolve somente aquele card à posição inicial.
- O antigo arrasto da faixa inteira de câmeras foi desativado.


## V21.4 — câmeras 15% menores

- Redução de aproximadamente 15% em cada janela individual de vídeo, preservando a proporção vertical.
- Desktop: 128×179 px.
- Celular: 112×153 px.
- Mantidos: ordem 001/002/003, alça individual `•••`, arrasto livre e duplo clique para voltar à posição inicial.

## V21.5
- Câmeras individuais 30% menores, ainda verticais e arrastáveis.
- Narrador pode ocultar/mostrar o número de cada câmera sem perder a ordem salva.
- Cada jogador escolhe a cor do próprio nome na tela de entrada; chat e identificação da câmera usam a cor escolhida.
- Narrador pode editar/mover/remover qualquer token; jogadores editam os próprios tokens.
- Token usa recorte circular real e fundo transparente; enquadramento mantém zoom e deslocamento internos, e o X de morto fica dentro do círculo.
- Chuva, tempestade, relâmpagos, fogo e névoa foram refeitos com composição, glow, bancos atmosféricos e intensidade ampliada, mantendo orçamento adaptativo para proteger a videochamada.
- Névoa desfoca somente a imagem do mapa, sem desfocar os tokens.
- A face correspondente ao resultado lógico continua sendo orientada para cima; os dados permanecem 3,5 s após o resultado.


## V21.6 — orientação da câmera e WebRTC adaptativo
- Prévia local da câmera frontal espelhada apenas neste aparelho; vídeos remotos permanecem na orientação real.
- Captura e bitrate adaptados ao número de participantes e às condições reais de RTT/perda observadas via getStats().
- Menos renegociações agressivas durante estados WebRTC `disconnected` transitórios.
- Voz preservada em 72 kbps e vídeo com `maintain-framerate` para reduzir atraso percebido.
- TURN continua opcional via `TURN_URL`, `TURN_USERNAME` e `TURN_CREDENTIAL`; é recomendado para redes móveis/NAT restritivo.


## V21.7 — imagens e reroll V5

- Cenário pode ser enviado diretamente do computador ou por link. O arquivo é enviado por HTTP, convertido no servidor para WebP e só a URL final é sincronizada pelo Socket.IO, reduzindo tráfego pesado no canal usado por sala, dados e sinalização WebRTC.
- Conversão de formatos é feita com `sharp`; esta versão requer Node.js 20.9+ e inclui `sharp` nas dependências.
- Vampiro V5 ganhou **Re-rolar falhas (sem Fome)**: preserva sucessos e todos os dados de Fome e rola novamente apenas D10 comuns que ficaram abaixo da dificuldade da rolagem anterior. O resultado novo é decidido no servidor e enviado igual para todos.
- A seleção de cor do nome foi removida da tela de entrada. Perfis antigos mantêm a cor salva; novos perfis recebem a cor automaticamente pelo servidor.
- Efeitos visuais continuam limitados a ~30 FPS e câmera/áudio permanecem no WebRTC; o upload de cenário não trafega mais como base64 pelo socket, evitando competir com eventos em tempo real.


## V21.8 — interface, efeitos e sincronização
- Editor do token fixo no canto superior esquerdo e visível somente com token editável selecionado.
- Áreas dos efeitos do mapa voltaram ao recorte retangular.
- Teias redesenhadas como teias de aranha; água com correnteza tipo rio; relâmpagos como tempestade mágica com múltiplas descargas.
- V5: cada jogada original permite somente uma re-rolagem de falhas comuns; sucessos e dados de Fome continuam preservados.
- Controle de volume dos efeitos restaurado abaixo das faixas. Música e efeitos iniciam em 40%.
- Ciclo dia/noite preserva 00:00 corretamente no cliente, servidor e após recarregar a sala.
- WebRTC de câmera/áudio e sincronização compartilhada permanecem no mesmo fluxo da V21.7.


## V21.9 — área útil do mapa e espaço livre da mesa

- O cenário pode ser reduzido de **100% até 50%**, permanecendo centralizado; o reset volta para 100%.
- As faixas escuras que aparecem ao redor de um mapa menor continuam sendo **área útil da mesa**, e não uma região morta.
- A ferramenta **Objetos / Imagens** usa a área inteira da mesa: imagens temporárias podem ser colocadas e arrastadas tanto sobre o mapa quanto nas áreas escuras disponíveis.
- Tokens, grade, efeitos, iluminação, templates, visão dinâmica e Fog of War continuam vinculados à transformação do mapa, mantendo o alinhamento quando o cenário aumenta ou diminui.
- O arrasto do cenário só é ativado acima de 100%; em 100% ou menos ele permanece centralizado. Quando ampliado, o pan é limitado às bordas válidas.
- Ao carregar um novo cenário, zoom e posição são reiniciados para 100%/centro. Redimensionar a janela recalcula os limites.
- Mantidas as correções e recursos da V21.8, sem alteração na sinalização WebRTC/câmera/áudio.
