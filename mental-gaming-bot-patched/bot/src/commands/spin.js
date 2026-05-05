const { adminOnly } = require('../middlewares/adminCheck');
const { checkRestrictions } = require('../middlewares/checkRestrictions');
const { canFreeSpinToday, nextFreeSpinIn, getRuntimePrizePool, getSpinCostCoins } = require('../services/GameService');
const { formatCountdown } = require('../services/FlashSaleService');
const { price } = require('../utils/ui');
const User = require('../models/User');

module.exports = function registerSpin(bot) {

  bot.command('spin', checkRestrictions('spin'), async (ctx) => {
    await ctx.scene.enter('spin_wheel_scene');
  });

  bot.hears('🎰 Spin Wheel', checkRestrictions('spin'), async (ctx) => {
    await ctx.scene.enter('spin_wheel_scene');
  });

  // Inline button handler for main menu spin button
  bot.action('spin_wheel_start', checkRestrictions('spin'), async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('spin_wheel_scene');
  });

  bot.command('spininfo', async (ctx) => {
    const user = await User.findByTelegramId(ctx.from.id);
    if (!user) return ctx.reply('❌ User not found.');

    const freeSpin = canFreeSpinToday(user);
    const msToNext = freeSpin ? 0 : nextFreeSpinIn(user);
    const pool = await getRuntimePrizePool();
    const spinCost = await getSpinCostCoins();
    const lines = pool.map((p) => `• ${p.label}`);

    await ctx.reply(
      `🎰 *Spin Wheel Rewards*\n\n` +
      `🆓 Free spin: ${freeSpin ? '✅ Available now!' : `⏳ ${formatCountdown(msToNext)}`}\n` +
      `🪙 Paid spin cost: *${spinCost} Mental Coins*\n` +
      `💰 Your KS: *${price(user.balanceKS)}*\n` +
      `🪙 Your Coins: *${user.balanceCoin.toLocaleString()} MC*\n\n` +
      `*Possible Rewards:*\n${lines.join('\n')}\n\n` +
      `_Tap /spin to play!_`,
      { parse_mode: 'Markdown' }
    );
  });
};
