const { adminOnly } = require('../middlewares/adminCheck');
const { adminMenuKeyboard } = require('../utils/keyboard');
const { fetchLiveRates, getAllRates } = require('../services/currencyService');
const { auditLog } = require('../services/logger');
const { Markup } = require('telegraf');

module.exports = function registerAdmin(bot) {
  bot.command('admin', adminOnly(), async (ctx) => {
    await ctx.reply('🔧 *Admin Panel* — Mental Gaming Store', {
      parse_mode: 'Markdown',
      ...adminMenuKeyboard(),
    });
  });

  bot.hears('💱 Manage Rates', adminOnly(), async (ctx) => {
    await ctx.scene.enter('rate_manager');
  });

  bot.command('managerates', adminOnly(), async (ctx) => {
    await ctx.scene.enter('rate_manager');
  });

  bot.command('rates', adminOnly(), async (ctx) => {
    const rates = await getAllRates();
    if (!rates.length) return ctx.reply('No exchange rates stored yet. Use /managerates to add some.');

    const lines = rates
      .map((r) => `• *${r.currencyCode}*: \`${parseFloat(r.rateToMMK.toFixed(4))}\` MMK  _(${r.source})_`)
      .join('\n');

    await ctx.reply(`💱 *Current Exchange Rates*\n\n${lines}`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('✏️ Update Rates', 'open_rate_manager')]]),
    });
  });

  bot.action('open_rate_manager', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('rate_manager');
  });

  bot.command('fetchrates', adminOnly(), async (ctx) => {
    const msg = await ctx.reply('⏳ Fetching live exchange rates from API...');
    try {
      const updates = await fetchLiveRates();
      const lines = updates.map((u) => `• *${u.code}*: \`${u.rateToMMK}\` MMK`).join('\n');
      await auditLog(ctx.from.id, 'FETCH_LIVE_RATES', null, 'Currency', { updates });
      await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
      await ctx.reply(
        `✅ *Live Rates Fetched*\n\n${lines}\n\n_Suggested prices calculated. Use /managerates → Approve All to apply._`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      await ctx.reply(`❌ Failed to fetch live rates: ${err.message}`);
    }
  });

  bot.on('message', async (ctx, next) => {
    if (ctx.session?.rm_manual_product && ctx.message?.text) {
      const price = parseInt(ctx.message.text.trim(), 10);
      if (isNaN(price) || price <= 0) {
        return ctx.reply('❌ Invalid price. Enter a positive integer.');
      }

      const { setManualPrice } = require('../services/PriceCalculator');
      try {
        const product = await setManualPrice(ctx.session.rm_manual_product, price);
        await auditLog(ctx.from.id, 'SET_MANUAL_PRICE', product._id.toString(), 'Product', { price });
        ctx.session.rm_manual_product = null;
        return ctx.reply(
          `✅ *${product.name}* set to manual price: \`${price.toLocaleString()} KS\`\n_This product will be skipped by the auto-calculator._`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        return ctx.reply(`❌ Error: ${err.message}`);
      }
    }
    return next();
  });
};
