/**
 * Referral Command Suite
 *
 * User commands:
 *   /referral    — full dashboard with stats, link, and recent referrals
 *   /reflink     — quick shareable invite message
 *   /reflead     — public leaderboard (top 10 referrers)
 *
 * Admin commands (MANAGER+):
 *   /refstats    — global referral system stats
 *   /setcommission <rate> [first|every] [KS|Coin|Both]
 *                — e.g. /setcommission 3 every KS
 *   /refadjust <userId> <+/-amount> [note]
 *                — e.g. /refadjust 123456789 +500 manual compensation
 *   /reffraud    — list unresolved fraud flags
 */

const { Markup }  = require('telegraf');
const { requireRole, adminOnly } = require('../middlewares/adminCheck');
const {
  getOrCreateCode,
  getReferralLink,
  getStats,
  getLeaderboard,
  adminAdjustCommission,
} = require('../services/ReferralService');
const { registerFraudActions } = require('../services/FraudDetector');
const { auditLog }    = require('../services/logger');
const { price }       = require('../utils/ui');
const Referral        = require('../models/Referral');
const FraudFlag       = require('../models/FraudFlag');
const SystemStatus    = require('../models/SystemStatus');
const User            = require('../models/User');

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_ICON = {
  Pending:   '⏳',
  Active:    '🔄',
  Completed: '✅',
  Frozen:    '🔒',
};

function modeLabel(mode, type) {
  const m = mode === 'every' ? 'Every Top-up' : 'First Top-up Only';
  return `${m} • ${type}`;
}

// ── Share invite text (rich visual message) ────────────────────────────────────

function buildShareText(stats) {
  return (
    `🎮 *Join Mental Gaming Store!*\n\n` +
    `Myanmar's best game top-up store:\n` +
    `  ✅ MLBB, Free Fire, PUBG & more\n` +
    `  ✅ Instant delivery\n` +
    `  ✅ Trusted by thousands\n\n` +
    `🎁 *Join with my link and get:*\n` +
    `  💰 *+${(stats.welcomeBonus.ks).toLocaleString()} KS* welcome bonus\n` +
    `  🪙 *+${stats.welcomeBonus.coins} Mental Coins*\n\n` +
    `👇 Tap to join:\n${stats.link}`
  );
}

// ── /referral — full dashboard ────────────────────────────────────────────────

