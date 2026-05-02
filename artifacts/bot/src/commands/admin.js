const { adminOnly } = require('../middlewares/adminCheck');
const { adminMenuKeyboard } = require('../utils/keyboard');
const { fetchLiveRates, manualSetRate } = require('../services/currencyService');
const { auditLog } = require('../services/logger');

module.exports = function registerAdmin(bot) {
  bot.command('admin', adminOnly(), async (ctx) => {
    await ctx.reply('🔧 *Admin Panel* — Mental Gaming Store', {
      parse_mode: 'Markdown',
      ...adminMenuKeyboard(),
    });
  });

  bot.command('updaterates', adminOnly(), async (ctx) => {
    await ctx.reply('⏳ Fetching live exchange rates...');
    try {
      const updates = await fetchLiveRates();
      const msg = updates.map((u) => `${u.code}: ${u.rateToMMK} MMK`).join('\n');
      await auditLog(ctx.from.id, 'UPDATE_RATES', null, 'Currency');
      await ctx.reply(`✅ Exchange rates updated:\n\n${msg}`);
    } catch {
      await ctx.reply('❌ Failed to fetch live rates. Try again later.');
    }
  });

  bot.command('setrate', adminOnly(), async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) {
      return ctx.reply('Usage: /setrate <CURRENCY_CODE> <RATE_TO_MMK>\nExample: /setrate BRL 500');
    }

    const [code, rateStr] = args;
    const rate = parseFloat(rateStr);

    if (isNaN(rate) || rate <= 0) {
      return ctx.reply('❌ Invalid rate. Provide a positive number.');
    }

    try {
      await manualSetRate(code.toUpperCase(), rate);
      await auditLog(ctx.from.id, 'SET_RATE_MANUAL', null, 'Currency', { code, rate });
      await ctx.reply(`✅ Rate set: 1 ${code.toUpperCase()} = ${rate} MMK`);
    } catch (err) {
      await ctx.reply(`❌ Error: ${err.message}`);
    }
  });
};
