const { mainMenuKeyboard } = require('../utils/keyboard');
const { registerReferral } = require('../services/ReferralService');
const { REFEREE_BONUS_KS, REFEREE_BONUS_COINS } = require('../services/ReferralService');
const User = require('../models/User');

module.exports = function registerStart(bot) {
  bot.start(async (ctx) => {
    const name = ctx.from.first_name || ctx.from.username || 'there';
    const tier = ctx.user?.membershipTier || 'Silver';

    // ── Detect referral deep link: /start ref_XXXXX ──────────────────────
    const payload = ctx.startPayload; // text after /start
    let referralNotice = '';

    if (payload && payload.startsWith('ref_')) {
      const refCode = payload.slice(4); // strip "ref_"
      try {
        const user = await User.findByTelegramId(ctx.from.id);
        if (user) {
          const result = await registerReferral(user._id, refCode);
          if (result) {
            referralNotice =
              `\n🎁 *Referred by a friend!* Make your first top-up to claim *${REFEREE_BONUS_KS.toLocaleString()} KS + ${REFEREE_BONUS_COINS} MC* welcome bonus!\n`;
          }
        }
      } catch (err) {
        console.error('[Start] Referral register error:', err.message);
      }
    }

    await ctx.reply(
      `👋 Welcome to *Mental Gaming Store*, ${name}!\n\n` +
        `🎮 Your go-to store for game credits, top-ups, and gift cards.\n` +
        `💳 Membership Tier: *${tier}*\n` +
        referralNotice +
        `\nUse the menu below to get started:`,
      {
        parse_mode: 'Markdown',
        ...mainMenuKeyboard(),
      }
    );
  });
};
