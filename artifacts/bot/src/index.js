require('dotenv').config();

const { Telegraf, Scenes, session } = require('telegraf');
const path = require('path');
const fs = require('fs');

const { config, validate } = require('../config/settings');
const { connectDB } = require('./database');
const { attachUser } = require('./middlewares/authUser');
const { antiSpam } = require('./middlewares/antiSpam');
const { errorHandler } = require('./middlewares/errorHandler');

const rateManagerScene = require('./scenes/rateManagerScene');

validate();

const bot = new Telegraf(config.bot.token);

const stage = new Scenes.Stage([rateManagerScene]);

bot.use(errorHandler());
bot.use(antiSpam());
bot.use(session());
bot.use(stage.middleware());
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
        console.warn(`[Commands] Skipped (no default export): ${file}`);
      }
    } catch (err) {
      console.error(`[Commands] Failed to load ${file}:`, err.message);
    }
  }
}

async function registerBotCommands(bot) {
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Main Menu' },
    { command: 'help', description: 'Help & Commands' },
    { command: 'admin', description: 'Admin Panel' },
    { command: 'managerates', description: 'Manage Exchange Rates' },
    { command: 'rates', description: 'View Current Rates' },
    { command: 'fetchrates', description: 'Fetch Live Rates from API' },
  ]);
  console.log('[Bot] Telegram commands menu registered');
}

async function bootstrap() {
  console.log('[Bot] Starting Mental Gaming Store Bot...');

  await connectDB();

  loadCommands(bot);

  process.on('SIGINT', () => {
    console.log('[Bot] Shutting down...');
    bot.stop('SIGINT');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('[Bot] Shutting down...');
    bot.stop('SIGTERM');
    process.exit(0);
  });

  await bot.launch();
  await registerBotCommands(bot);
  console.log(`[Bot] Mental Gaming Store Bot is running! @${bot.botInfo?.username || 'unknown'}`);
}

bootstrap().catch((err) => {
  console.error('[Bot] Fatal startup error:', err);
  process.exit(1);
});
