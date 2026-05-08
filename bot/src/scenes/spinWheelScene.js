/** Reply-keyboard-only Spin Wheel Scene (Fullfix14) */
const { Scenes, Markup } = require('telegraf');
const { spin, canFreeSpinToday, nextFreeSpinIn, getRuntimePrizePool, getSpinCostCoins, WHEEL_FRAMES } = require('../services/GameService');
const { formatCountdown } = require('../services/FlashSaleService');
const { price } = require('../utils/ui');
const { auditLog } = require('../services/logger');
const User = require('../models/User');

function kb(rows) { return Markup.keyboard(rows).resize(); }
const SPIN_KB = kb([['🎰 Free Spin!', '🪙 Paid Spin'], ['🔙 Done', '🏠 Main Menu']]);
const RESULT_KB = kb([['🎰 Spin Again', '🔙 Done'], ['🏠 Main Menu']]);
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function animateWheel(ctx, msgRef, frameCount = 9) {
  for (let i = 0; i < frameCount; i++) {
    const frame = WHEEL_FRAMES[i % WHEEL_FRAMES.length];
    await sleep(150 + i * 60);
    await ctx.telegram.editMessageText(msgRef.chatId, msgRef.messageId, undefined, `🎰 *Spinning...*\n\n${frame}`, { parse_mode: 'Markdown' }).catch(() => {});
  }
}

async function showSpinInfo(ctx) {
  const user = await User.findByTelegramId(ctx.from.id);
  if (!user) { await ctx.reply('❌ User not found. Press /start first.'); return false; }
  const freeSpin = canFreeSpinToday(user);
  const msToNext = freeSpin ? 0 : nextFreeSpinIn(user);
  const spinCost = await getSpinCostCoins();
  const prizePool = await getRuntimePrizePool();
  const prizeLines = prizePool.map((p) => `${p.label}`);
  const statusLine = freeSpin ? '✅ Free spin available!' : `⏳ Next free spin in: *${formatCountdown(msToNext)}*`;
  const text =
    `🎰 *Spin Wheel*\n\n` +
    `💰 Balance: *${price(user.balanceKS)}*\n` +
    `🪙 Coins: *${Number(user.balanceCoin || 0).toLocaleString()} MC*\n` +
    `${statusLine}\n\n` +
    `*Prize Pool:*\n${prizeLines.join('\n')}\n\n` +
    `_Paid spin costs ${spinCost} Mental Coins._`;
  await ctx.reply(text, { parse_mode: 'Markdown', ...SPIN_KB });
  return true;
}

async function executeSpin(ctx, usePaidSpin) {
  const spinCost = await getSpinCostCoins();
  const msgRef = { chatId: ctx.chat.id, messageId: (await ctx.reply('🎰 *Getting ready...*', { parse_mode: 'Markdown' })).message_id };
  try {
    await animateWheel(ctx, msgRef, 9);
    const { prize, user, usedFreeSpin } = await spin(ctx.from.id, { usePaidSpin });
    await auditLog(ctx.from.id, 'SPIN_WHEEL', null, 'Game', { prizeId: prize.id, prize: prize.label, usedFreeSpin });

    const spinTypeLabel = usedFreeSpin ? '🆓 Free Spin' : `🪙 Paid Spin (${spinCost} MC)`;
    const rewardLines = [];
    if (prize.type === 'ks') {
      rewardLines.push(`💰 +${Number(prize.value || 0).toLocaleString()} KS added to your wallet!`);
      rewardLines.push(`💳 New Balance: *${price(user.balanceKS)}*`);
    } else if (prize.type === 'coin') {
      rewardLines.push(`🪙 +${Number(prize.value || 0).toLocaleString()} Mental Coins added!`);
      rewardLines.push(`🪙 New Coin Balance: *${Number(user.balanceCoin || 0).toLocaleString()} MC*`);
    } else if (prize.type === 'spin') {
      rewardLines.push('🎰 You got a *Free Spin!* Come back and spin again!');
    } else {
      rewardLines.push('_Better luck next time! Come back tomorrow for a free spin._');
    }

    await ctx.telegram.editMessageText(
      msgRef.chatId, msgRef.messageId, undefined,
      `🎰 *Result!*\n\n${spinTypeLabel}\n🏆 Prize: *${prize.label}*\n\n${rewardLines.join('\n')}`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
    await ctx.reply('Choose next action:', RESULT_KB);
  } catch (err) {
    let errText = `❌ ${err.message}`;
    if (err.message.startsWith('daily_limit:')) {
      const ms = parseInt(err.message.split(':')[1]);
      errText = `⏳ You've used your free spin today!\n\nNext free spin in: *${formatCountdown(ms)}*\n\nOr spend ${spinCost} MC for a paid spin.`;
    } else if (err.message.startsWith('not_enough_coins:')) {
      const have = parseInt(err.message.split(':')[1]);
      errText = `🪙 Not enough coins!\n\nYou have *${have} MC*, need *${spinCost} MC*.`;
    }
    await ctx.telegram.editMessageText(msgRef.chatId, msgRef.messageId, undefined, errText, { parse_mode: 'Markdown' }).catch(() => {});
    await ctx.reply('Choose next action:', RESULT_KB);
  }
  return ctx.scene.leave();
}

const spinWheelScene = new Scenes.WizardScene(
  'spin_wheel_scene',
  async (ctx) => { await showSpinInfo(ctx); return ctx.wizard.next(); },
  async (ctx) => {
    const text = ctx.message?.text || '';
    if (text === '🎰 Free Spin!') return executeSpin(ctx, false);
    if (text === '🪙 Paid Spin') return executeSpin(ctx, true);
    if (text === '🎰 Spin Again') { await showSpinInfo(ctx); return; }
    if (['🔙 Done', '🏠 Main Menu'].includes(text)) { await ctx.reply('🏠 Main Menu', kb([['🏠 Main Menu']])); return ctx.scene.leave(); }
    await ctx.reply('Please use the keyboard buttons below.', SPIN_KB);
  }
);

spinWheelScene.action(/.*/, async (ctx) => {
  await ctx.answerCbQuery('UI updated. Please use the reply keyboard below.').catch(() => {});
  await showSpinInfo(ctx);
});

module.exports = spinWheelScene;
