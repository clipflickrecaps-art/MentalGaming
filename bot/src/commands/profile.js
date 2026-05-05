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
    const user = ctx.user || (ctx.from?.id ? await User.findOrCreate(ctx.from.id, ctx.from.username, ctx.from.first_name) : null);
    if (!user) {
      return {
        text: '❌ Could not load profile. Please tap retry.',
        keyboard: Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Retry', 'nav:go:profile_view')],
          Nav.backButton('🔙 Main Menu'),
        ]),
      };
    }

    const progress = await getTierProgress(user.telegramId);
    const tierCfg  = await getTierConfig();
    const tier     = progress?.tier || user.membershipTier || 'Silver';
    const cfg      = tierCfg[tier] || { badge: '⭐', discount: 0, bonusRate: 0 };
    const nextText = progress?.nextTier
      ? `${progress.nextBadge || '⭐'} ${progress.nextTier} • ${progress.ksToNext.toLocaleString()} KS left`
      : '🏆 Max tier reached';

    const lines = [
      `${cfg.badge || '👤'} ${user.username ? `@${user.username}` : (user.first_name || 'Player')}`,
      `🆔 ${theme.format.code(String(user.telegramId))}`,
      ``,
      `${theme.emoji.money} Balance: ${theme.format.bold(price(user.balanceKS || 0))}`,
      `${theme.emoji.coin} Coins: ${theme.format.bold((user.balanceCoin || 0).toLocaleString() + ' MC')}`,
      `${theme.emoji.star} Tier: ${theme.format.bold(`${cfg.badge || ''} ${tier}`.trim())}`,
      `🔥 Check-In: ${theme.format.bold(`${user.checkInStreak || 0} day${(user.checkInStreak || 0) === 1 ? '' : 's'}`)}`,
      ``,
      `📈 Next: ${nextText}`,
    ];

    const text = buildMessage(theme, [{ title: '👤 My Profile', lines }]);

    return {
      text,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('💳 Top Up', 'start_topup'), Markup.button.callback('📜 History', 'wallet_history')],
        [Markup.button.callback('📊 Tier Details', 'profile_progress'), Markup.button.callback('🎁 Check-In Stats', 'profile_checkin_stats')],
        [Markup.button.callback('⚙️ Settings', 'nav:go:settings_view')],
        Nav.backButton('🔙 Main Menu'),
      ]),
    };
  },
});

async function sendCheckInStats(ctx) {
  const user = await User.findOrCreate(ctx.from.id, ctx.from.username, ctx.from.first_name);
  if (!user) return ctx.reply('❌ Could not load check-in stats.');
  const text =
    `🎁 *Check-In Stats*\n\n` +
    `🔥 Current Streak: *${user.checkInStreak || 0} day${(user.checkInStreak || 0) === 1 ? '' : 's'}*\n` +
    `🏆 Longest Streak: *${user.longestStreak || 0} day${(user.longestStreak || 0) === 1 ? '' : 's'}*\n` +
    `📅 Total Check-Ins: *${user.totalCheckIns || 0}*\n` +
    `🗓 Last Check-In: *${user.lastCheckInDate || 'Never'}*`;
  return ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back to Profile', 'nav:go:profile_view')]]) });
}

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

  bot.hears(/^👤\s*My Profile$/i, async (ctx) => {
    await Nav.navigate(ctx, 'profile_view');
  });

  bot.command('progress', async (ctx) => {
    await sendProgressView(ctx);
  });

  bot.action('profile_progress', async (ctx) => {
    await ctx.answerCbQuery();
    await sendProgressView(ctx);
  });

  bot.action('profile_checkin_stats', async (ctx) => {
    await ctx.answerCbQuery();
    await sendCheckInStats(ctx);
  });
};
