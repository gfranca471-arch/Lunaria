## Mesa RPG Online — V20.2

Atualização focada em campanhas independentes por sistema, mídia multidispositivo, ficha Vampiro V6 Alpha ampliada e som dos dados.

## Mudanças da V20.2

- **Autorização Vampiro V6 é feita uma única vez na criação da campanha pelo Narrador.** Depois que a campanha recebe aprovação, `v6Authorized=true` fica persistido; narrador e jogadores entram normalmente nos próximos acessos sem novo pedido.
- **Ordem das câmeras é definida pelo Narrador e persistida por jogador.** Os botões ◀/▶ nos cards dos jogadores reorganizam a fileira para todos. A ordem usa a identidade lógica do jogador, não o socket, e permanece salva mesmo depois que a mesa fecha/reabre ou o jogador troca de aparelho.
- A identidade da campanha agora é **Sistema + Nome da Campanha**. O mesmo nome e até a mesma senha podem existir em Lobisomem, Vampiro V5, Vampiro V6, D&D e Changeling sem colisão.
- Narrador **e jogador** escolhem o sistema ao entrar; a senha continua obrigatória.
- Dois aparelhos com o mesmo Nome de Jogador continuam contando como um único jogador. Quando há dois aparelhos, a aba Sala permite escolher qual deles envia **câmera e microfone**. O aparelho mais recente com mídia ativa é escolhido automaticamente, ideal para computador + celular.
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

### Variáveis necessárias no Render para o e-mail

```text
V6_APPROVAL_EMAIL=v.f.lune@gmail.com
SMTP_USER=<conta que enviará o e-mail>
SMTP_PASS=<senha de aplicativo / credencial SMTP>
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
PUBLIC_BASE_URL=https://SEU-SERVICO.onrender.com
```

Para Gmail, `SMTP_PASS` deve ser uma senha de aplicativo/credencial SMTP válida da conta usada em `SMTP_USER`.

## Câmera, microfone e vários aparelhos

A chamada é uma malha WebRTC: cada aparelho possui conexão direta com os demais endpoints da sala. Para cada par existe somente um iniciador de negociação, reduzindo colisões de ofertas.

Quando o mesmo jogador usa computador + celular:

- continua sendo exibido como um único jogador;
- o aparelho mais recente com câmera ativa passa a ser a câmera preferida daquele jogador;
- o aparelho mais recente com microfone ativo passa a ser o microfone preferido ouvido pelos **outros jogadores**;
- o próprio jogador não reproduz o próprio microfone para evitar eco/feedback;
- o computador pode permanecer como controle da mesa enquanto o celular fornece câmera/microfone.

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

No Render:

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check: `/health`

Os arquivos `index.html`, `mesa.html`, `server.js` e `package.json` precisam estar no mesmo diretório raiz do serviço.


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

Para Render, o recomendado é manter `DATABASE_URL` configurado. Se desejar que **o arquivo JSON em si** sobreviva a deploys/reinícios, anexe um Persistent Disk em `/var/data` e configure:

```
ROOMS_DATA_FILE=/var/data/mesa-rpg/rooms.json
```

O projeto não força um Persistent Disk em `render.yaml`, porque esse recurso exige um serviço Render pago. Sem Postgres ou Persistent Disk, qualquer arquivo local do Render é efêmero.

### Vampiro V6
A autorização continua vinculada à campanha e ocorre apenas na primeira criação. Campanhas já aprovadas entram normalmente. A Narradora `Nanda Salima` cria uma nova campanha V6 diretamente, sem solicitar o e-mail de autorização.


## V21.1 — câmeras, chat, dados e clima
- Câmeras um pouco maiores, mantendo a faixa superior compacta. O botão `⠿` fica sempre visível: segure e arraste para soltar/mover a faixa; `↩` fixa novamente no topo.
- Dados 3D permanecem na tela por 3,5 segundos após o resultado, metade dos 7 segundos anteriores.
- Cada jogador recebe uma cor de chat aleatória na primeira entrada; a cor fica persistida no perfil daquela campanha.
- Chuva ganhou mais gotas, maior contraste e camada atmosférica. Tempestade escurece a área, adiciona chuva forte e relâmpagos/clarões. Névoa cria véu mais denso e desfoque real do mapa proporcional à intensidade.
- Orçamento de partículas continua adaptativo para preservar a videochamada, com limite menor em celular/salas maiores.