module.exports = function registerReferral(bot) {

  bot.command('referral', async (ctx) => {
    try {
      const stats = await getStats(ctx.from.id);

      if (!stats.referralEnabled) {
        return ctx.reply('⏸ The referral program is currently paused. Check back soon!');
      }

      const modeStr = modeLabel(stats.commissionMode, stats.commissionType);

      const recentLines = stats.recentReferrals.length
        ? stats.recentReferrals.map((r) => {
            const icon = STATUS_ICON[r.status] || '•';
            const earned = r.earned > 0 ? ` — +${r.earned.toLocaleString()} KS` : '';
            const fraud  = r.isFraud ? ' 🔒' : '';
            return `  ${icon} ${r.maskedName}${earned}${fraud}`;
          }).join('\n')
        : '  _No referrals yet — share your link below!_';

      const text =
        `🔗 *Referral Program*\n` +
        `\`━━━━━━━━━━━━━━━━━━━━━━\`\n` +
        `📊 *Your Stats*\n` +
        `  👥 Total Referrals: *${stats.total}*\n` +
        `  ✅ Completed: *${stats.completed}*\n` +
        `  🔄 Active: *${stats.active}*\n` +
        `  ⏳ Pending: *${stats.pending}*\n` +
        (stats.frozen > 0 ? `  🔒 Frozen (fraud review): *${stats.frozen}*\n` : '') +
        `\`──────────────────────\`\n` +
        `💰 *Total Earned:* *${(stats.totalKSEarned).toLocaleString()} KS*\n` +
        `🪙 *Coins Earned:* *${(stats.totalCoinsEarned).toLocaleString()} MC*\n` +
        `\`──────────────────────\`\n` +
        `🎯 *Commission:* ${stats.commissionRate}% per top-up\n` +
        `📋 *Mode:* ${modeStr}\n` +
        `\`──────────────────────\`\n` +
        `🎁 *Your Friend Gets:* +${stats.welcomeBonus.ks.toLocaleString()} KS + ${stats.welcomeBonus.coins} MC\n` +
        `\`──────────────────────\`\n` +
        `*Recent Referrals:*\n${recentLines}\n` +
        `\`━━━━━━━━━━━━━━━━━━━━━━\`\n` +
        `🔗 *Your Link:*\n\`${stats.link}\``;

      await ctx.reply(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url(
            '📤 Share Invite',
            `https://t.me/share/url?url=${encodeURIComponent(stats.link)}&text=${encodeURIComponent(buildShareText(stats))}`
          )],
          [
            Markup.button.callback('🏆 Leaderboard',   'ref_leaderboard'),
            Markup.button.callback('🔄 Refresh',       'ref_refresh'),
          ],
        ]),
      });
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  // ── /reflink — quick shareable invite ────────────────────────────────────────

  bot.command('reflink', async (ctx) => {
    try {
      const stats = await getStats(ctx.from.id);

      if (!stats.referralEnabled) {
        return ctx.reply('⏸ Referral program is currently paused.');
      }

      const inviteText = buildShareText(stats);

      await ctx.reply(
        `🔗 *Your Referral Link*\n\n` +
        `\`${stats.link}\`\n\n` +
        `*Preview of what your friends see:*\n` +
        `\`─────────────────────────\`\n` +
        inviteText +
        `\`─────────────────────────\`\n\n` +
        `_You earn *${stats.commissionRate}%* of every top-up they make_`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.url(
              '📤 Share Now',
              `https://t.me/share/url?url=${encodeURIComponent(stats.link)}&text=${encodeURIComponent(inviteText)}`
            )],
          ]),
        }
      );
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  // ── /reflead — public leaderboard ────────────────────────────────────────────

  bot.command('reflead', async (ctx) => {
    const board = await getLeaderboard(10);
    if (!board.length) return ctx.reply('🏆 No referrals completed yet. Be the first!');

    const medal = ['🥇', '🥈', '🥉'];
    const lines = board.map((entry, i) => {
      const tag = entry.user.username ? `@${entry.user.username}` : `User ${entry.user.telegramId}`;
      const m = medal[i] || `${i + 1}.`;
      return `${m} ${tag} — *${entry.count}* refs — ${price(entry.totalKS)} earned`;
    });

    await ctx.reply(
      `🏆 *Referral Leaderboard*\n\n${lines.join('\n')}\n\n` +
      `_Share your link with /reflink to climb the ranks!_`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Inline: leaderboard ───────────────────────────────────────────────────────

  bot.action('ref_leaderboard', async (ctx) => {
    await ctx.answerCbQuery();
    const board = await getLeaderboard(10);
    if (!board.length) {
      return ctx.reply('🏆 No completed referrals yet!');
    }
    const medal = ['🥇', '🥈', '🥉'];
    const lines = board.map((entry, i) => {
      const tag = entry.user.username ? `@${entry.user.username}` : `User ${entry.user.telegramId}`;
      return `${medal[i] || `${i + 1}.`} ${tag} — *${entry.count}* refs — ${price(entry.totalKS)} earned`;
    });
    await ctx.reply(`🏆 *Referral Leaderboard*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  });

  // ── Inline: refresh stats ─────────────────────────────────────────────────────

  bot.action('ref_refresh', async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');
    try {
      const stats = await getStats(ctx.from.id);
      await ctx.editMessageText(
        `🔄 *Stats Refreshed!*\n\n` +
        `✅ Completed: *${stats.completed}* | 🔄 Active: *${stats.active}* | ⏳ Pending: *${stats.pending}*\n` +
        `💰 Total Earned: *${price(stats.totalKSEarned)}*\n` +
        `📋 Commission: *${stats.commissionRate}%* (${stats.commissionMode === 'every' ? 'every top-up' : 'first top-up'})`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Refresh Again', 'ref_refresh')],
          ]),
        }
      );
    } catch (err) {
      await ctx.answerCbQuery('Error: ' + err.message);
    }
  });

  // ── Admin: /refstats ──────────────────────────────────────────────────────────

  bot.command('refstats', requireRole('MANAGER'), async (ctx) => {
    const status = await SystemStatus.get();

    const [total, completed, active, pending, frozen, flagged] = await Promise.all([
      Referral.countDocuments({}),
      Referral.countDocuments({ status: 'Completed' }),
      Referral.countDocuments({ status: 'Active' }),
      Referral.countDocuments({ status: 'Pending' }),
      Referral.countDocuments({ status: 'Frozen' }),
      FraudFlag.countDocuments({ resolved: false }),
    ]);

    const agg = await Referral.aggregate([
      { $match: { bonusPaid: true } },
      { $group: { _id: null, totalKS: { $sum: '$totalCommissionKS' } } },
    ]);
    const totalKSPaid = agg[0]?.totalKS || 0;

    const board = await getLeaderboard(5);
    const topLines = board.map((e, i) => {
      const tag = e.user.username ? `@${e.user.username}` : `ID:${e.user.telegramId}`;
      return `  ${i + 1}. ${tag} — ${e.count} refs — ${price(e.totalKS)}`;
    }).join('\n') || '  _None yet_';

    await ctx.reply(
      `📊 *Referral System Stats*\n` +
      `\`━━━━━━━━━━━━━━━━━━━━━━\`\n` +
      `*Program:* ${status.referralEnabled ? '🟢 Active' : '🔴 Paused'}\n` +
      `*Commission:* ${status.referralCommissionRate}% • ${modeLabel(status.referralCommissionMode, status.referralCommissionType)}\n` +
      `*Min Topup:* ${(status.referralMinTopup || 1000).toLocaleString()} KS\n` +
      `\`──────────────────────\`\n` +
      `👥 Total Referrals: *${total}*\n` +
      `✅ Completed: *${completed}*\n` +
      `🔄 Active (earning): *${active}*\n` +
      `⏳ Pending: *${pending}*\n` +
      `🔒 Frozen (fraud): *${frozen}*\n` +
      `⚠️ Unresolved Fraud Flags: *${flagged}*\n` +
      `💰 Total KS Paid Out: *${price(totalKSPaid)}*\n` +
      `\`──────────────────────\`\n` +
      `🏆 *Top 5 Referrers:*\n${topLines}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⚠️ View Fraud Flags', 'ref_fraud_list')],
        ]),
      }
    );
  });

  // ── Admin: /setcommission ─────────────────────────────────────────────────────
  // Usage: /setcommission <rate> [first|every] [KS|Coin|Both]
  // e.g.:  /setcommission 3 every KS

  bot.command('setcommission', adminOnly(), async (ctx) => {
    const parts = ctx.message.text.split(/\s+/).slice(1);

    if (!parts.length) {
      const status = await SystemStatus.get();
      return ctx.reply(
        `💡 *Current Commission Settings*\n\n` +
        `Rate: *${status.referralCommissionRate}%*\n` +
        `Mode: *${status.referralCommissionMode}*\n` +
        `Type: *${status.referralCommissionType}*\n` +
        `Min Topup: *${(status.referralMinTopup || 1000).toLocaleString()} KS*\n` +
        `Program: *${status.referralEnabled ? 'Active' : 'Paused'}*\n\n` +
        `Usage: \`/setcommission <rate%> [first|every] [KS|Coin|Both]\`\n` +
        `Example: \`/setcommission 3 every KS\``,
        { parse_mode: 'Markdown' }
      );
    }

    const rate = parseFloat(parts[0]);
    if (isNaN(rate) || rate < 0 || rate > 50) {
      return ctx.reply('❌ Rate must be a number between 0 and 50.');
    }

    const mode = parts[1] ? parts[1].toLowerCase() : null;
    const type = parts[2] ? parts[2] : null;

    const updates = { referralCommissionRate: rate };
    if (mode && ['first', 'every'].includes(mode)) updates.referralCommissionMode = mode;
    if (type && ['KS', 'Coin', 'Both'].includes(type)) updates.referralCommissionType = type;

    await SystemStatus.set(updates, ctx.from.id);
    await auditLog(ctx.from.id, 'SET_COMMISSION_RATE', null, 'System', updates);

    const status = await SystemStatus.get();
    await ctx.reply(
      `✅ *Commission Updated!*\n\n` +
      `Rate: *${status.referralCommissionRate}%*\n` +
      `Mode: *${status.referralCommissionMode}*\n` +
      `Type: *${status.referralCommissionType}*\n\n` +
      `_Takes effect on the next top-up approval._`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Admin: /togglereferral — enable / disable program ────────────────────────

  bot.command('togglereferral', adminOnly(), async (ctx) => {
    const status = await SystemStatus.get();
    const newState = !status.referralEnabled;
    await SystemStatus.set({ referralEnabled: newState }, ctx.from.id);
    await auditLog(ctx.from.id, newState ? 'REFERRAL_ENABLED' : 'REFERRAL_DISABLED', null, 'System', {});

    await ctx.reply(
      newState
        ? '🟢 *Referral program is now ACTIVE.*'
        : '🔴 *Referral program is now PAUSED.*\n_No new commissions will be paid until re-enabled._',
      { parse_mode: 'Markdown' }
    );
  });

  // ── Admin: /refadjust <telegramId> <+/-amount> [note] ────────────────────────

  bot.command('refadjust', adminOnly(), async (ctx) => {
    const parts = ctx.message.text.split(/\s+/).slice(1);

    if (parts.length < 2) {
      return ctx.reply(
        `💡 *Manual Referral Commission Adjustment*\n\n` +
        `Usage: \`/refadjust <telegramId> <+/-amount> [reason]\`\n\n` +
        `Examples:\n` +
        `\`/refadjust 123456789 +500 compensation for bug\`\n` +
        `\`/refadjust 123456789 -200 reversal\``,
        { parse_mode: 'Markdown' }
      );
    }

    const targetTid = Number(parts[0]);
    const amount    = Number(parts[1]);
    const note      = parts.slice(2).join(' ') || 'Manual admin adjustment';

    if (isNaN(targetTid) || isNaN(amount) || amount === 0) {
      return ctx.reply('❌ Invalid user ID or amount.');
    }

    try {
      await adminAdjustCommission(ctx.from.id, targetTid, amount, note);
      const user = await User.findByTelegramId(targetTid);

      await ctx.reply(
        `✅ *Commission Adjusted*\n\n` +
        `👤 User: \`${targetTid}\`${user?.username ? ` (@${user.username})` : ''}\n` +
        `💰 Amount: *${amount > 0 ? '+' : ''}${amount.toLocaleString()} KS*\n` +
        `📝 Note: ${note}`,
        { parse_mode: 'Markdown' }
      );

      // Notify user
      try {
        await ctx.telegram.sendMessage(
          targetTid,
          amount > 0
            ? `🎁 *Referral Bonus Added!*\n\n*+${amount.toLocaleString()} KS* has been added to your wallet.\n_${note}_`
            : `📝 *Account Adjustment*\n\n*${amount.toLocaleString()} KS* has been adjusted from your referral earnings.\n_${note}_`,
          { parse_mode: 'Markdown' }
        );
      } catch {}
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  // ── Admin: /reffraud — view unresolved fraud flags ────────────────────────────

  bot.command('reffraud', requireRole('MANAGER'), async (ctx) => {
    const flags = await FraudFlag.find({ resolved: false })
      .sort({ severity: 1, createdAt: -1 })
      .limit(15);

    if (!flags.length) {
      return ctx.reply('✅ No unresolved fraud flags. All clear!');
    }

    const severityIcon = { HIGH: '🔴', MEDIUM: '🟠', LOW: '🟡' };
    const lines = flags.map((f, i) => {
      const icon  = severityIcon[f.severity] || '⚪';
      const label = f.type.replace(/_/g, ' ');
      const age   = Math.floor((Date.now() - f.createdAt.getTime()) / 60_000);
      return `${i + 1}. ${icon} *${label}*\n   Referrer: \`${f.referrerTid}\` → Referee: \`${f.refereeTid}\`\n   _${age}m ago_`;
    });

    await ctx.reply(
      `⚠️ *Unresolved Fraud Flags (${flags.length})*\n\n` +
      lines.join('\n\n') + '\n\n' +
      `_Use [🚫 Block] / [✅ Dismiss] buttons in each alert to resolve._`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Inline: fraud flag list from /refstats ────────────────────────────────────

  bot.action('ref_fraud_list', requireRole('MANAGER'), async (ctx) => {
    await ctx.answerCbQuery();
    const flags = await FraudFlag.find({ resolved: false }).sort({ severity: 1 }).limit(10);

    if (!flags.length) return ctx.reply('✅ No unresolved fraud flags!');

    const severityIcon = { HIGH: '🔴', MEDIUM: '🟠', LOW: '🟡' };
    const lines = flags.map((f) => {
      const icon = severityIcon[f.severity] || '⚪';
      return `${icon} *${f.type}*\n  Referrer \`${f.referrerTid}\` → Referee \`${f.refereeTid}\``;
    });

    await ctx.reply(
      `⚠️ *Fraud Flags*\n\n${lines.join('\n\n')}`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Register fraud action handlers (block / dismiss buttons) ─────────────────
  registerFraudActions(bot);
};
