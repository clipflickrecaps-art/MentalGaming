require('dotenv').config();

const { Telegraf } = require('telegraf');
const path = require('path');
const fs = require('fs');

const { config, validate } = require('../config/settings');
const { connectDB } = require('./database');
const { attachUser } = require('./middlewares/authUser');
const { antiSpam } = require('./middlewares/antiSpam');
const { errorHandler } = require('./middlewares/errorHandler');

validate();

const bot = new Telegraf(config.bot.token);

bot.use(errorHandler());
bot.use(antiSpam());
bot.use(attachUser());

function loadCommands(bot) {
  const commandsDir = path.join(__dirname, 'commands');
  const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'));

  for (const file of files) {
    const commandPath = path.join(commandsDir, file);
    try {
      const register = require(commandPath);
      if (typeof register === 'function') {
        register(bot);
        console.log(`[Commands] Loaded: ${file}`);
      } else {
        console.warn(`[Commands] Skipped (no default export function): ${file}`);
      }
    } catch (err) {
      console.error(`[Commands] Failed to load ${file}:`, err.message);
    }
  }
}

async function bootstrap() {
  console.log('[Bot] Starting Mental Gaming Store Bot...');

  await connectDB();

  loadCommands(bot);

  bot.on('message', async (ctx, next) => {
    if (ctx.message.text && !ctx.message.text.startsWith('/')) {
      return next();
    }
  });

  process.on('SIGINT', async () => {
    console.log('[Bot] Shutting down...');
    bot.stop('SIGINT');
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('[Bot] Shutting down...');
    bot.stop('SIGTERM');
    process.exit(0);
  });

  await bot.launch();
  console.log(`[Bot] Mental Gaming Store Bot is running! @${bot.botInfo?.username || 'unknown'}`);
}

bootstrap().catch((err) => {
  console.error('[Bot] Fatal startup error:', err);
  process.exit(1);
});
