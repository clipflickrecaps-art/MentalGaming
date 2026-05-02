require('dotenv').config();

// Suppress Mongoose 8.x false-positive "Duplicate schema index" warning
// (sparse+unique on a single field triggers this cosmetic warning; it does not affect behaviour)
const _origEmit = process.emit.bind(process);
process.emit = function (name, ...args) {
  if (name === 'warning' && args[0]?.message?.includes('Duplicate schema index')) return true;
  return _origEmit(name, ...args);
};

const { Telegraf, Scenes, session } = require('telegraf');
const path = require('path');
const fs   = require('fs');

const { config, validate }      = require('../config/settings');
const { connectDB }             = require('./database');
const { attachUser }            = require('./middlewares/authUser');
const { antiSpam }              = require('./middlewares/antiSpam');
const { errorHandler }          = require('./middlewares/errorHandler');
const { navigationMiddleware }  = require('./middlewares/navigationMiddleware');

const rateManagerScene = require('./scenes/rateManagerScene');
const orderScene       = require('./scenes/orderScene');
const topupScene       = require('./scenes/topupScene');
const broadcastScene   = require('./scenes/broadcastScene');
const spinWheelScene   = require('./scenes/spinWheelScene');
const supportScene     = require('./scenes/supportScene');

validate();

const bot   = new Telegraf(config.bot.token);
const stage = new Scenes.Stage([
  rateManagerScene,
  orderScene,
  topupScene,
  broadcastScene,
  spinWheelScene,
  supportScene,
]);

bot.use(errorHandler());
bot.use(antiSpam());
bot.use(session());
bot.use(stage.middleware());
bot.use(attachUser());

navigationMiddleware(bot);

function loadCommands(bot) {
  const commandsDir = path.join(__dirname, 'commands');
  const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'));

  const ORDER = [
    'start.js',
    'shop.js',
    'orders.js',
    'wallet.js',
    'topup.js',
    'spin.js',
    'checkin.js',
    'promo.js',
    'addressBook.js',
    'referral.js',
    'support.js',
    'profile.js',
    'settings.js',
    'dashboard.js',
    'adminOrders.js',
    'userManagement.js',
    'admin.js',
    'help.js',
  ];

  const sorted = [
    ...ORDER.filter((f) => files.includes(f)),
    ...files.filter((f) => !ORDER.includes(f)),
  ];

  for (const file of sorted) {
    try {
      const register = require(path.join(commandsDir, file));
      if (typeof register === 'function') {
        register(bot);
        console.log(`[Commands] ✅ ${file}`);
      } else {
        console.warn(`[Commands] ⏩ ${file}`);
      }
    } catch (err) {
      console.error(`[Commands] ❌ ${file}:`, err.message);
    }
  }
}

async function registerBotCommands() {
  await bot.telegram.setMyCommands([
    // ── User ──────────────────────────────────────────────────────────────────
    { command: 'start',         description: '🏠 Main Menu' },
    { command: 'shop',          description: '🛒 Browse Products' },
    { command: 'orders',        description: '📦 My Orders' },
    { command: 'wallet',        description: '💰 My Wallet' },
    { command: 'topup',         description: '💳 Top Up Wallet' },
    { command: 'history',       description: '📜 Transaction History' },
    { command: 'spin',          description: '🎰 Spin Wheel' },
    { command: 'spininfo',      description: '🎲 Prize Pool Info' },
    { command: 'checkin',       description: '🗓 Daily Check-In' },
    { command: 'streak',        description: '🔥 My Streak Stats' },
    { command: 'calendar',      description: '📅 Check-In Calendar' },
    { command: 'progress',      description: '📊 Tier Level Progress' },
    { command: 'penalize',      description: '⚠️ Penalize User (Admin)' },
    { command: 'userlog',       description: '📋 User Activity Log (Admin)' },
    { command: 'block',         description: '🚫 Block User (Admin)' },
    { command: 'unblock',       description: '✅ Unblock User (Admin)' },
    { command: 'promo',         description: '🎟 Check Promo Code' },
    { command: 'myids',         description: '📖 Saved Game IDs' },
    { command: 'saveid',        description: '➕ Save a Game ID' },
    { command: 'deleteid',      description: '🗑 Delete a Game ID' },
    { command: 'support',       description: '💬 AI Customer Support' },
    { command: 'mytickets',     description: '🎫 My Support Tickets' },
    { command: 'profile',       description: '👤 My Profile' },
    { command: 'settings',      description: '⚙️ Theme & Settings' },
    { command: 'help',          description: '❓ Help' },
    // ── Admin ─────────────────────────────────────────────────────────────────
    { command: 'admin',         description: '🔧 Admin Panel' },
    { command: 'dashboard',     description: '📊 Dashboard' },
    { command: 'broadcast',     description: '📢 Broadcast Message' },
    { command: 'tickets',       description: '🎫 Support Tickets' },
    { command: 'closeticket',   description: '⚫ Close a Ticket' },
    { command: 'pendingorders', description: '🟡 Pending Orders' },
    { command: 'addcodes',      description: '🎁 Add Digital Codes' },
    { command: 'flashsale',     description: '🔥 Activate Flash Sale' },
    { command: 'createpromo',   description: '🎟 Create Promo Code' },
    { command: 'listpromos',    description: '📋 List Promo Codes' },
    { command: 'deletepromo',   description: '🗑 Deactivate Promo' },
    { command: 'userinfo',      description: '👤 User Info' },
    { command: 'users',         description: '👥 User List' },
    { command: 'ban',           description: '🚫 Ban User' },
    { command: 'unban',         description: '✅ Unban User' },
    { command: 'warn',          description: '⚠️ Warn User' },
    { command: 'unwarn',        description: '✅ Remove Warning' },
    { command: 'restrict',      description: '🔒 Restrict Rights' },
    { command: 'unrestrict',    description: '🔓 Remove Restrictions' },
    { command: 'adjustbal',     description: '💳 Adjust Balance' },
    { command: 'addpayment',    description: '➕ Add Payment Method' },
    { command: 'listpayments',  description: '💳 Payment Methods' },
    { command: 'managerates',   description: '💱 Manage Rates' },
    { command: 'rates',         description: '💹 Current Rates' },
    { command: 'fetchrates',    description: '🔄 Fetch Live Rates' },
  ]);
  console.log('[Bot] ✅ Command menu registered');
}

async function bootstrap() {
  console.log('[Bot] 🚀 Starting Mental Gaming Store Bot...');

  await connectDB();
  loadCommands(bot);

  // Flash sale watcher — every 60s
  const { startFlashSaleWatcher } = require('./services/FlashSaleService');
  startFlashSaleWatcher(bot.telegram);
  console.log('[Bot] ✅ Flash sale watcher started');

  process.on('SIGINT',  () => { bot.stop('SIGINT');  process.exit(0); });
  process.on('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });

  await bot.launch();
  await registerBotCommands();
  console.log(`[Bot] ✅ @${bot.botInfo?.username} is live!`);
}

bootstrap().catch((err) => {
  console.error('[Bot] ❌ Fatal startup error:', err);
  process.exit(1);
});
