const { adminOnly } = require('../middlewares/adminCheck');
const { adminMenuKeyboard, mainMenuKeyboard } = require('../utils/keyboard');
const { fetchLiveRates, getAllRates } = require('../services/currencyService');
const { auditLog } = require('../services/logger');
const { listUsers } = require('../services/UserManagementService');
const { Markup } = require('telegraf');
const Order = require('../models/Order');
const Product = require('../models/Product');
const AuditLog = require('../models/AuditLog');

module.exports = function registerAdmin(bot) {

  // ── /admin panel ──────────────────────────────────────────────────────────
  bot.command('admin', adminOnly(), async (ctx) => {
    await ctx.reply('🔧 *Admin Panel* — Mental Gaming Store', {
      parse_mode: 'Markdown',
      ...adminMenuKeyboard(),
    });
  });

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  bot.hears('💱 Manage Rates', adminOnly(), (ctx) => ctx.scene.enter('rate_manager'));
  bot.hears('📢 Broadcast',    adminOnly(), (ctx) => ctx.scene.enter('broadcast_scene'));
  bot.hears('👥 Manage Users', adminOnly(), async (ctx) => {
    await ctx.reply(
      `👥 *User Management*\n\nChoose an action:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📋 All Users',      'users_page:1')],
          [Markup.button.callback('🚫 Banned Users',   'users_banned')],
          [Markup.button.callback('⚠️ Warned Users',   'users_warned')],
          [Markup.button.callback('📊 User Stats',     'users_stats')],
        ]),
      }
    );
  });

  bot.action('users_banned', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const { users, total } = await listUsers({ filter: { isBlocked: true }, limit: 10 });
    if (!total) return ctx.reply('✅ No banned users.');
    const lines = users.map((u) => `• \`${u.telegramId}\` ${u.username ? `@${u.username}` : '—'}`);
    await ctx.reply(`🚫 *Banned Users (${total})*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  });

  bot.action('users_warned', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const { users, total } = await listUsers({ filter: { warningsCount: { $gt: 0 } }, limit: 10 });
    if (!total) return ctx.reply('✅ No users with warnings.');
    const lines = users.map((u) => `• \`${u.telegramId}\` ${u.username ? `@${u.username}` : '—'} — ⚠️ ${u.warningsCount}/3`);
    await ctx.reply(`⚠️ *Warned Users (${total})*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  });

  bot.action('users_stats', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const User = require('../models/User');
    const [total, banned, warned, gold, platinum] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isBlocked: true }),
      User.countDocuments({ warningsCount: { $gt: 0 } }),
      User.countDocuments({ membershipTier: 'Gold' }),
      User.countDocuments({ membershipTier: 'Platinum' }),
    ]);
    await ctx.reply(
      `📊 *User Statistics*\n\n` +
      `👥 Total Users: *${total}*\n` +
      `🟢 Active: *${total - banned}*\n` +
      `🚫 Banned: *${banned}*\n` +
      `⚠️ Warned: *${warned}*\n` +
      `──────────────\n` +
      `🥈 Silver: *${total - gold - platinum}*\n` +
      `🥇 Gold: *${gold}*\n` +
      `💎 Platinum: *${platinum}*`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Rate management ────────────────────────────────────────────────────────
  bot.command('managerates', adminOnly(), (ctx) => ctx.scene.enter('rate_manager'));

  bot.command('rates', adminOnly(), async (ctx) => {
    const rates = await getAllRates();
    if (!rates.length) return ctx.reply('No exchange rates yet. Use /managerates.');
    const lines = rates.map((r) => `• *${r.currencyCode}*: \`${parseFloat(r.rateToMMK.toFixed(4))}\` MMK  _(${r.source})_`);
    await ctx.reply(`💱 *Current Exchange Rates*\n\n${lines.join('\n')}`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('✏️ Update', 'open_rate_manager')]]),
    });
  });

  bot.action('open_rate_manager', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('rate_manager');
  });

  bot.command('fetchrates', adminOnly(), async (ctx) => {
    const msg = await ctx.reply('⏳ Fetching live exchange rates...');
    try {
      const updates = await fetchLiveRates();
      const lines = updates.map((u) => `• *${u.code}*: \`${u.rateToMMK}\` MMK`).join('\n');
      await auditLog(ctx.from.id, 'FETCH_LIVE_RATES', null, 'Currency', { updates });
      await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
      await ctx.reply(`✅ *Live Rates Fetched*\n\n${lines}\n\n_Use /managerates → Approve All to apply._`, {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  // ── /broadcast shortcut ────────────────────────────────────────────────────
  bot.command('broadcast', adminOnly(), (ctx) => ctx.scene.enter('broadcast_scene'));

  // ── Admin keyboard button handlers ─────────────────────────────────────────

  bot.hears('📦 Manage Orders', adminOnly(), async (ctx) => {
    const pending = await Order.countDocuments({ status: 'Pending' });
    const processing = await Order.countDocuments({ status: 'Processing' });
    await ctx.reply(
      `📦 *Order Management*\n\n🟡 Pending: *${pending}*\n🔵 Processing: *${processing}*\n\nChoose an action:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🟡 View Pending',    'admin_pending_orders')],
          [Markup.button.callback('📋 All Orders',      'admin_all_orders')],
          [Markup.button.callback('📊 Dashboard',       'dashboard_refresh')],
        ]),
      }
    );
  });

  bot.action('admin_all_orders', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const orders = await Order.find()
      .populate('userId', 'username telegramId')
      .populate('productId', 'name')
      .sort({ timestamp: -1 })
      .limit(10);
    if (!orders.length) return ctx.reply('📦 No orders found.');
    const { price } = require('../utils/ui');
    const lines = orders.map((o, i) => {
      const user = o.userId?.username ? `@${o.userId.username}` : `ID:${o.userId?.telegramId}`;
      const product = o.productId?.name || 'Unknown';
      const icon = o.status === 'Success' ? '✅' : o.status === 'Pending' ? '🟡' : o.status === 'Cancelled' ? '❌' : '🔵';
      return `${i + 1}\\. ${icon} ${user} — *${product}* — \`${price(o.amount)}\``;
    });
    await ctx.reply(`📦 *Recent Orders (${orders.length})*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  });

  bot.hears('🛍️ Manage Products', adminOnly(), async (ctx) => {
    const total   = await Product.countDocuments({});
    const active  = await Product.countDocuments({ isActive: true });
    const inactive = total - active;
    await ctx.reply(
      `🛍️ *Product Management*\n\n✅ Active: *${active}*\n🔴 Inactive: *${inactive}*\n📦 Total: *${total}*\n\nChoose an action:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📋 List Products',    'pm_list_products')],
          [Markup.button.callback('➕ Add Product',      'pm_add_product')],
          [Markup.button.callback('💱 Update Rates',     'open_rate_manager')],
        ]),
      }
    );
  });

  bot.action('pm_list_products', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const products = await Product.find().sort({ isActive: -1, category: 1 }).limit(15);
    if (!products.length) return ctx.reply('🛍️ No products found. Add some first.');
    const lines = products.map((p, i) => {
      const icon = p.isActive ? '✅' : '🔴';
      return `${i + 1}\\. ${icon} *${p.name}* — \`${p.finalPrice?.toLocaleString() || '?'} KS\``;
    });
    await ctx.reply(
      `🛍️ *Products (${products.length})*\n\n${lines.join('\n')}\n\n_Use /addproduct or the API to manage products._`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.action('pm_add_product', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      `➕ *Add Product*\n\nUse the command:\n\`/addproduct\`\n\nOr manage products via the API panel:\n/apimanagement`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.hears('📋 Audit Logs', adminOnly(), async (ctx) => {
    const logs = await AuditLog.find()
      .sort({ createdAt: -1 })
      .limit(10);

    if (!logs.length) {
      return ctx.reply('📋 No audit log entries yet.');
    }

    const lines = logs.map((l, i) => {
      const ts = new Date(l.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Rangoon' });
      const target = l.targetId ? ` → \`${l.targetId}\`` : '';
      return `${i + 1}\\. \`${l.action}\`${target}\n   _${ts} MMT_`;
    });

    await ctx.reply(
      `📋 *Recent Audit Logs*\n\n${lines.join('\n\n')}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔄 Refresh', 'audit_refresh')]]),
      }
    );
  });

  bot.action('audit_refresh', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(10);
    if (!logs.length) return ctx.editMessageText('📋 No audit log entries yet.');
    const lines = logs.map((l, i) => {
      const ts = new Date(l.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Rangoon' });
      const target = l.targetId ? ` → \`${l.targetId}\`` : '';
      return `${i + 1}\\. \`${l.action}\`${target}\n   _${ts} MMT_`;
    });
    await ctx.editMessageText(
      `📋 *Recent Audit Logs*\n\n${lines.join('\n\n')}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔄 Refresh', 'audit_refresh')]]),
      }
    );
  });

  bot.hears('🔙 Back to Main', adminOnly(), async (ctx) => {
    const name = ctx.from?.first_name || 'Admin';
    await ctx.reply(
      `👤 Switched to user view, *${name}*\\.\nUse the menu below or tap /admin to return to the admin panel\\.`,
      { parse_mode: 'MarkdownV2', ...mainMenuKeyboard() }
    );
  });

  // ── Manual price setter (from rate manager scene) ──────────────────────────
  bot.on('message', async (ctx, next) => {
    if (ctx.session?.rm_manual_product && ctx.message?.text) {
      const p = parseInt(ctx.message.text.trim(), 10);
      if (isNaN(p) || p <= 0) return ctx.reply('❌ Enter a positive integer.');
      const { setManualPrice } = require('../services/PriceCalculator');
      try {
        const product = await setManualPrice(ctx.session.rm_manual_product, p);
        await auditLog(ctx.from.id, 'SET_MANUAL_PRICE', product._id.toString(), 'Product', { price: p });
        ctx.session.rm_manual_product = null;
        return ctx.reply(
          `✅ *${product.name}* → \`${p.toLocaleString()} KS\` _(Manual mode)_`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        return ctx.reply(`❌ ${err.message}`);
      }
    }
    return next();
  });
};
