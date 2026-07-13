# Lineup Labs Bot

Bot de Discord modular, pensado para crescer por pastas de modulo sem alterar a raiz do projeto.

## Requisitos

- Node.js 18+
- Um bot criado no Discord Developer Portal

## Como usar

1. Instale as dependencias:

```bash
npm install
```

2. Para producao simples ou uso geral, copie `.env.example` para `.env` e preencha:

```env
DISCORD_TOKEN=seu_token
```

3. Para teste local no Windows, copie `.env.local.example` para `.env.local` e preencha o token local.

4. Configure os canais de log em `modules/member-logs/config.json`.

5. Inicie o bot:

```bash
npm start
```

Ou, no Windows, rode:

```bat
start.bat
```

## Deploy na Square Cloud

O projeto ja inclui o arquivo `squarecloud.app` na raiz, pronto para deploy.

### Via GitHub

1. Importe o repositorio no painel da Square Cloud.
2. Configure a variavel de ambiente `DISCORD_TOKEN` no app.
3. Edite `modules/member-logs/config.json` com o ID do canal de logs.
4. Ative o `SERVER MEMBERS INTENT` no Discord Developer Portal.

### Observacoes

- `.env.local` tem prioridade sobre `.env` ao iniciar localmente.
- Nao envie `.env` ou `.env.local` para producao.
- A Square Cloud instala as dependencias a partir do `package.json`.
- O comando de inicializacao usado no deploy e `npm run start`.
- Antes de empacotar para a Square Cloud, rode `npm run deploy:prepare` para recriar `.\.squarecloud-deploy-temp` a partir da raiz atual do projeto.

## Estrutura

- `src/index.js`: bootstrap do bot
- `src/loaders/moduleLoader.js`: carregador automatico de modulos
- `modules/<nome-do-modulo>/index.js`: logica do modulo
- `modules/<nome-do-modulo>/config.json`: configuracao isolada do modulo

## Modulo inicial

O modulo `member-logs` envia logs de:

- entrada em `joinChannelId`
- saida em `leaveChannelId`

Ele usa componentes v2 do Discord para montar um card visual no canal, em vez de um embed simples.

## Modulo de tickets

O modulo `tickets` cria um painel de atendimento e abre canais privados por usuario.

Configure em `modules/tickets/config.json`:

- `panelChannelId`: canal onde o painel sera enviado
- `categoryId`: categoria onde os tickets serao criados
- `staffRoleId`: cargo da equipe que pode visualizar e responder
- `ticketLogChannelId`: canal para logs de acoes do ticket, como saida de membros
- `transcriptBaseUrl`: URL publica do site que exibira o transcript
- `transcriptTable`: tabela do Supabase usada para salvar os transcripts
- `ticketTypes`: lista de tipos de ticket exibidos no select

Fluxo:

- o bot publica ou atualiza automaticamente um painel em components v2
- o usuario escolhe o tipo de ticket em um select, como `parceria`, `suporte` ou `orcamento`
- cada usuario pode ter um ticket aberto por vez
- o ticket nasce como canal privado dentro da categoria configurada
- o ticket possui `Menu Staff`, que abre um painel efemero para adicionar e remover membros
- o ticket possui `Sair do Ticket` para o criador ou membros adicionados sairem do canal
- quando alguem sai do ticket, o bot registra isso no canal configurado em `ticketLogChannelId`
- ao fechar, o bot salva o transcript no Supabase e envia o link com senha
- o botao `Fechar Ticket` apaga o canal apos 5 segundos

Para ativar transcripts:

