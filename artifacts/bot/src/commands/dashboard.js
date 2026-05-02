const { adminOnly } = require('../middlewares/adminCheck');
const { getTheme } = require('../services/ThemeService');
const { getAllRates } = require('../services/currencyService');
const { buildMessage, stat, divider, price } = require('../utils/ui');
const { pulseLoading, resolveMessage } = require('../utils/animations');
const Order = require('../models/Order');
const User = require('../models/User');
const Product = require('../models/Product');
const { Markup } = require('telegraf');

async function buildDashboardText(theme) {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const [
    ordersToday,
    pendingOrders,
    totalUsers,
    totalProducts,
    successToday,
    rates,
  ] = await Promise.all([
    Order.countDocuments({ timestamp: { $gte: startOfDay } }),
    Order.countDocuments({ status: 'Pending' }),
    User.countDocuments({}),
    Product.countDocuments({ isActive: true }),
    Order.countDocuments({ status: 'Success', timestamp: { $gte: startOfDay } }),
    getAllRates(),
  ]);

  const recentOrders = await Order.find({ status: 'Pending' })
    .populate('userId', 'username telegramId')
    .populate('productId', 'name')
    .sort({ timestamp: -1 })
    .limit(5);

  const rateLines = rates.map(
    (r) => `  ${r.currencyCode}: \`${parseFloat(r.rateToMMK.toFixed(4))}\` MMK`
  );

  const pendingLines = recentOrders.length
    ? recentOrders.map((o, i) => {
        const user = o.userId?.username ? `@${o.userId.username}` : `ID:${o.userId?.telegramId}`;
        const product = o.productId?.name || 'Unknown';
        return `  ${i + 1}. ${user} → ${product} — \`${price(o.amount)}\``;
      })
    : ['  _No pending orders_'];

  const sep = divider(theme);

  return buildMessage(theme, [
    {
      title: `📊 Admin Dashboard`,
      lines: [
        `🕐 ${now.toLocaleString('en-GB', { timeZone: 'Asia/Rangoon' })} (MMT)`,
      ],
    },
    {
      title: null,
      lines: [
        `${sep}`,
        `📦 *Orders Today*`,
        stat('🔵', 'Total Today', ordersToday),
        stat('✅', 'Successful', successToday),
        stat('🟡', 'Pending',    pendingOrders),
        ``,
        `👥 *Store Stats*`,
        stat('👤', 'Total Users',    totalUsers),
        stat('🛍️', 'Active Products', totalProducts),
        ``,
        `💱 *Exchange Rates*`,
        ...rateLines,
        ``,
        `🟡 *Recent Pending Orders*`,
        ...pendingLines,
        sep,
      ],
    },
  ]);
}

module.exports = function registerDashboard(bot) {
  bot.command('dashboard', adminOnly(), async (ctx) => {
    const ref = await pulseLoading(ctx, 'Loading Dashboard', 3, 400);
    try {
      const theme = getTheme(ctx.user);
      const text = await buildDashboardText(theme);

      await resolveMessage(ctx, ref, text, {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Refresh', 'dashboard_refresh')],
          [Markup.button.callback('📦 View Pending', 'admin_pending_orders')],
          [Markup.button.callback('💱 Manage Rates', 'open_rate_manager')],
        ]),
      });
    } catch (err) {
      await resolveMessage(ctx, ref, `❌ Dashboard error: ${err.message}`);
    }
  });

  bot.hears('📊 Dashboard', adminOnly(), async (ctx) => {
    await ctx.scene ? ctx.reply('Loading...') : null;
    return ctx.reply('/dashboard');
  });

  bot.action('dashboard_refresh', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');
    try {
      const theme = getTheme(ctx.user);
      const text = await buildDashboardText(theme);
      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Refresh', 'dashboard_refresh')],
          [Markup.button.callback('📦 View Pending', 'admin_pending_orders')],
          [Markup.button.callback('💱 Manage Rates', 'open_rate_manager')],
        ]),
      });
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  bot.action('admin_pending_orders', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const orders = await Order.find({ status: 'Pending' })
      .populate('userId', 'username telegramId')
      .populate('productId', 'name finalPrice')
      .sort({ timestamp: -1 })
      .limit(10);

    if (!orders.length) return ctx.reply('✅ No pending orders right now.');

    const theme = getTheme(ctx.user);
    const lines = orders.map((o, i) => {
      const user = o.userId?.username ? `@${o.userId.username}` : `ID:${o.userId?.telegramId}`;
      const product = o.productId?.name || 'Unknown';
      const ts = new Date(o.timestamp).toLocaleTimeString('en-GB', { timeZone: 'Asia/Rangoon' });
      return `${i + 1}\\. ${user} — *${product}* — \`${price(o.amount)}\` _(${ts})_`;
    });

    await ctx.reply(
      `📦 *Pending Orders (${orders.length})*\n\n${lines.join('\n')}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Dashboard', 'dashboard_refresh')]]),
      }
    );
  });
};
