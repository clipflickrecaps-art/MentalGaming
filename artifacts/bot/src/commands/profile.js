/**
 * Profile Command — Membership dashboard with tier progress, discount, streak
 *
 * /profile      — full profile view via NavigationService
 * /progress     — focused tier progress bar + level-up info
 */

const Nav = require('../services/NavigationService');
const { buildMessage, price, formatDate } = require('../utils/ui');
const { COIN_BONUS_RATE } = require('../services/WalletService');
const { getTierProgress, TIER_CONFIG, formatProgressBar } = require('../services/MembershipService');
const { Markup } = require('telegraf');
const User = require('../models/User');

function tierBadge(tier) {
  const map = { Silver: '🥈 Silver', Gold: '🥇 Gold', Platinum: '💎 Platinum' };
  return map[tier] || tier;
}

function discountLine(tier) {
  const pct = TIER_CONFIG[tier]?.discount || 0;
  return pct > 0 ? `🏷 Tier Discount: *${pct}% off* all products` : '🏷 Tier Discount: None (Silver)';
}

Nav.register({
  id: 'profile_view',
  title: '👤 My Profile',
  build: async (ctx, theme) => {
    const user = ctx.user;
    if (!user) return { text: '❌ Could not load profile.', keyboard: Markup.inlineKeyboard([Nav.backButton()]) };

    const balanceKS   = user.balanceKS   || 0;
    const balanceCoin = user.balanceCoin  || 0;
    const deposited   = user.totalDeposited || 0;
    const tier        = user.membershipTier || 'Silver';
    const bonusPct    = Math.round((COIN_BONUS_RATE[tier] || 0.01) * 100 * 10) / 10;
    const cfg         = TIER_CONFIG[tier];
    const streak      = user.checkInStreak || 0;

    // Progress bar
    const progress = await getTierProgress(user.telegramId);
    let progressLines = [];
    if (progress && progress.nextTier) {
      const bar = `[${formatProgressBar(progress.progressPct / 100)}] ${progress.progressPct}%`;
      progressLines = [
        ``,
        `📈 *Tier Progress:*`,
        `${cfg.badge} → ${TIER_CONFIG[progress.nextTier].badge}`,
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

    const lines = [
      `${theme.emoji.user} ${user.username ? `@${user.username}` : 'No username'}`,
      `🆔 ID: ${theme.format.code(String(user.telegramId))}`,
      `${theme.emoji.star} Tier: ${theme.format.bold(tierBadge(tier))}`,
      ``,
      `${theme.emoji.money} KS Balance: ${theme.format.bold(price(balanceKS))}`,
      `${theme.emoji.coin} Mental Coins: ${theme.format.bold(balanceCoin.toLocaleString() + ' MC')}`,
      `💼 Total Deposited: ${price(deposited)}`,
      `🎁 Coin Bonus Rate: +${bonusPct}%`,
      discountLine(tier),
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

// ── Progress view (inline action) ────────────────────────────────────────────
async function sendProgressView(ctx) {
  const user = await User.findByTelegramId(ctx.from.id);
  if (!user) return ctx.reply('❌ Please /start first.');

  const progress = await getTierProgress(user.telegramId);
  if (!progress) return ctx.reply('❌ Could not load progress.');

  const tier    = user.membershipTier;
  const cfg     = TIER_CONFIG[tier];

  let text;
  if (!progress.nextTier) {
    text =
      `💎 *Platinum Member — MAX TIER*\n\n` +
      `You've reached the highest tier!\n\n` +
      `${cfg.badge} Active Benefits:\n` +
      `  🏷 *5% discount* on all products\n` +
      `  🪙 *2% Mental Coin bonus* on top-ups\n` +
      `  💎 Platinum badge`;
  } else {
    const nextCfg = TIER_CONFIG[progress.nextTier];
    const bar = `[${formatProgressBar(progress.progressPct / 100)}] ${progress.progressPct}%`;
    text =
      `📊 *Tier Progress*\n\n` +
      `Current Tier: ${cfg.badge} *${tier}*\n` +
      `Next Tier:    ${nextCfg.badge} *${progress.nextTier}*\n\n` +
      `\`${bar}\`\n\n` +
      `💼 Deposited: *${user.totalDeposited.toLocaleString()} KS*\n` +
      `🎯 Target: *${TIER_CONFIG[progress.nextTier].min.toLocaleString()} KS*\n\n` +
      `💡 ${progress.message}\n\n` +
      `*${progress.nextTier} Benefits:*\n` +
      (progress.nextTier === 'Gold'
        ? `  🏷 *2% discount* on all products\n  🪙 *1.5% coin bonus* on top-ups`
        : `  🏷 *5% discount* on all products\n  🪙 *2% coin bonus* on top-ups`);
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
