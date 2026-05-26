const { adminOnly } = require('../middlewares/adminCheck');
const { fetchLiveRates, getAllRates } = require('../services/currencyService');
const { auditLog } = require('../services/logger');
const { listUsers } = require('../services/UserManagementService');
const { Markup } = require('telegraf');
const Nav = require('../services/NavigationService');
const Order = require('../models/Order');
const Product = require('../models/Product');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const Promo = require('../models/Promo');
const { price } = require('../utils/ui');

// ── Admin main nav — inline panel with live stats ─────────────────────────────

Nav.register({
  id: 'admin_main',
  title: '🔧 Admin Panel',
  build: async (ctx, theme) => {
    const [pending, processing, activeProducts, totalUsers] = await Promise.all([
      Order.countDocuments({ status: 'Pending' }),
      Order.countDocuments({ status: 'Processing' }),
      Product.countDocuments({ isActive: true }),
      User.countDocuments({}),
    ]);

    const text =
      `🔧 *Admin Panel — Mental Gaming Store*\n\n` +
      `🟡 Pending Orders: *${pending}*\n` +
      `🔵 Processing: *${processing}*\n` +
      `🛍️ Active Products: *${activeProducts}*\n` +
      `👥 Total Users: *${totalUsers}*`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📊 Dashboard',     'admin_dashboard_action'), Markup.button.callback('📦 Orders',      'admin_orders_action')],
      [Markup.button.callback('🛍️ Products',      'admin_products_action'), Markup.button.callback('👥 Users',       'admin_users_action')],
      [Markup.button.callback('💰 Coins & Tiers', 'admin_coins_panel'),      Markup.button.callback('🎟 Promotions',  'admin_promos_action')],
      [Markup.button.callback('🎰 Spin Rewards',  'admin_spin_panel'),       Markup.button.callback('💱 Rates',       'admin_rates_action')],
      [Markup.button.callback('📢 Broadcast',     'admin_broadcast_action'), Markup.button.callback('📋 Audit Logs',  'admin_audit_action')],
      [Markup.button.callback('👤 User View',     'admin_user_view')],
    ]);

    return { text, keyboard };
  },
});

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = function registerAdmin(bot) {

  // ── /admin command ─────────────────────────────────────────────────────────
  bot.command('admin', adminOnly(), async (ctx) => {
    await Nav.navigate(ctx, 'admin_main', false);
  });

  // ── Admin inline nav action handlers ──────────────────────────────────────

  bot.action('admin_dashboard_action', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery('Loading...');
    const [totalUsers, pending, processing, success, todayOrders] = await Promise.all([
      User.countDocuments({}),
      Order.countDocuments({ status: 'Pending' }),
      Order.countDocuments({ status: 'Processing' }),
      Order.countDocuments({ status: 'Success' }),
      Order.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
    ]);
    await ctx.reply(
      `📊 *Quick Dashboard*\n\n` +
      `👥 Total Users: *${totalUsers}*\n` +
      `🟡 Pending Orders: *${pending}*\n` +
      `🔵 Processing: *${processing}*\n` +
      `✅ Completed: *${success}*\n` +
      `📅 Today's Orders: *${todayOrders}*\n\n` +
      `_For full stats, use /dashboard_`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Refresh', 'dashboard_refresh')],
          [Markup.button.callback('🔙 Back', 'nav:go:admin_main')],
        ]),
      }
    );
  });

  bot.action('admin_orders_action', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const pending    = await Order.countDocuments({ status: 'Pending' });
    const processing = await Order.countDocuments({ status: 'Processing' });
    await ctx.reply(
      `📦 *Order Management*\n\n🟡 Pending: *${pending}*\n🔵 Processing: *${processing}*`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🟡 View Pending',  'admin_pending_orders')],
          [Markup.button.callback('📋 All Orders',    'admin_all_orders')],
          [Markup.button.callback('🔙 Back',          'nav:go:admin_main')],
        ]),
      }
    );
  });

  bot.action('admin_products_action', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const [total, active] = await Promise.all([
      Product.countDocuments({}),
      Product.countDocuments({ isActive: true }),
    ]);
    await ctx.reply(
      `🛍️ *Product Management*\n\n✅ Active: *${active}*\n🔴 Inactive: *${total - active}*\n📦 Total: *${total}*`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📋 List Products', 'pm_list_products')],
          [Markup.button.callback('➕ Add Product',   'admin_product_add')],
          [Markup.button.callback('💱 Update Rates',  'open_rate_manager')],
          [Markup.button.callback('🔙 Back',          'nav:go:admin_main')],
        ]),
      }
    );
  });

  bot.action('admin_users_action', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(`👥 *User Management*\n\nChoose an action:`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📋 All Users',    'users_page:1')],
        [Markup.button.callback('🚫 Banned',       'users_banned'), Markup.button.callback('⚠️ Warned', 'users_warned')],
        [Markup.button.callback('📊 Stats',        'users_stats')],
        [Markup.button.callback('🔙 Back',         'nav:go:admin_main')],
      ]),
    });
  });

  bot.action('admin_promos_action', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const promos = await Promo.find().sort({ createdAt: -1 }).limit(20);
    if (!promos.length) {
      return ctx.reply(
        `🎟 *Promo Codes*\n\nNo promo codes yet.\n\nTo create one, use the \`/createpromo\` command.\nExample: \`/createpromo SAVE10 Percentage 10 100\``,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'nav:go:admin_main')]]),
        }
      );
    }
    const lines = promos.map((p) => {
      const disc = p.discountType === 'Flat' ? `${p.value.toLocaleString()} KS` : `${p.value}%`;
      const uses = p.maxUses ? `${p.currentUses}/${p.maxUses}` : `${p.currentUses}/∞`;
      return `${p.isActive ? '🟢' : '🔴'} \`${p.code}\` — ${disc} off — ${uses} uses`;
    });
    const deleteButtons = promos
      .filter((p) => p.isActive)
      .slice(0, 5)
      .map((p) => [Markup.button.callback(`🗑 ${p.code}`, `admin_promo_del:${p.code}`)]);
    await ctx.reply(
      `🎟 *Promo Codes (${promos.length})*\n\n${lines.join('\n')}\n\n_Create new: /createpromo_`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          ...deleteButtons,
          [Markup.button.callback('🔙 Back', 'nav:go:admin_main')],
        ]),
      }
    );
  });

  bot.action(/^admin_promo_del:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery('Deactivating...');
    const code = ctx.match[1].toUpperCase();
    const result = await Promo.findOneAndUpdate({ code }, { isActive: false }, { new: true });
    if (!result) return ctx.reply(`❌ Promo \`${code}\` not found.`, { parse_mode: 'Markdown' });
    await auditLog(ctx.from.id, 'PROMO_DEACTIVATED', null, 'Promo', { code });
    await ctx.reply(`✅ Promo \`${code}\` deactivated.`, { parse_mode: 'Markdown' });
  });

  bot.action('admin_rates_action', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('rate_manager');
  });

  bot.action('admin_broadcast_action', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('broadcast_scene');
  });

  bot.action('admin_audit_action', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(10);
    if (!logs.length) return ctx.reply('📋 No audit log entries yet.', {
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'nav:go:admin_main')]]),
    });
    const lines = logs.map((l, i) => {
      const ts = new Date(l.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Rangoon' });
      const target = l.targetId ? ` → \`${l.targetId}\`` : '';
      return `${i + 1}\\. \`${l.action}\`${target}\n   _${ts} MMT_`;
    });
    await ctx.reply(`📋 *Recent Audit Logs*\n\n${lines.join('\n\n')}`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', 'audit_refresh'), Markup.button.callback('🔙 Back', 'nav:go:admin_main')],
      ]),
    });
  });

  bot.action('admin_user_view', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery('Switching to user view...');
    await Nav.navigate(ctx, 'main', true);
  });

  // ── Product list with manage buttons ──────────────────────────────────────

  bot.action('pm_list_products', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const products = await Product.find().sort({ isActive: -1, category: 1 }).limit(15);
    if (!products.length) {
      return ctx.reply('🛍️ No products found. Use "Add Product" to create one.', {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ Add Product', 'admin_product_add')],
          [Markup.button.callback('🔙 Back', 'admin_products_action')],
        ]),
      });
    }
    const rows = products.map((p) => [
      Markup.button.callback(
        `${p.isActive ? '✅' : '🔴'} ${p.name} — ${p.finalPrice?.toLocaleString() || '?'} KS`,
        `ap_view:${p._id}`
      ),
    ]);
    rows.push([
      Markup.button.callback('➕ Add Product', 'admin_product_add'),
      Markup.button.callback('🔙 Back', 'admin_products_action'),
    ]);
    await ctx.reply(`🛍️ *Products (${products.length})*\n\nTap a product to manage:`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(rows),
    });
  });

  bot.action(/^ap_view:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const p = await Product.findById(ctx.match[1]);
    if (!p) return ctx.reply('❌ Product not found.');
    await ctx.reply(
      `📦 *${p.name}*\n\n` +
      `📁 Category: ${p.category}\n` +
      `🌍 Region: ${p.region}\n` +
      `💰 Price: ${price(p.finalPrice)}\n` +
      `📦 Stock: ${p.stockCount === -1 ? '∞ Unlimited' : p.stockCount}\n` +
      `Status: ${p.isActive ? '✅ Active' : '🔴 Inactive'}\n` +
      (p.description ? `📝 ${p.description}` : ''),
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(p.isActive ? '🔴 Deactivate' : '✅ Activate', `ap_toggle:${p._id}`)],
          [Markup.button.callback('🗑 Delete', `ap_delete_ask:${p._id}`)],
          [Markup.button.callback('🔙 Products List', 'pm_list_products')],
        ]),
      }
    );
  });

  // ── User management actions ────────────────────────────────────────────────
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
    const [total, banned, warned, gold, platinum] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isBlocked: true }),
      User.countDocuments({ warningsCount: { $gt: 0 } }),
      User.countDocuments({ membershipTier: 'Gold' }),
      User.countDocuments({ membershipTier: 'Platinum' }),
    ]);
    await ctx.reply(
      `📊 *User Statistics*\n\n` +
      `👥 Total: *${total}*\n` +
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
      await ctx.reply(`✅ *Live Rates Fetched*\n\n${lines}\n\n_Use /managerates → Approve All to apply._`, { parse_mode: 'Markdown' });
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  // ── Orders ─────────────────────────────────────────────────────────────────
  bot.action('admin_pending_orders', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const orders = await Order.find({ status: 'Pending' })
      .populate('userId', 'username telegramId')
      .populate('productId', 'name')
      .sort({ timestamp: -1 })
      .limit(10);
    if (!orders.length) return ctx.reply('✅ No pending orders!', {
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'admin_orders_action')]]),
    });
    const lines = orders.map((o, i) => {
      const user    = o.userId?.username ? `@${o.userId.username}` : `ID:${o.userId?.telegramId}`;
      const product = o.productId?.name || 'Unknown';
      return `${i + 1}\\. 🟡 ${user} — *${product}* — \`${price(o.amount)}\``;
    });
    await ctx.reply(`🟡 *Pending Orders (${orders.length})*\n\n${lines.join('\n')}`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'admin_orders_action')]]),
    });
  });

  bot.action('admin_all_orders', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const orders = await Order.find()
      .populate('userId', 'username telegramId')
      .populate('productId', 'name')
      .sort({ timestamp: -1 })
      .limit(10);
    if (!orders.length) return ctx.reply('📦 No orders found.');
    const lines = orders.map((o, i) => {
      const user    = o.userId?.username ? `@${o.userId.username}` : `ID:${o.userId?.telegramId}`;
      const product = o.productId?.name || 'Unknown';
      const icon    = o.status === 'Success' ? '✅' : o.status === 'Pending' ? '🟡' : o.status === 'Cancelled' ? '❌' : '🔵';
      return `${i + 1}\\. ${icon} ${user} — *${product}* — \`${price(o.amount)}\``;
    });
    await ctx.reply(`📦 *Recent Orders (${orders.length})*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  });

  // ── Broadcast ──────────────────────────────────────────────────────────────
  bot.command('broadcast', adminOnly(), (ctx) => ctx.scene.enter('broadcast_scene'));

  // ── Audit log refresh ──────────────────────────────────────────────────────
  bot.action('audit_refresh', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(10);
    if (!logs.length) return ctx.editMessageText('📋 No audit log entries yet.').catch(() => ctx.reply('📋 No entries yet.'));
    const lines = logs.map((l, i) => {
      const ts = new Date(l.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Rangoon' });
      const target = l.targetId ? ` → \`${l.targetId}\`` : '';
      return `${i + 1}\\. \`${l.action}\`${target}\n   _${ts} MMT_`;
    });
    await ctx.editMessageText(`📋 *Recent Audit Logs*\n\n${lines.join('\n\n')}`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔄 Refresh', 'audit_refresh'), Markup.button.callback('🔙 Back', 'nav:go:admin_main')]]),
    }).catch(() => {});
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
