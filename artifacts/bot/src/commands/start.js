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
 *
 * Onboarding:
 *   First-time users (no deposits, no check-ins) are sent to OnboardingScene
 *   for a 3-step tour and a 100 MC welcome bonus.
 *
 * Seasonal branding:
 *   Welcome header is decorated by StyleService based on the active seasonal theme.
 */

const { Markup }             = require('telegraf');
const { registerReferral }   = require('../services/ReferralService');
const StyleService            = require('../services/StyleService');
const SystemStatus            = require('../models/SystemStatus');
const User                    = require('../models/User');
const Product                 = require('../models/Product');
const Nav                     = require('../services/NavigationService');
const { config }              = require('../../config/settings');

// ── Attribution helper ────────────────────────────────────────────────────────

async function setJoinSourceOnce(telegramId, source, ref) {
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

    // ── Detect brand-new user for onboarding ─────────────────────────────────
    const user = ctx.user;
    const isFirstTimer = user &&
      !user.onboardingDone &&
      (user.totalCheckIns   || 0) === 0 &&
      (user.totalDeposited  || 0) === 0 &&
      (user.balanceKS       || 0) === 0;

    if (isFirstTimer) {
      const season = await StyleService.getActiveSeason();
      await ctx.reply(
        StyleService.buildFirstTimeHeader(name, season) +
        (referralNotice ? `\n${referralNotice}` : ''),
        { parse_mode: 'Markdown' }
      );
      return ctx.scene.enter('onboarding');
    }

    // ── Send any deep-link notice ONLY (no duplicate welcome) ────────────────
    const notice = (extraNote || '') + (referralNotice || '');
    if (notice.trim()) {
      await ctx.reply(notice, { parse_mode: 'Markdown', ...Markup.removeKeyboard() });
    } else {
      // Clear any stale reply keyboard from older builds
      await ctx.reply('🔄', Markup.removeKeyboard())
        .then((m) => ctx.deleteMessage(m.message_id).catch(() => {}))
        .catch(() => {});
    }

    // ── Single panel: admin gets admin_main, everyone else gets main ─────────
    const isAdmin = Number(ctx.from.id) === Number(config.bot.adminId);
    return Nav.navigate(ctx, isAdmin ? 'admin_main' : 'main', false);
  });
};
