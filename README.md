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

2. Copie `.env.example` para `.env` e preencha:

```env
DISCORD_TOKEN=seu_token
```

3. Configure o canal de log em `modules/member-logs/config.json`.

4. Inicie o bot:

```bash
npm start
```

## Estrutura

- `src/index.js`: bootstrap do bot
- `src/loaders/moduleLoader.js`: carregador automatico de modulos
- `modules/<nome-do-modulo>/index.js`: logica do modulo
- `modules/<nome-do-modulo>/config.json`: configuracao isolada do modulo

## Criando novos modulos

Crie uma nova pasta dentro de `modules/` com:

- `index.js` exportando `register({ client, config, modulePath })`
- `config.json` com a configuracao daquele recurso

O carregador encontra a pasta automaticamente quando o bot inicia.