- crie a tabela com `supabase/migrations/20260712_create_ticket_transcripts.sql`
- defina no bot `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TICKET_TRANSCRIPT_BASE_URL` e opcionalmente `TICKET_TRANSCRIPT_TABLE`
- defina no site `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e opcionalmente `TICKET_TRANSCRIPT_TABLE`

## Modulo de cargos por reacao

O modulo `reaction-roles` cria regras de cargo por reacao com comportamento toggle:

- reagiu: ganha o cargo
- removeu a reacao: perde o cargo

Configure em `modules/reaction-roles/config.json`:

- `guildId`: servidor onde o slash command sera registrado rapidamente

Comandos:

- `/cargo reacao mensagem:<link-ou-channelId/messageId> emoji:<emoji> cargo:<cargo>`
- `/cargo remover-reacao mensagem:<link-ou-channelId/messageId> emoji:<emoji>`

Observacao:

- a confirmacao do comando pode ser efemera
- adicionar ou remover cargo por evento de reacao nao suporta mensagem efemera, porque reacoes nao sao interactions

## Modulo de pagamentos

O modulo `payments` cria um link de pagamento do Mercado Pago usando Checkout Pro.

Configure em `modules/payments/config.json`:

- `guildId`: servidor onde o slash command sera registrado rapidamente
- `currencyId`: normalmente `BRL`
- `defaultTitle`: titulo padrao da cobranca
- `pixButtonLabel`: texto do botao Pix
- `cardButtonLabel`: texto do botao de cartao
- `successUrl`, `pendingUrl`, `failureUrl`: URLs de retorno opcionais

Variavel de ambiente necessaria:

- `MERCADO_PAGO_ACCESS_TOKEN`
- `PIX_KEY`

Comando:

- `/pagamento valor:<numero> descricao:<texto-opcional>`

Fluxo atual:

- o bot publica uma mensagem com duas opcoes: `Pix` e `Cartao (Mercado Pago)`
- `Pix`: gera QR Code e Pix copia e cola a partir da chave Pix local
- `Cartao`: cria uma preference no Mercado Pago e entrega o link de checkout

Observacoes:

- o Pix desta versao usa chave Pix local e gera um QR estatico com valor definido
- `PIX_RECEIVER_NAME` e opcional; se nao informar, o bot usa `LINEUP LABS`
- `PIX_RECEIVER_CITY` e opcional; se nao informar, o bot usa `SAO PAULO`
- se depois voce quiser Pix dinamico via gateway, da para evoluir este modulo

## Modulo de setagem de membros

O modulo `setagem-membros` cria um fluxo simples de aprovacao manual:

- o bot publica ou atualiza automaticamente um painel com o botao `Iniciar Setagem`
- o membro abre um modal com `Nome`, `ID` e um `dropdown` de cargos
- a solicitacao vai para um canal de revisao com botoes `Aceitar` e `Negar`
- ao aceitar, o bot entrega o cargo selecionado e tenta renomear o membro para o padrao `[SIGLA] Nome | ID`
- ao negar, o bot expulsa o membro do servidor

Configure em `modules/setagem-membros/config.json`:

- `panelChannelId`: canal onde o painel inicial sera enviado
- `reviewChannelId`: canal onde a equipe revisa as solicitacoes
- `reviewerRoleId`: cargo que pode revisar as setagens
- `roles`: lista de cargos liberados no dropdown
- `roles[].grantRoleIds`: cargos que serao entregues ao aprovar aquela opcao
- `roles[].shortLabel`: sigla usada apenas na renomeacao do membro

Observacoes:

- o bot precisa de `Manage Roles` para aprovar e entregar cargos
- o bot precisa de `Manage Nicknames` para aplicar a renomeacao automatica
- o bot precisa de `Kick Members` para negar e expulsar membros
- a hierarquia do bot deve ficar acima dos cargos que ele vai entregar
- `Nome` e `ID` sao limitados no modal para ajudar a caber no nickname padrao

## Criando novos modulos

Crie uma nova pasta dentro de `modules/` com:

- `index.js` exportando `register({ client, config, modulePath })`
- `config.json` com a configuracao daquele recurso

O carregador encontra a pasta automaticamente quando o bot inicia.
