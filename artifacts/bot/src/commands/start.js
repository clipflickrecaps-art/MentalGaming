/**
 * /start command — main entry point + deep-link referral handler.
 *
 * Deep link format: t.me/mentalgamingstorebot?start=ref_CODE
 *
 * On referral click:
 *   - Registers the referral (with fraud detection)
 *   - Shows a rich welcome message with bonus information
 *   - Shows visual invite notice so the user knows who referred them
 */

const { mainMenuKeyboard } = require('../utils/keyboard');
const { registerReferral }  = require('../services/ReferralService');
const SystemStatus           = require('../models/SystemStatus');
const User                   = require('../models/User');

// ── Visual share message builder (used by /reflink too) ──────────────────────

function buildInviteNotice(referrerName, welcomeKS, welcomeCoins) {
  return (
    `\n` +
    `\`┌─────────────────────────┐\`\n` +
    `\`│  🎁  REFERRAL BONUS      │\`\n` +
    `\`└─────────────────────────┘\`\n` +
    `You were invited by *${referrerName}*!\n\n` +
    `Make your *first top-up* to claim:\n` +
    `  💰 *+${welcomeKS.toLocaleString()} KS* welcome bonus\n` +
    `  🪙 *+${welcomeCoins} Mental Coins*\n\n`
  );
}

module.exports = function registerStart(bot) {

  bot.start(async (ctx) => {
    const name    = ctx.from.first_name || ctx.from.username || 'there';
    const tier    = ctx.user?.membershipTier || 'Silver';
    const payload = ctx.startPayload; // text after /start (e.g. "ref_ABC123")

    let referralNotice = '';

    // ── Handle referral deep link ────────────────────────────────────────────
    if (payload && payload.startsWith('ref_')) {
      const refCode = payload.slice(4); // strip "ref_"
      try {
        const [user, status] = await Promise.all([
          User.findByTelegramId(ctx.from.id),
          SystemStatus.get(),
        ]);

        if (user && status.referralEnabled) {
          const result = await registerReferral(user._id, refCode, ctx.telegram);

          if (result) {
            const referrerName = result.referrer.username
              ? `@${result.referrer.username}`
              : result.referrer.first_name || 'a friend';

            const welcomeKS    = status.referralWelcomeBonusKS    || 200;
            const welcomeCoins = status.referralWelcomeBonusCoins || 50;

            referralNotice = buildInviteNotice(referrerName, welcomeKS, welcomeCoins);
          }
        }
      } catch (err) {
        // Non-fatal — don't break /start for fraud or edge cases
        console.error('[Start] Referral register error:', err.message);
      }
    }

    const tierBadge = { Silver: '🥈', Gold: '🥇', Platinum: '💎' };
    const badge = tierBadge[tier] || '🥈';

    await ctx.reply(
      `👋 Welcome to *Mental Gaming Store*, ${name}!\n\n` +
      `🎮 Your go-to store for game credits, top-ups, and gift cards.\n` +
      `${badge} Membership Tier: *${tier}*\n` +
      referralNotice +
      `Use the menu below to get started:`,
      {
        parse_mode: 'Markdown',
        ...mainMenuKeyboard(),
      }
    );
  });
};
