# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

---

## Mental Gaming Store — Telegram Bot (`artifacts/bot`)

A Telegram bot built with **Telegraf** and **Mongoose** (MongoDB). Not part of the pnpm workspace typecheck — it's a standalone CommonJS Node.js package.

### Run the bot

```bash
cd artifacts/bot && node src/index.js
# or with auto-reload:
cd artifacts/bot && npx nodemon src/index.js
```

### Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
|---|---|
| `BOT_TOKEN` | Telegram bot token from @BotFather |
| `MONGODB_URI` | MongoDB connection string |
| `ADMIN_ID` | Your Telegram numeric user ID |
| `AI_API_KEY` | OpenAI API key (optional, for AI features) |

### Directory Structure

```
artifacts/bot/
├── config/
│   └── settings.js          # Env config + validation
├── src/
│   ├── index.js             # Entry point — boots bot + loads commands
│   ├── database.js          # Mongoose connect/disconnect
│   ├── commands/            # Bot command handlers (auto-loaded)
│   │   ├── start.js
│   │   ├── help.js
│   │   └── admin.js
│   ├── controllers/         # Business logic
│   │   ├── orderController.js
│   │   └── pricingController.js
│   ├── models/              # Mongoose schemas
│   │   ├── User.js
│   │   ├── Product.js
│   │   ├── Order.js
│   │   ├── Currency.js
│   │   └── AuditLog.js
│   ├── middlewares/         # Telegraf middleware
│   │   ├── adminCheck.js
│   │   ├── antiSpam.js
│   │   ├── authUser.js
│   │   └── errorHandler.js
│   ├── services/            # External integrations
│   │   ├── aiService.js
│   │   ├── currencyService.js
│   │   └── logger.js
│   └── utils/              # Helpers
│       ├── currencyConverter.js
│       └── keyboard.js
└── .env                    # Local secrets (gitignored)
```

### Adding a New Command

Create a new file in `src/commands/`:

```js
module.exports = function registerMyCommand(bot) {
  bot.command('mycommand', async (ctx) => {
    await ctx.reply('Hello!');
  });
};
```

It is automatically discovered and loaded at startup — no registration needed.
