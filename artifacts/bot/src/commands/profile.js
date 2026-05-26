/**
 * Profile Command — Membership dashboard with tier progress, discount, streak
 */

const Nav = require('../services/NavigationService');
const { buildMessage, price, formatDate } = require('../utils/ui');
const { getCoinBonusRates } = require('../services/WalletService');
const { getTierProgress, getTierConfig, formatProgressBar } = require('../services/MembershipService');
const { Markup } = require('telegraf');
const { mainMenuKeyboard } = require('../utils/keyboard');
const { t } = require('../utils/i18n');
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
      return { text: t(ctx, 'profile.load_failed'), keyboard: mainMenuKeyboard(ctx) };
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
        t(ctx, 'profile.tier_progress'),
        `${cfg.badge} → ${tierCfg[progress.nextTier].badge}`,
        `\`${bar}\``,
        `_${progress.message}_`,
      ];
    } else {
      progressLines = [``, t(ctx, 'profile.max_tier')];
    }

    const restrictionLine = user.restrictedRights?.length > 0
      ? `⛔ ${t(ctx, 'profile.restrictions')}: ${user.restrictedRights.join(', ')}`
      : null;

    const restrictionUntilLine = user.restrictedUntil && new Date() < new Date(user.restrictedUntil)
      ? `⏳ ${t(ctx, 'profile.lifted')}: ${formatDate(user.restrictedUntil)}`
      : null;

    const discountPct = cfg?.discount || 0;
    const discountLine = discountPct > 0
      ? `🏷 ${t(ctx, 'profile.discount_label')}: *${discountPct}%* ${t(ctx, 'profile.discount_off')}`
      : `🏷 ${t(ctx, 'profile.discount_label')}: ${t(ctx, 'profile.discount_none')}`;

    const dayWord = streak !== 1 ? t(ctx, 'common.days') : t(ctx, 'common.day');

    const lines = [
      `${theme.emoji.user} ${user.username ? `@${user.username}` : t(ctx, 'profile.no_username')}`,
      `🆔 ${t(ctx, 'profile.id')}: ${theme.format.code(String(user.telegramId))}`,
      `${theme.emoji.star} ${t(ctx, 'wallet.tier')}: ${theme.format.bold(tierBadge(tier))}`,
      ``,
      `${theme.emoji.money} ${t(ctx, 'wallet.ks_balance')}: ${theme.format.bold(price(balanceKS))}`,
      `${theme.emoji.coin} ${t(ctx, 'wallet.coins')}: ${theme.format.bold(balanceCoin.toLocaleString() + ' MC')}`,
      `💼 ${t(ctx, 'wallet.total_deposited')}: ${price(deposited)}`,
      `🎁 ${t(ctx, 'wallet.bonus_rate')}: +${bonusPct}%`,
      discountLine,
      ``,
      `🔥 ${t(ctx, 'profile.streak')}: *${streak} ${dayWord}*`,
      `📅 ${t(ctx, 'profile.total_checkins')}: *${user.totalCheckIns || 0}*`,
      ...progressLines,
      ``,
      `⚠️ ${t(ctx, 'profile.warnings')}: ${user.warningsCount || 0}/3`,
      restrictionLine,
      restrictionUntilLine,
      `📅 ${t(ctx, 'profile.joined')}: ${formatDate(user.joinDate)}`,
    ].filter(Boolean);

    lines.push(``);
    lines.push(`_${t(ctx, 'common.commands')}:_`);
    lines.push(`• ${t(ctx, 'wallet.cmd_topup')}`);
    lines.push(`• ${t(ctx, 'wallet.cmd_history')}`);
    lines.push(`• ${t(ctx, 'profile.cmd_progress')}`);
    lines.push(`• ${t(ctx, 'profile.cmd_settings')}`);

    const text = buildMessage(theme, [{ title: t(ctx, 'profile.title'), lines }]);

    return { text, keyboard: mainMenuKeyboard(ctx) };
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

  await ctx.reply(text + '\n\n_Use /topup to add funds._', { parse_mode: 'Markdown' });
}

module.exports = function registerProfile(bot) {
  bot.command('profile', async (ctx) => {
    await Nav.navigate(ctx, 'profile_view');
  });

  bot.hears(['👤 My Profile', '👤 ပရိုဖိုင်'], async (ctx) => {
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
