const { adminOnly } = require('../middlewares/adminCheck');
const { adminMenuKeyboard } = require('../utils/keyboard');
const { fetchLiveRates, getAllRates } = require('../services/currencyService');
const { auditLog } = require('../services/logger');
const { listUsers } = require('../services/UserManagementService');
const { Markup } = require('telegraf');

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
