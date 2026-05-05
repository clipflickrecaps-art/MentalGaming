/**
 * Topup command + Admin approval controller + /addpayment admin setup
 */

const { Markup } = require('telegraf');
const { adminOnly } = require('../middlewares/adminCheck');
const { approveTopup, rejectTopup, getHistory, calcCoinBonus } = require('../services/WalletService');
const { processTopupCommission } = require('../services/ReferralService');
const { checkAndUpgradeTier } = require('../services/MembershipService');
const { checklist } = require('../utils/animations');
const { auditLog } = require('../services/logger');
const { price, formatDate } = require('../utils/ui');
const { getTheme } = require('../services/ThemeService');
const PaymentMethod = require('../models/PaymentMethod');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { config } = require('../../config/settings');

// ── E-Receipt builder ────────────────────────────────────────────────────────
function buildReceipt(txId, amountKS, bonusCoins, user) {
  const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Rangoon' });
  return (
    `🧾 *E\\-Receipt — Mental Gaming Store*\n` +
    `\`━━━━━━━━━━━━━━━━━━━━━━\`\n` +
    `🆔 Ref: \`${txId}\`\n` +
    `📅 Date: ${now} MMT\n` +
    `\`━━━━━━━━━━━━━━━━━━━━━━\`\n` +
    `💳 Top\\-up: *${amountKS.toLocaleString()} KS*\n` +
    `🎁 Coin Bonus: *\\+${bonusCoins.toLocaleString()} Mental Coins*\n` +
    `\`━━━━━━━━━━━━━━━━━━━━━━\`\n` +
    `💰 KS Balance: *${user.balanceKS.toLocaleString()} KS*\n` +
    `🪙 Coin Balance: *${user.balanceCoin.toLocaleString()} MC*\n` +
    `⭐ Tier: *${user.membershipTier}*\n` +
    `\`━━━━━━━━━━━━━━━━━━━━━━\`\n` +
    `_Thank you for your deposit\\! 🎮_`
  );
}

