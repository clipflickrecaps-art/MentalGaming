/**
 * /start command — main entry point, deep-link handler, and join attribution.
 *
 * Deep-link payloads:
 *   ref_CODE       → referral join    (joinSource='referral', joinRef=code)
 *   channel_MSGID  → from channel post (joinSource='channel', joinRef=msgId)
 *   product_ID     → product share link (joinSource='share', joinRef=productId)
 *   (none)         → direct start    (joinSource='direct')
 *
 * Attribution is written ONCE on first join — never overwritten on re-visits.
 */

const { Markup }           = require('telegraf');
const { mainMenuKeyboard } = require('../utils/keyboard');
const { registerReferral } = require('../services/ReferralService');
const SystemStatus          = require('../models/SystemStatus');
const User                  = require('../models/User');
const Product               = require('../models/Product');

// ── Attribution helper ────────────────────────────────────────────────────────

async function setJoinSourceOnce(telegramId, source, ref) {
  // Only set if joinSource is still 'unknown' (first join)
  await User.updateOne(
    { telegramId, joinSource: 'unknown' },
    { $set: { joinSource: source, joinRef: ref || null } }
  );
}

// ── Visual referral notice ────────────────────────────────────────────────────

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

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = function registerStart(bot) {

  bot.start(async (ctx) => {
    const name    = ctx.from.first_name || ctx.from.username || 'there';
    const tier    = ctx.user?.membershipTier || 'Silver';
    const payload = ctx.startPayload;

    let referralNotice = '';
    let extraNote      = '';

    // ── Referral deep link: ref_CODE ────────────────────────────────────────
    if (payload?.startsWith('ref_')) {
      const refCode = payload.slice(4);
      await setJoinSourceOnce(ctx.from.id, 'referral', refCode);

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
        console.error('[Start] Referral register error:', err.message);
      }
    }

    // ── Channel deep link: channel_MSGID ────────────────────────────────────
    else if (payload?.startsWith('channel_')) {
      const msgId = payload.slice(8);
      await setJoinSourceOnce(ctx.from.id, 'channel', msgId);
      extraNote = `\n📢 _Welcome from our channel!_\n`;
    }

    // ── Product share link: product_PRODUCTID ────────────────────────────────
    else if (payload?.startsWith('product_')) {
      const productId = payload.slice(8);
      await setJoinSourceOnce(ctx.from.id, 'share', productId);

      try {
        const product = await Product.findById(productId);
        if (product) {
          const { price: finalPrice } = product.getEffectivePrice();
          extraNote =
            `\n🎮 *You were directed here for:*\n` +
            `📦 *${product.name}* — ${finalPrice.toLocaleString()} KS\n` +
            `_Tap /shop to order!_\n`;
        }
      } catch {}
    }

    // ── Direct start ─────────────────────────────────────────────────────────
    else {
      await setJoinSourceOnce(ctx.from.id, 'direct', null);
    }

    const tierBadge = { Silver: '🥈', Gold: '🥇', Platinum: '💎' };
    const badge = tierBadge[tier] || '🥈';

    await ctx.reply(
      `👋 Welcome to *Mental Gaming Store*, ${name}!\n\n` +
      `🎮 Your go-to store for game credits, top-ups, and gift cards.\n` +
      `${badge} Membership Tier: *${tier}*\n` +
      referralNotice +
      extraNote +
      `Use the menu below to get started:`,
      {
        parse_mode: 'Markdown',
        ...mainMenuKeyboard(),
      }
    );
  });
};
