/**
 * Referral Command
 *
 * /referral  — show stats, link, and prize info
 * /reflink   — quick shareable link
 * /reflead   — top referrers leaderboard (public)
 * /refstats  — admin: full referral statistics
 */

const { Markup } = require('telegraf');
const { adminOnly } = require('../middlewares/adminCheck');
const {
  getOrCreateCode,
  getReferralLink,
  getStats,
  getLeaderboard,
  REFERRER_BONUS_KS,
  REFERRER_BONUS_COINS,
  REFEREE_BONUS_KS,
  REFEREE_BONUS_COINS,
} = require('../services/ReferralService');
const { price } = require('../utils/ui');
const Referral = require('../models/Referral');
const User = require('../models/User');

module.exports = function registerReferral(bot) {

  // ── /referral — full referral dashboard ──────────────────────────────────
  bot.command('referral', async (ctx) => {
    try {
      const stats = await getStats(ctx.from.id);

      const tierBadge = { Silver: '🥈', Gold: '🥇', Platinum: '💎' };
      const user = await User.findByTelegramId(ctx.from.id);
      const badge = tierBadge[user?.membershipTier] || '🥈';

      const recentLines = stats.recentReferrals.length
        ? stats.recentReferrals.map((r) => {
            const statusDot = r.status === 'Completed' ? '✅' : '⏳';
            const tag = r.refereeId?.username ? `@${r.refereeId.username}` : `User`;
            return `  ${statusDot} ${tag}`;
          }).join('\n')
        : '  _No referrals yet_';

      const text =
        `🔗 *Referral Program*\n\n` +
        `*Your Referral Link:*\n` +
        `\`${stats.link}\`\n\n` +
        `📊 *Your Stats:*\n` +
        `👥 Total Referrals: *${stats.total}*\n` +
        `✅ Completed (Bonuses Paid): *${stats.completed}*\n` +
        `⏳ Pending (Joined, Not Topped Up): *${stats.pending}*\n` +
        `💰 Total Earned: *${price(stats.totalKSEarned)}*\n` +
        `🪙 Coins Earned: *${stats.totalCoinsEarned.toLocaleString()} MC*\n\n` +
        `*Recent Referrals:*\n${recentLines}\n\n` +
        `🎁 *Reward Structure:*\n` +
        `  You earn: *${price(REFERRER_BONUS_KS)} + ${REFERRER_BONUS_COINS} MC* per referral\n` +
        `  Friend gets: *${price(REFEREE_BONUS_KS)} + ${REFEREE_BONUS_COINS} MC* welcome bonus\n\n` +
        `_Bonus is paid when your friend makes their first top-up!_`;

      await ctx.reply(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url('📤 Share My Link', `https://t.me/share/url?url=${encodeURIComponent(stats.link)}&text=${encodeURIComponent('Join Mental Gaming Store and get a welcome bonus! 🎮')}`)],
          [Markup.button.callback('🏆 Leaderboard',  'ref_leaderboard')],
          [Markup.button.callback('🔄 Refresh Stats', 'ref_refresh')],
        ]),
      });
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  // ── /reflink — quick link only ────────────────────────────────────────────
  bot.command('reflink', async (ctx) => {
    try {
      const code = await getOrCreateCode(ctx.from.id);
      const link = getReferralLink(code);

      await ctx.reply(
        `🔗 *Your Referral Link*\n\n` +
        `\`${link}\`\n\n` +
        `Share this with friends.\n` +
        `You earn *${price(REFERRER_BONUS_KS)}* when they top up!`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.url('📤 Share', `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Join Mental Gaming Store! 🎮 Use my link for a welcome bonus!')}`)],
          ]),
        }
      );
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  // ── /reflead — public leaderboard ─────────────────────────────────────────
  bot.command('reflead', async (ctx) => {
    const board = await getLeaderboard(10);
    if (!board.length) return ctx.reply('🏆 No referrals completed yet. Be the first!');

    const medal = ['🥇', '🥈', '🥉'];
    const lines = board.map((entry, i) => {
      const tag = entry.user.username ? `@${entry.user.username}` : `User ${entry.user.telegramId}`;
      const m = medal[i] || `${i + 1}.`;
      return `${m} ${tag} — *${entry.count}* referrals — ${price(entry.totalKS)} earned`;
    });

    await ctx.reply(
      `🏆 *Referral Leaderboard*\n\n${lines.join('\n')}\n\n` +
      `_Share your link with /reflink to climb the ranks!_`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Action: leaderboard inline ────────────────────────────────────────────
  bot.action('ref_leaderboard', async (ctx) => {
    await ctx.answerCbQuery();
    const board = await getLeaderboard(10);
    if (!board.length) return ctx.reply('🏆 No completed referrals yet!');

    const medal = ['🥇', '🥈', '🥉'];
    const lines = board.map((entry, i) => {
      const tag = entry.user.username ? `@${entry.user.username}` : `User ${entry.user.telegramId}`;
      const m = medal[i] || `${i + 1}.`;
      return `${m} ${tag} — *${entry.count}* referrals — ${price(entry.totalKS)} earned`;
    });

    await ctx.reply(
      `🏆 *Referral Leaderboard*\n\n${lines.join('\n')}`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Action: refresh stats ─────────────────────────────────────────────────
  bot.action('ref_refresh', async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');
    const stats = await getStats(ctx.from.id);
    await ctx.editMessageText(
      `🔄 *Refreshed!*\n\n` +
      `✅ Completed: *${stats.completed}* | ⏳ Pending: *${stats.pending}*\n` +
      `💰 Total Earned: *${price(stats.totalKSEarned)}*`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Admin: /refstats ──────────────────────────────────────────────────────
  bot.command('refstats', adminOnly(), async (ctx) => {
    const [total, completed, pending] = await Promise.all([
      Referral.countDocuments({}),
      Referral.countDocuments({ status: 'Completed' }),
      Referral.countDocuments({ status: 'Pending' }),
    ]);

    const totalKSPaid = completed * (REFERRER_BONUS_KS + REFEREE_BONUS_KS);
    const board = await getLeaderboard(5);

    const topLines = board.map((e, i) => {
      const tag = e.user.username ? `@${e.user.username}` : `ID:${e.user.telegramId}`;
      return `  ${i + 1}. ${tag} — ${e.count} refs`;
    }).join('\n') || '  _None yet_';

    await ctx.reply(
      `📊 *Referral System Stats*\n\n` +
      `👥 Total Referrals: *${total}*\n` +
      `✅ Completed: *${completed}*\n` +
      `⏳ Pending: *${pending}*\n` +
      `💰 Total KS Paid Out: *${price(totalKSPaid)}*\n\n` +
      `🏆 *Top 5 Referrers:*\n${topLines}`,
      { parse_mode: 'Markdown' }
    );
  });
};
