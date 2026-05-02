require('dotenv').config();

const { Telegraf, Scenes, session } = require('telegraf');
const path = require('path');
const fs = require('fs');

const { config, validate } = require('../config/settings');
const { connectDB } = require('./database');
const { attachUser } = require('./middlewares/authUser');
const { antiSpam } = require('./middlewares/antiSpam');
const { errorHandler } = require('./middlewares/errorHandler');
const { navigationMiddleware } = require('./middlewares/navigationMiddleware');

const rateManagerScene = require('./scenes/rateManagerScene');
const orderScene = require('./scenes/orderScene');

validate();

const bot = new Telegraf(config.bot.token);
const stage = new Scenes.Stage([rateManagerScene, orderScene]);

bot.use(errorHandler());
bot.use(antiSpam());
bot.use(session());
bot.use(stage.middleware());
bot.use(attachUser());

navigationMiddleware(bot);

function loadCommands(bot) {
  const commandsDir = path.join(__dirname, 'commands');
  const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'));

  // Load order ensures nav folders are registered before commands that depend on them
  const ORDER = [
    'start.js',
    'shop.js',
    'orders.js',
    'wallet.js',
    'support.js',
    'profile.js',
    'settings.js',
    'dashboard.js',
    'adminOrders.js',
    'admin.js',
    'help.js',
  ];

  const sorted = [
    ...ORDER.filter((f) => files.includes(f)),
    ...files.filter((f) => !ORDER.includes(f)),
  ];

  for (const file of sorted) {
    const commandPath = path.join(commandsDir, file);
    try {
      const register = require(commandPath);
      if (typeof register === 'function') {
        register(bot);
        console.log(`[Commands] ✅ ${file}`);
      } else {
        console.warn(`[Commands] ⏩ Skipped (no default fn): ${file}`);
      }
    } catch (err) {
      console.error(`[Commands] ❌ Failed to load ${file}:`, err.message);
    }
  }
}

async function registerBotCommands() {
  await bot.telegram.setMyCommands([
    { command: 'start',          description: '🏠 Main Menu' },
    { command: 'shop',           description: '🛒 Browse Products' },
    { command: 'orders',         description: '📦 My Orders' },
    { command: 'wallet',         description: '💰 My Wallet' },
    { command: 'profile',        description: '👤 My Profile' },
    { command: 'settings',       description: '⚙️ Theme & Settings' },
    { command: 'support',        description: '💬 Customer Support' },
    { command: 'help',           description: '❓ Help' },
    { command: 'admin',          description: '🔧 Admin Panel' },
    { command: 'dashboard',      description: '📊 Admin Dashboard' },
    { command: 'pendingorders',  description: '🟡 Pending Orders' },
    { command: 'managerates',    description: '💱 Manage Exchange Rates' },
    { command: 'rates',          description: '💹 Current Rates' },
    { command: 'fetchrates',     description: '🔄 Fetch Live Rates' },
  ]);
  console.log('[Bot] ✅ Telegram command menu registered');
}

async function bootstrap() {
  console.log('[Bot] 🚀 Starting Mental Gaming Store Bot...');

  await connectDB();

  loadCommands(bot);

  process.on('SIGINT',  () => { console.log('[Bot] Shutting down...'); bot.stop('SIGINT');  process.exit(0); });
  process.on('SIGTERM', () => { console.log('[Bot] Shutting down...'); bot.stop('SIGTERM'); process.exit(0); });

  await bot.launch();
  await registerBotCommands();
  console.log(`[Bot] ✅ @${bot.botInfo?.username} is live!`);
}

bootstrap().catch((err) => {
  console.error('[Bot] ❌ Fatal startup error:', err);
  process.exit(1);
});
