/**
 * Profile Command — Membership dashboard with tier progress, discount, streak
 */

const Nav = require('../services/NavigationService');
const { buildMessage, price, formatDate } = require('../utils/ui');
const { getCoinBonusRates } = require('../services/WalletService');
const { getTierProgress, getTierConfig, formatProgressBar } = require('../services/MembershipService');
const { Markup } = require('telegraf');
const User = require('../models/User');

function tierBadge(tier) {
  const map = { Silver: '🥈 Silver', Gold: '🥇 Gold', Platinum: '💎 Platinum' };
  return map[tier] || tier;
}

Nav.register({
  id: 'profile_view',
  title: '👤 My Profile',
  build: async (ctx, theme) => {
    // Fallback to direct DB lookup if middleware didn't attach user
    const user = ctx.user || (ctx.from?.id ? await User.findByTelegramId(ctx.from.id) : null);
    if (!user) {
      return {
        text: '❌ Could not load profile. Please tap the button below to try again.',
        keyboard: Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Retry', 'nav:go:profile_view')],
          Nav.backButton('🔙 Main Menu'),
        ]),
      };
    }

    const balanceKS   = user.balanceKS   || 0;
    const balanceCoin = user.balanceCoin  || 0;
    const deposited   = user.totalDeposited || 0;
    const tier        = user.membershipTier || 'Silver';
    const tierCfg     = await getTierConfig();
    const bonusRates  = await getCoinBonusRates();
    const bonusPct    = Math.round((bonusRates[tier] || 0.01) * 100 * 10) / 10;
    const cfg         = tierCfg[tier];
    const streak      = user.checkInStreak || 0;

    const progress = await getTierProgress(user.telegramId);
    let progressLines = [];
    if (progress && progress.nextTier) {
      const bar = `[${formatProgressBar(progress.progressPct / 100)}] ${progress.progressPct}%`;
      progressLines = [
        ``,
        `📈 *Tier Progress:*`,
        `${cfg.badge} → ${tierCfg[progress.nextTier].badge}`,
        `\`${bar}\``,
        `_${progress.message}_`,
      ];
    } else {
      progressLines = [``, `🏆 *MAX TIER — Platinum!*`];
    }

    const restrictionLine = user.restrictedRights?.length > 0
      ? `⛔ Restrictions: ${user.restrictedRights.join(', ')}`
      : null;

    const restrictionUntilLine = user.restrictedUntil && new Date() < new Date(user.restrictedUntil)
      ? `⏳ Lifted: ${formatDate(user.restrictedUntil)}`
      : null;

    const discountPct = cfg?.discount || 0;
    const discountLine = discountPct > 0
      ? `🏷 Tier Discount: *${discountPct}% off* all products`
      : '🏷 Tier Discount: None (Silver)';

    const lines = [
      `${theme.emoji.user} ${user.username ? `@${user.username}` : 'No username'}`,
      `🆔 ID: ${theme.format.code(String(user.telegramId))}`,
      `${theme.emoji.star} Tier: ${theme.format.bold(tierBadge(tier))}`,
      ``,
      `${theme.emoji.money} KS Balance: ${theme.format.bold(price(balanceKS))}`,
      `${theme.emoji.coin} Mental Coins: ${theme.format.bold(balanceCoin.toLocaleString() + ' MC')}`,
      `💼 Total Deposited: ${price(deposited)}`,
      `🎁 Coin Bonus Rate: +${bonusPct}%`,
      discountLine,
      ``,
      `🔥 Check-In Streak: *${streak} day${streak !== 1 ? 's' : ''}*`,
      `📅 Total Check-Ins: *${user.totalCheckIns || 0}*`,
      ...progressLines,
      ``,
      `⚠️ Warnings: ${user.warningsCount || 0}/3`,
      restrictionLine,
      restrictionUntilLine,
      `📅 Joined: ${formatDate(user.joinDate)}`,
    ].filter(Boolean);

    const text = buildMessage(theme, [{ title: '👤 My Profile', lines }]);

    return {
      text,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('💳 Top Up', 'start_topup'), Markup.button.callback('📜 History', 'wallet_history')],
        [Markup.button.callback('📊 Tier Progress', 'profile_progress'), Markup.button.callback('⚙️ Settings', 'nav:go:settings_view')],
        Nav.backButton('🔙 Main Menu'),
      ]),
    };
  },
});

// ── Progress view ─────────────────────────────────────────────────────────────
async function sendProgressView(ctx) {
  const user = await User.findByTelegramId(ctx.from.id);
  if (!user) return ctx.reply('❌ Please /start first.');

  const progress = await getTierProgress(user.telegramId);
  if (!progress) return ctx.reply('❌ Could not load progress.');

  const tierCfg = await getTierConfig();
  const tier    = user.membershipTier;
  const cfg     = tierCfg[tier];

  let text;
  if (!progress.nextTier) {
    text =
      `💎 *Platinum Member — MAX TIER*\n\n` +
      `You've reached the highest tier!\n\n` +
      `${cfg.badge} Active Benefits:\n` +
      `  🏷 *${cfg.discount}% discount* on all products\n` +
      `  🪙 *${Math.round((cfg.bonusRate || 0.02) * 100)}% Mental Coin bonus* on top-ups\n` +
      `  💎 Platinum badge`;
  } else {
    const nextCfg = tierCfg[progress.nextTier];
    const bar = `[${formatProgressBar(progress.progressPct / 100)}] ${progress.progressPct}%`;
    text =
      `📊 *Tier Progress*\n\n` +
      `Current Tier: ${cfg.badge} *${tier}*\n` +
      `Next Tier:    ${nextCfg.badge} *${progress.nextTier}*\n\n` +
      `\`${bar}\`\n\n` +
      `💼 Deposited: *${user.totalDeposited.toLocaleString()} KS*\n` +
      `🎯 Target: *${nextCfg.min.toLocaleString()} KS*\n\n` +
      `💡 ${progress.message}\n\n` +
      `*${progress.nextTier} Benefits:*\n` +
      `  🏷 *${nextCfg.discount}% discount* on all products\n` +
      `  🪙 *${Math.round((nextCfg.bonusRate || 0.015) * 100 * 10) / 10}% coin bonus* on top-ups`;
  }

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('💳 Top Up to Progress', 'start_topup')],
      [Markup.button.callback('🔙 Back to Profile', 'nav:go:profile_view')],
    ]),
  });
}

module.exports = function registerProfile(bot) {
  bot.command('profile', async (ctx) => {
    await Nav.navigate(ctx, 'profile_view');
  });

  bot.hears('👤 My Profile', async (ctx) => {
    await Nav.navigate(ctx, 'profile_view');
  });

  bot.command('progress', async (ctx) => {
    await sendProgressView(ctx);
  });

  bot.action('profile_progress', async (ctx) => {
    await ctx.answerCbQuery();
    await sendProgressView(ctx);
  });
};
