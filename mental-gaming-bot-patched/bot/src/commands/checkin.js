/**
 * Daily Check-In Commands
 *
 * /checkin   — perform today's check-in or show status if already done
 * /streak    — show streak stats + 7-day reward preview
 * /calendar  — current month check-in calendar view
 */

const { Markup } = require('telegraf');
const {
  doCheckIn,
  getCheckInStatus,
  getMonthCalendar,
  buildCalendar,
  getRewardPreview,
  getMSTToday,
  MILESTONES,
} = require('../services/CheckInService');
const { checkRestrictions } = require('../middlewares/checkRestrictions');
const { price } = require('../utils/ui');
const User = require('../models/User');

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Animated check-in: stamp effect ──────────────────────────────────────────
async function animateCheckIn(ctx, msgRef, result) {
  const frames = [
    '⬜ ⬜ ⬜\n⬜ ⬜ ⬜\n⬜ ⬜ ⬜',
    '🟨 ⬜ ⬜\n⬜ ⬜ ⬜\n⬜ ⬜ ⬜',
    '🟨 🟨 ⬜\n🟨 ⬜ ⬜\n⬜ ⬜ ⬜',
    '🟩 🟩 🟩\n🟩 🟩 🟩\n🟩 🟩 🟩',
    '✅ ✅ ✅\n✅ ✅ ✅\n✅ ✅ ✅',
  ];

  for (const frame of frames) {
    await sleep(350);
    await ctx.telegram.editMessageText(
      msgRef.chatId, msgRef.messageId, undefined,
      `📅 *Stamping...*\n\n${frame}`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }
}

// ── Format streak fire display ────────────────────────────────────────────────
function streakBar(streak) {
  if (streak === 0) return '○ ○ ○ ○ ○ ○ ○';
  const filled = Math.min(streak % 7 || 7, 7);
  const dots = Array.from({ length: 7 }, (_, i) => i < filled ? '🔥' : '○').join(' ');
  return dots;
}

// ── Result message ────────────────────────────────────────────────────────────
function buildResultText(result) {
  const streakEmoji = result.streak >= 30 ? '🏆' : result.streak >= 14 ? '🏅' : result.streak >= 7 ? '🎉' : '🔥';
  const streakText  = `${streakEmoji} *Streak: ${result.streak} day${result.streak !== 1 ? 's' : ''}!*`;
  const bar = streakBar(result.streak);

  const brokenNote = result.isStreakBroken
    ? `\n⚠️ _Your streak was reset. Start fresh from Day 1!_`
    : '';

  const milestoneNote = result.isMilestone && result.milestoneLabel
    ? `\n\n🎊 *MILESTONE UNLOCKED!*\n${result.milestoneLabel}`
    : '';

  const ksLine = result.ksReward > 0 ? `\n💰 *+${result.ksReward.toLocaleString()} KS* bonus!` : '';

  const nextR = result.nextReward;
  const nextKs = nextR.ks > 0 ? ` + ${nextR.ks.toLocaleString()} KS` : '';

  return (
    `✅ *Check-In Complete!*\n\n` +
    `${streakText}\n` +
    `${bar}\n` +
    brokenNote +
    `\n🪙 *+${result.coinReward} Mental Coins* earned!` +
    ksLine +
    `\n💳 Coins Balance: *${result.user.balanceCoin.toLocaleString()} MC*` +
    milestoneNote +
    `\n\n_Tomorrow: *+${nextR.coins} MC*${nextKs}_`
  );
}

module.exports = function registerCheckIn(bot) {

  // ── /checkin ────────────────────────────────────────────────────────────────
  bot.command('checkin', checkRestrictions('checkin'), async (ctx) => {
    await handleCheckIn(ctx);
  });

  bot.hears(['🗓 Check In', '✅ Check In', 'checkin', '🗓 နေ့စဉ် Check-In'], checkRestrictions('checkin'), async (ctx) => {
    await handleCheckIn(ctx);
  });

  async function handleCheckIn(ctx) {
    const status = await getCheckInStatus(ctx.from.id);
    if (!status) return ctx.reply('❌ Please /start first.');

    if (status.alreadyCheckedIn) {
      const nextMidnight = new Date();
      nextMidnight.setUTCHours(17, 30, 0, 0); // midnight MST
      if (nextMidnight <= new Date()) nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
      const hoursLeft = Math.ceil((nextMidnight - new Date()) / 3600000);

      const bar = streakBar(status.streak);
      await ctx.reply(
        `✅ *Already Checked In Today!*\n\n` +
        `🔥 Current Streak: *${status.streak} day${status.streak !== 1 ? 's' : ''}*\n` +
        `${bar}\n\n` +
        `⏳ Next check-in in: *~${hoursLeft}h*\n\n` +
        `_Tomorrow's reward: *+${status.nextReward.coins} MC*${status.nextReward.ks > 0 ? ` + ${status.nextReward.ks} KS` : ''}_`,
        {
          parse_mode: 'Markdown',
          ...Markup.keyboard([['📅 Calendar', '🔥 My Streak'], ['🏠 Main Menu']]).resize(),
        }
      );
      return;
    }

    // Animate then process
    const msgRef = {
      chatId:    ctx.chat.id,
      messageId: (await ctx.reply('📅 *Preparing check-in...*', { parse_mode: 'Markdown' })).message_id,
    };

    try {
      await animateCheckIn(ctx, msgRef, null);

      const result = await doCheckIn(ctx.from.id);

      await ctx.telegram.editMessageText(
        msgRef.chatId, msgRef.messageId, undefined,
        buildResultText(result),
        { parse_mode: 'Markdown' }
      ).catch(() => {});
      await ctx.reply('Choose next action:', Markup.keyboard([['📅 Calendar', '🔥 My Streak'], ['🏠 Main Menu']]).resize());
    } catch (err) {
      if (err.message === 'already_checked_in') {
        await ctx.telegram.editMessageText(
          msgRef.chatId, msgRef.messageId, undefined,
          '✅ You already checked in today! Come back tomorrow.'
        ).catch(() => {});
      } else {
        await ctx.telegram.editMessageText(
          msgRef.chatId, msgRef.messageId, undefined,
          `❌ ${err.message}`
        ).catch(() => {});
      }
    }
  }

  // ── /streak ─────────────────────────────────────────────────────────────────
  bot.command('streak', async (ctx) => { await showStreak(ctx); });
  bot.hears(['🔥 My Streak', '🔥 Streak ကြည့်ရန်'], async (ctx) => { await showStreak(ctx); });

  async function showStreak(ctx) {
    const user = await User.findByTelegramId(ctx.from.id);
    if (!user) return ctx.reply('❌ Please /start first.');

    const status   = await getCheckInStatus(ctx.from.id);
    const streak   = user.checkInStreak || 0;
    const longest  = user.longestStreak || 0;
    const total    = user.totalCheckIns || 0;
    const bar      = streakBar(streak);

    const nextMilestone = MILESTONES.find((m) => m.streak > streak);
    const milestoneText = nextMilestone
      ? `\n🎯 Next milestone: *Day ${nextMilestone.streak}* — +${nextMilestone.coins} MC + ${nextMilestone.ks.toLocaleString()} KS`
      : `\n🏆 All milestones achieved!`;

    const today = getMSTToday();
    const checkedToday = user.lastCheckInDate === today;

    const text =
      `📊 *Your Check-In Stats*\n\n` +
      `🔥 Current Streak: *${streak} day${streak !== 1 ? 's' : ''}*\n` +
      `${bar}\n\n` +
      `🏆 Longest Streak: *${longest} days*\n` +
      `📅 Total Check-Ins: *${total}*\n` +
      `${checkedToday ? '✅ Already checked in today' : '⏰ Not checked in yet today'}\n` +
      milestoneText +
      `\n\n*7-Day Reward Preview:*\n${await getRewardPreview(streak)}`;

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      ...Markup.keyboard([
        checkedToday ? ['✅ Checked In Today'] : ['🗓 Check In'],
        ['📅 Calendar', '🏠 Main Menu'],
      ]).resize(),
    });
  }

  // ── /calendar ───────────────────────────────────────────────────────────────
  bot.command('calendar', async (ctx) => { await showCalendar(ctx); });
  bot.hears('📅 Calendar', async (ctx) => { await showCalendar(ctx); });

  async function showCalendar(ctx, year = null, month = null) {
    const today = getMSTToday();
    const [y, m] = (year && month)
      ? [year, month]
      : [parseInt(today.slice(0, 4)), parseInt(today.slice(5, 7))];

    const data = await getMonthCalendar(ctx.from.id, y, m);
    if (!data) return ctx.reply('❌ Please /start first.');

    const calendar = buildCalendar(y, m, data.checkedDays, data.todayDay, data.todayMonth, data.todayYear);
    const checkedCount = data.checkedDays.size;

    const prevMonth = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
    const nextMonth = m === 12 ? { y: y + 1, m: 1  } : { y, m: m + 1 };

    await ctx.reply(
      `${calendar}\n\n` +
      `✅ Checked in *${checkedCount}* day${checkedCount !== 1 ? 's' : ''} this month\n\n` +
      `✅ Checked in  📍 Today  🔲 Missed`,
      {
        parse_mode: 'Markdown',
        ...Markup.keyboard([['🔥 My Streak', '🗓 Check In'], ['🏠 Main Menu']]).resize(),
      }
    );
  }

  // ── Old inline actions disabled in Fullfix14 ───────────────────────────────
  bot.action(/^ci_/, async (ctx) => {
    await ctx.answerCbQuery('UI updated. Please use the reply keyboard below.').catch(() => {});
    return ctx.reply('✅ Check-In UI updated. Use the buttons below.', Markup.keyboard([['🗓 Check In', '📅 Calendar'], ['🔥 My Streak', '🏠 Main Menu']]).resize());
  });
};