module.exports = function registerTopup(bot) {

  // ── User: /topup ───────────────────────────────────────────────────────────
  bot.command('topup', async (ctx) => {
    await ctx.scene.enter('topup_scene');
  });

  bot.hears('💰 Top Up', async (ctx) => {
    await ctx.scene.enter('topup_scene');
  });

  // ── Admin: Approve top-up ─────────────────────────────────────────────────
  bot.action(/^topup_approve:(.+)$/, adminOnly(), async (ctx) => {
    const txId = ctx.match[1];
    await ctx.answerCbQuery('Processing approval...');

    const ref = { chatId: ctx.chat.id, messageId: (await ctx.reply('⌛')).message_id };

    try {
      // Guard duplicate approval
      const tx = await Transaction.findOne({ txId: `${txId}_approved` });
      if (tx) {
        return ctx.telegram.editMessageText(ref.chatId, ref.messageId, undefined, '⚠️ Already approved.');
      }

      await checklist(ctx, ref,
        [
          { label: 'Verifying transaction',  delay: 600 },
          { label: 'Crediting KS balance',   delay: 700 },
          { label: 'Awarding coin bonus',    delay: 600 },
          { label: 'Sending receipt',        delay: 600 },
        ],
        `✅ *Top-up approved!*`
      );

      const { user, amountKS, bonusCoins } = await approveTopup(txId, ctx.from.id);

      await auditLog(ctx.from.id, 'TOPUP_APPROVED', txId, 'Transaction', { amountKS, bonusCoins });

      // ── Process referral commission (first or every-topup mode) ────────
      processTopupCommission(user._id, amountKS, ctx.telegram).catch((err) =>
        console.error('[Topup] Referral commission error:', err.message)
      );

      // ── Check & upgrade membership tier ─────────────────────────────────
      checkAndUpgradeTier(user._id, ctx.telegram).catch((err) =>
        console.error('[Topup] Membership upgrade error:', err.message)
      );

      // Send E-Receipt to customer
      try {
        await ctx.telegram.sendMessage(
          user.telegramId,
          buildReceipt(txId, amountKS, bonusCoins, user),
          { parse_mode: 'MarkdownV2' }
        );
      } catch (err) {
        console.error('[Topup] Could not send receipt to user:', err.message);
      }

      await ctx.reply(
        `✅ *Top-up approved!*\n\n` +
        `👤 User: \`${user.telegramId}\`\n` +
        `💰 Credited: *${price(amountKS)}*\n` +
        `🎁 Coins: *+${bonusCoins.toLocaleString()} MC*\n` +
        `⭐ New Tier: *${user.membershipTier}*`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      await ctx.telegram.editMessageText(ref.chatId, ref.messageId, undefined, `❌ ${err.message}`);
    }
  });

  // ── Admin: Reject top-up (prompt for reason) ──────────────────────────────
  bot.action(/^topup_reject:(.+)$/, adminOnly(), async (ctx) => {
    const txId = ctx.match[1];
    await ctx.answerCbQuery();
    ctx.session.adminPendingTopupReject = txId;

    await ctx.reply(
      `❌ *Rejecting Top-Up* \`${txId}\`\n\n` +
      `Please enter the rejection reason for the customer:`,
      { parse_mode: 'Markdown', ...Markup.forceReply() }
    );
  });

  // ── Admin: Ask for more info from user ────────────────────────────────────
  bot.action(/^topup_askinfo:(.+)$/, adminOnly(), async (ctx) => {
    const txId = ctx.match[1];
    await ctx.answerCbQuery();

    const tx = await Transaction.findOne({ txId }).populate('userId');
    if (!tx) return ctx.reply('❌ Transaction not found.');

    ctx.session.adminTopupAskInfo = { txId, userTelegramId: tx.userId.telegramId };

    await ctx.reply(
      `💬 *Ask for More Info*\n\n` +
      `What do you need to clarify from the customer?`,
      { parse_mode: 'Markdown', ...Markup.forceReply() }
    );
  });

  // ── Admin text: handle reject reason + ask-info ────────────────────────────
  bot.on('text', async (ctx, next) => {
    if (ctx.from.id !== config.bot.adminId) return next();

    // Reject reason
    if (ctx.session?.adminPendingTopupReject) {
      const txId = ctx.session.adminPendingTopupReject;
      const reason = ctx.message.text.trim();
      ctx.session.adminPendingTopupReject = null;

      const ref = { chatId: ctx.chat.id, messageId: (await ctx.reply('⌛')).message_id };

      try {
        const { user } = await rejectTopup(txId, ctx.from.id, reason);
        await auditLog(ctx.from.id, 'TOPUP_REJECTED', txId, 'Transaction', { reason });

        await ctx.telegram.editMessageText(ref.chatId, ref.messageId, undefined,
          `❌ Top-up \`${txId}\` rejected.`,
          { parse_mode: 'Markdown' }
        );

        try {
          await ctx.telegram.sendMessage(
            user.telegramId,
            `❌ *Your top-up request was rejected.*\n\n` +
            `💰 Amount: *${price(user.balanceKS)}*\n` +
            `📝 Reason: ${reason}\n\n` +
            `_Please contact /support if you believe this is a mistake._`,
            { parse_mode: 'Markdown' }
          );
        } catch {}
      } catch (err) {
        await ctx.telegram.editMessageText(ref.chatId, ref.messageId, undefined, `❌ ${err.message}`);
      }
      return;
    }

    // Ask-info relay
    if (ctx.session?.adminTopupAskInfo) {
      const { txId, userTelegramId } = ctx.session.adminTopupAskInfo;
      ctx.session.adminTopupAskInfo = null;

      try {
        await ctx.telegram.sendMessage(
          userTelegramId,
          `💬 *Additional Info Requested — Top-Up* \`${txId}\`\n\n` +
          `${ctx.message.text}\n\n` +
          `_Please reply to support: /support_`,
          { parse_mode: 'Markdown' }
        );
        await ctx.reply(`✅ Message sent to user.`);
      } catch {
        await ctx.reply(`❌ Could not reach user.`);
      }
      return;
    }

    return next();
  });

  // ── Admin: /addpayment ─────────────────────────────────────────────────────
  bot.command('addpayment', adminOnly(), async (ctx) => {
    ctx.session.adminAddPayment = { step: 'name' };
    await ctx.reply(
      `➕ *Add Payment Method*\n\nStep 1/4: Enter the *payment method name*:\n_(e.g. KBZ Pay, Wave Money, AYA Pay)_`,
      { parse_mode: 'Markdown', ...Markup.forceReply() }
    );
  });

  bot.on('text', async (ctx, next) => {
    const state = ctx.session?.adminAddPayment;
    if (!state || ctx.from.id !== config.bot.adminId) return next();

    const input = ctx.message.text.trim();

    if (state.step === 'name') {
      state.name = input;
      state.step = 'number';
      await ctx.reply(`✅ Name: *${input}*\n\nStep 2/4: Enter the *account number or phone number*:`, {
        parse_mode: 'Markdown', ...Markup.forceReply(),
      });
    } else if (state.step === 'number') {
      state.accountNumber = input;
      state.step = 'accountName';
      await ctx.reply(`Step 3/4: Enter the *account holder name*:`, {
        parse_mode: 'Markdown', ...Markup.forceReply(),
      });
    } else if (state.step === 'accountName') {
      state.accountName = input;
      state.step = 'emoji';
      await ctx.reply(`Step 4/4: Enter an *emoji* for this method (e.g. 💳 🏦 📱) or type \`skip\`:`, {
        parse_mode: 'Markdown', ...Markup.forceReply(),
      });
    } else if (state.step === 'emoji') {
      const emoji = input.toLowerCase() === 'skip' ? '💳' : input;
      ctx.session.adminAddPayment = null;

      const shortCode = state.name.replace(/\s+/g, '').toUpperCase().slice(0, 6);

      const method = await PaymentMethod.create({
        name: state.name,
        shortCode,
        accountName: state.accountName,
        accountNumber: state.accountNumber,
        emoji,
      });

      await auditLog(ctx.from.id, 'ADD_PAYMENT_METHOD', method._id.toString(), 'System', { name: state.name });
      await ctx.reply(
        `✅ *Payment Method Added!*\n\n` +
        `${emoji} *${state.name}*\n` +
        `👤 ${state.accountName}\n` +
        `📱 \`${state.accountNumber}\`\n\n` +
        `_Users can now select this in /topup_`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  // ── Admin: /listpayments ───────────────────────────────────────────────────
  bot.command('listpayments', adminOnly(), async (ctx) => {
    const methods = await PaymentMethod.find().sort({ displayOrder: 1, name: 1 });
    if (!methods.length) return ctx.reply('No payment methods configured. Use /addpayment to add one.');

    const lines = methods.map((m, i) =>
      `${i + 1}. ${m.emoji} *${m.name}* — \`${m.accountNumber}\` — ${m.isActive ? '🟢 Active' : '🔴 Inactive'}`
    );

    await ctx.reply(
      `💳 *Payment Methods (${methods.length})*\n\n${lines.join('\n')}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('➕ Add New', 'addpayment_start')]]),
      }
    );
  });

  bot.action('addpayment_start', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.adminAddPayment = { step: 'name' };
    await ctx.reply(
      `➕ *Add Payment Method*\n\nStep 1/4: Enter the payment method name:`,
      { parse_mode: 'Markdown', ...Markup.forceReply() }
    );
  });

  // ── User: Transaction history via /history ─────────────────────────────────
  bot.command('history', async (ctx) => {
    const user = await User.findByTelegramId(ctx.from.id);
    if (!user) return ctx.reply('❌ User not found.');

    const txs = await getHistory(user._id, { limit: 10 });
    if (!txs.length) return ctx.reply('📜 No transactions yet.');

    const theme = getTheme(ctx.user);
    const typeIcon = { Topup: '💳', Purchase: '🛍️', Refund: '↩️', Bonus: '🎁', Debit: '📤', AdminCredit: '⬆️', AdminDebit: '⬇️' };
    const lines = txs.map((t) => {
      const icon = typeIcon[t.type] || '•';
      const sign = t.amount > 0 ? '+' : '';
      const wallet = t.wallet === 'KS' ? 'KS' : 'MC';
      const statusDot = { Completed: '🟢', Pending: '🟡', Rejected: '🔴' }[t.status] || '⚪';
      const date = formatDate(t.timestamp);
      return `${icon} ${sign}${t.amount.toLocaleString()} ${wallet}  ${statusDot}  _${date}_`;
    });

    await ctx.reply(
      `📜 *Transaction History* (last ${txs.length})\n\n${lines.join('\n')}`,
      { parse_mode: 'Markdown' }
    );
  });
};
