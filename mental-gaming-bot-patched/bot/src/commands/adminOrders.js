/**
 * Admin Order Processing — Full Rewrite
 *
 * [✅ Complete]        → DirectTopup: ask delivery data → send receipt
 *                       DigitalCode: auto-pull code → send receipt
 * [❌ Cancel & Refund] → ask reason → cancelAndRefund → notify user
 * [💬 Message User]   → ask message → forward to user
 * [📜 Use Template]   → pick template → send to user instantly
 * [⚠️ Warn User]      → ask reason → issueWarning
 */

const { Markup } = require('telegraf');
const { requireRole, isAnyAdmin } = require('../middlewares/adminCheck');
const { completeOrder, cancelAndRefund, markProcessing } = require('../services/OrderService');
const OrderTrackingService = require('../services/OrderTrackingService');
const { issueWarning } = require('../services/PenaltyService');
const { checklist } = require('../utils/animations');
const { auditLog } = require('../services/logger');
const { price, formatDate } = require('../utils/ui');
const Order = require('../models/Order');


function prettyInfoLabel(label = '', key = '') {
  const raw = `${label} ${key}`.toLowerCase();
  if (raw.includes('server') || raw.includes('zone')) return '🌐 Server ID';
  if (raw.includes('player') && raw.includes('name')) return '👤 Player Name';
  if (raw.includes('uid')) return '🆔 UID';
  if (raw.includes('email')) return '📧 Email';
  if (raw.includes('phone')) return '📱 Phone';
  if (raw.includes('game') || raw.includes('player') || raw.includes('id')) return '🆔 Game ID';
  return `📝 ${label || key || 'Info'}`;
}

function orderInfoLines(order) {
  const lines = [];
  const seen = new Set();
  const add = (label, value, key = '') => {
    const cleanValue = String(value || '').trim();
    if (!cleanValue) return;
    const cleanLabel = prettyInfoLabel(label, key);
    const sig = `${cleanLabel}:${cleanValue}`.toLowerCase();
    if (seen.has(sig)) return;
    seen.add(sig);
    lines.push(`${cleanLabel}: \`${cleanValue}\``);
  };

  if (Array.isArray(order.requiredInfo)) {
    for (const item of order.requiredInfo) add(item?.label, item?.value, item?.key);
  }
  add('Game ID', order.gameId, 'gameId');
  add('Server ID', order.zoneId, 'zoneId');
  return lines.length ? lines.join('\n') + '\n' : '';
}

// ── Professional receipt ──────────────────────────────────────────────────────
function buildReceipt(order, deliveredData) {
  const shortId  = order._id.toString().slice(-8).toUpperCase();
  const product  = order.productId?.name || 'Unknown Product';
  const now      = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Rangoon' });
  const promoLine = order.promoCode
    ? `🎟 Promo: \`${order.promoCode}\` \\(\\-${order.promoDiscount?.toLocaleString() || 0} KS\\)\n`
    : '';
  const idLine = orderInfoLines(order);

  return (
    `🧾 *Order Receipt*\n` +
    `\`━━━━━━━━━━━━━━━━━━━━━━\`\n` +
    `🏪 Mental Gaming Store\n` +
    `\`━━━━━━━━━━━━━━━━━━━━━━\`\n` +
    `🆔 Order: \`${shortId}\`\n` +
    `📅 ${now} MMT\n` +
    `\`━━━━━━━━━━━━━━━━━━━━━━\`\n` +
    `📦 *${product}*\n` +
    idLine +
    promoLine +
    `💰 Paid: *${order.amount.toLocaleString()} KS*\n` +
    `\`━━━━━━━━━━━━━━━━━━━━━━\`\n` +
    (deliveredData
      ? `📬 *Delivery:*\n\`${deliveredData}\`\n\`━━━━━━━━━━━━━━━━━━━━━━\`\n`
      : '') +
    `✅ Status: *Completed*\n` +
    `\`━━━━━━━━━━━━━━━━━━━━━━\`\n` +
    `_Thank you for shopping\\! 🎮_`
  );
}

function orderSummaryText(order) {
  const product  = order.productId?.name || 'Unknown';
  const user     = order.userId?.username ? `@${order.userId.username}` : `ID: ${order.userId?.telegramId}`;
  const infoBlock = orderInfoLines(order).trim();
  const idLine = infoBlock ? `\n${infoBlock}` : '';
  const tierLine = order.tierDiscount > 0 ? `\n🏷 Tier Discount (${order.tierDiscountPct}%): −${price(order.tierDiscount)}` : '';
  const promoLine = order.promoCode ? `\n🎟 Promo ${order.promoCode}: −${price(order.promoDiscount || 0)}` : '';

  return (
    `🆔 Order: \`${order._id.toString().slice(-8).toUpperCase()}\`\n` +
    `👤 Customer: ${user}\n` +
    `📦 Product: ${product}\n` +
    `🎮 Type: ${order.productType || 'DirectTopup'}` +
    idLine +
    `\n💰 Original: ${price(order.originalAmount || order.amount)}` +
    tierLine +
    promoLine +
    `\n✨ Charged: *${price(order.amount)}*\n` +
    `📊 Status: ${order.status}\n` +
    `🕐 Placed: ${formatDate(order.timestamp)}`
  );
}

const ADMIN_ORDER_ACTION_ROWS = [
  ['✅ Complete', '🔄 Processing'],
  ['❌ Cancel & Refund'],
  ['💬 Message User', '⚠️ Warn User'],
  ['📜 Use Template'],
  ['⬅️ Back to Orders', '🏠 Admin Menu'],
];

function adminOrderActionKeyboard() {
  return Markup.keyboard(ADMIN_ORDER_ACTION_ROWS).resize();
}

function adminOrdersKeyboard() {
  return Markup.keyboard([['📦 Manage Orders', '🔄 Refresh Orders'], ['🏠 Admin Menu']]).resize();
}

function promptKeyboard() {
  return Markup.keyboard([['❌ Cancel'], ['📦 Manage Orders', '🏠 Admin Menu']]).resize();
}

async function showOrderCard(ctx, order, title = '🟡 Pending Order') {
  if (!ctx.session) ctx.session = {};
  ctx.session.adminSelectedOrderId = order._id.toString();
  await ctx.reply(`${title}\n\n${orderSummaryText(order)}`, {
    parse_mode: 'Markdown',
    ...adminOrderActionKeyboard(),
  });
}

async function getSelectedOrder(ctx) {
  const orderId = ctx.session?.adminSelectedOrderId;
  if (!orderId) {
    await ctx.reply('❌ No order selected. Please open 📦 Manage Orders or /pendingorders first.', adminOrdersKeyboard());
    return null;
  }
  const order = await Order.findById(orderId).populate('userId').populate('productId');
  if (!order) {
    ctx.session.adminSelectedOrderId = null;
    await ctx.reply('❌ Selected order not found. Please refresh orders.', adminOrdersKeyboard());
    return null;
  }
  return order;
}

async function notifyCustomer(ctx, telegramId, text, extra = {}) {
  try {
    await ctx.telegram.sendMessage(telegramId, text, { parse_mode: 'Markdown', ...extra });
  } catch (err) {
    console.error(`[AdminOrders] Notify failed for ${telegramId}:`, err.message);
  }
}

module.exports = function registerAdminOrders(bot) {

  // ── 🔄 Mark Processing ────────────────────────────────────────────────────
  bot.action(/^admin_processing:(.+)$/, requireRole('STAFF'), async (ctx) => {
    const orderId = ctx.match[1];
    await ctx.answerCbQuery('Marking as Processing…');

    const order = await Order.findById(orderId).populate('userId').populate('productId');
    if (!order) return ctx.reply('❌ Order not found.');
    if (order.status === 'Processing') return ctx.answerCbQuery('Already marked as Processing', { show_alert: true });
    if (order.status !== 'Pending')    return ctx.answerCbQuery(`Order is already ${order.status}`, { show_alert: true });

    const updated    = await markProcessing(orderId, ctx.from.id);
    const userTid    = order.userId?.telegramId;
    const shortId    = orderId.slice(-8).toUpperCase();

    if (userTid) {
      try {
        const trackMsg = await OrderTrackingService.sendProcessing(ctx.telegram, userTid, updated);
        if (trackMsg?.message_id) {
          await Order.findByIdAndUpdate(orderId, { trackingMsgId: trackMsg.message_id });
        }
      } catch (e) {
        console.error('[AdminOrders] Tracking update failed:', e.message);
      }
    }

    await ctx.reply(
      `🔄 *Order \`${shortId}\` — Marked as Processing*\n\n` +
      `👤 Customer has been notified with a live status update.`,
      { parse_mode: 'Markdown', ...adminOrderActionKeyboard() }
    );
  });

  // ── View order details ─────────────────────────────────────────────────────
  bot.action(/^admin_order_view:(.+)$/, requireRole('STAFF'), async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = ctx.match[1];
    const order = await Order.findById(orderId).populate('userId').populate('productId');
    if (!order) return ctx.reply('❌ Order not found.');

    await ctx.reply(
      `📋 *Order Details*\n\n${orderSummaryText(order)}`,
      { parse_mode: 'Markdown', ...adminOrderActionKeyboard() }
    );
  });

  // ── ⚠️ Warn User from order ────────────────────────────────────────────────
  bot.action(/^admin_warn_user:(.+)$/, requireRole('STAFF'), async (ctx) => {
    const orderId = ctx.match[1];
    await ctx.answerCbQuery();

    const order = await Order.findById(orderId).populate('userId');
    if (!order) return ctx.reply('❌ Order not found.');

    const userId  = order.userId?.telegramId;
    const userTag = order.userId?.username ? `@${order.userId.username}` : `ID: ${userId}`;

    if (!userId) return ctx.reply('❌ User not found on this order.');

    ctx.session.adminPendingAction = { type: 'warn_user', orderId, userId };

    await ctx.reply(
      `⚠️ *Issue Warning — Order* \`${orderId.slice(-8).toUpperCase()}\`\n\n` +
      `👤 User: *${userTag}*\n` +
      `📦 Product: *${order.productId?.name || 'Unknown'}*\n\n` +
      `📝 Send the *reason* for this warning:\n` +
      `_Warning levels: 1st → 3d Spin/CheckIn ban | 2nd → 7d all-rewards ban + coin penalty | 3rd → permanent ban_`,
      { parse_mode: 'Markdown', ...Markup.forceReply() }
    );
  });

  // ── Complete ───────────────────────────────────────────────────────────────
  bot.action(/^admin_complete:(.+)$/, requireRole('STAFF'), async (ctx) => {
    const orderId = ctx.match[1];
    await ctx.answerCbQuery();

    const order = await Order.findById(orderId).populate('productId').populate('userId');
    if (!order) return ctx.reply('❌ Order not found.');
    if (order.status !== 'Pending') return ctx.answerCbQuery(`Already ${order.status}`, { show_alert: true });

    if (order.productType === 'DigitalCode') {
      const ref = { chatId: ctx.chat.id, messageId: (await ctx.reply('⌛')).message_id };

      try {
        await checklist(ctx, ref, [
          { label: 'Pulling digital code',  delay: 600 },
          { label: 'Assigning to order',    delay: 700 },
          { label: 'Sending receipt',       delay: 600 },
        ], `✅ *Order completed! Code sent to customer.*`);

        const completedOrder = await completeOrder(orderId, ctx.from.id, null, ctx.telegram);
        await auditLog(ctx.from.id, 'ORDER_COMPLETED', orderId, 'Order', { auto: true });

        const customerTid = completedOrder.userId?.telegramId;
        if (customerTid) {
          try {
            const trackMsg = await OrderTrackingService.sendDeliveredReceipt(
              ctx.telegram, customerTid, completedOrder, completedOrder.deliveredData
            );
            if (trackMsg?.message_id) {
              await Order.findByIdAndUpdate(completedOrder._id, { trackingMsgId: trackMsg.message_id });
            }
          } catch (e) {
            await notifyCustomer(ctx, customerTid, `✅ *Order Complete!*\n\n📬 Your delivery:\n\`${completedOrder.deliveredData}\``);
          }
        }
      } catch (err) {
        await ctx.telegram.editMessageText(ref.chatId, ref.messageId, undefined, `❌ ${err.message}`);
      }

    } else {
      ctx.session.adminPendingAction = { type: 'complete', orderId };
      await ctx.reply(
        `✅ *Completing Order* \`${orderId.slice(-8).toUpperCase()}\`\n\n` +
        `📦 *${order.productId?.name}*\n` +
        `${orderInfoLines(order) || '🎮 Game ID: `N/A`\n'}` +
        `\n📝 Send the *delivery data* to the customer:`,
        { parse_mode: 'Markdown', ...Markup.forceReply() }
      );
    }
  });

  // ── Cancel & Refund ────────────────────────────────────────────────────────
  bot.action(/^admin_cancel_refund:(.+)$/, requireRole('STAFF'), async (ctx) => {
    const orderId = ctx.match[1];
    await ctx.answerCbQuery();

    const order = await Order.findById(orderId).populate('productId');
    if (!order) return ctx.reply('❌ Order not found.');
    if (order.status !== 'Pending') return ctx.answerCbQuery(`Already ${order.status}`, { show_alert: true });

    ctx.session.adminPendingAction = { type: 'cancel_refund', orderId };
    await ctx.reply(
      `❌ *Cancel & Refund* — \`${orderId.slice(-8).toUpperCase()}\`\n\n` +
      `📦 *${order.productId?.name}*\n💰 Refund: *${price(order.amount)}*\n\n` +
      `📝 Send the *reason* for cancellation:`,
      { parse_mode: 'Markdown', ...Markup.forceReply() }
    );
  });

  // ── Message User ──────────────────────────────────────────────────────────
  bot.action(/^admin_msg_user:(.+)$/, requireRole('STAFF'), async (ctx) => {
    const orderId = ctx.match[1];
    await ctx.answerCbQuery();

    const order = await Order.findById(orderId).populate('userId');
    if (!order) return ctx.reply('❌ Order not found.');

    ctx.session.adminPendingAction = {
      type: 'msg_user',
      orderId,
      userTelegramId: order.userId?.telegramId,
    };

    await ctx.reply(
      `💬 *Message User* — Order \`${orderId.slice(-8).toUpperCase()}\`\n\n` +
      `Send your message to the customer:`,
      { parse_mode: 'Markdown', ...Markup.forceReply() }
    );
  });


  // ── Reply-keyboard order action mode (no inline buttons) ───────────────────
  async function handleProcessing(ctx) {
    const order = await getSelectedOrder(ctx);
    if (!order) return;
    const orderId = order._id.toString();
    if (order.status === 'Processing') return ctx.reply('ℹ️ This order is already Processing.', adminOrderActionKeyboard());
    if (order.status !== 'Pending') return ctx.reply(`❌ Order is already ${order.status}.`, adminOrdersKeyboard());

    const updated = await markProcessing(orderId, ctx.from.id);
    const customerTid = order.userId?.telegramId;
    if (customerTid) {
      try {
        const trackMsg = await OrderTrackingService.sendProcessing(ctx.telegram, customerTid, updated);
        if (trackMsg?.message_id) await Order.findByIdAndUpdate(orderId, { trackingMsgId: trackMsg.message_id });
      } catch (e) {
        console.error('[AdminOrders] Tracking update failed:', e.message);
      }
    }
    await ctx.reply(`🔄 Order \`${orderId.slice(-8).toUpperCase()}\` marked as Processing.`, { parse_mode: 'Markdown', ...adminOrderActionKeyboard() });
  }

  async function handleComplete(ctx) {
    const order = await getSelectedOrder(ctx);
    if (!order) return;
    const orderId = order._id.toString();
    if (order.status !== 'Pending') return ctx.reply(`❌ Order is already ${order.status}.`, adminOrdersKeyboard());

    if (order.productType === 'DigitalCode') {
      const ref = { chatId: ctx.chat.id, messageId: (await ctx.reply('⌛ Completing digital code order...')).message_id };
      try {
        await checklist(ctx, ref, [
          { label: 'Pulling digital code', delay: 600 },
          { label: 'Assigning to order', delay: 700 },
          { label: 'Sending receipt', delay: 600 },
        ], `✅ *Order completed! Code sent to customer.*`);

        const completedOrder = await completeOrder(orderId, ctx.from.id, null, ctx.telegram);
        await auditLog(ctx.from.id, 'ORDER_COMPLETED', orderId, 'Order', { auto: true, ui: 'reply_keyboard' });
        const customerTid = completedOrder.userId?.telegramId;
        if (customerTid) {
          try {
            const trackMsg = await OrderTrackingService.sendDeliveredReceipt(ctx.telegram, customerTid, completedOrder, completedOrder.deliveredData);
            if (trackMsg?.message_id) await Order.findByIdAndUpdate(completedOrder._id, { trackingMsgId: trackMsg.message_id });
          } catch (e) {
            await notifyCustomer(ctx, customerTid, `✅ *Order Complete!*\n\n📬 Your delivery:\n\`${completedOrder.deliveredData}\``);
          }
        }
        ctx.session.adminSelectedOrderId = null;
        await ctx.reply('✅ Completed.', adminOrdersKeyboard());
      } catch (err) {
        await ctx.telegram.editMessageText(ref.chatId, ref.messageId, undefined, `❌ ${err.message}`).catch(() => {});
      }
      return;
    }

    ctx.session.adminPendingAction = { type: 'complete', orderId };
    await ctx.reply(
      `✅ *Completing Order* \`${orderId.slice(-8).toUpperCase()}\`\n\n` +
      `📦 *${order.productId?.name || 'Unknown'}*\n` +
      `${orderInfoLines(order) || '🎮 Game ID: `N/A`\n'}` +
      `\n📝 Send the *delivery data* to the customer:`,
      { parse_mode: 'Markdown', ...promptKeyboard() }
    );
  }

  async function handleCancelRefund(ctx) {
    const order = await getSelectedOrder(ctx);
    if (!order) return;
    const orderId = order._id.toString();
    if (order.status !== 'Pending') return ctx.reply(`❌ Order is already ${order.status}.`, adminOrdersKeyboard());
    ctx.session.adminPendingAction = { type: 'cancel_refund', orderId };
    await ctx.reply(
      `❌ *Cancel & Refund* — \`${orderId.slice(-8).toUpperCase()}\`\n\n` +
      `📦 *${order.productId?.name || 'Unknown'}*\n💰 Refund: *${price(order.amount)}*\n\n` +
      `📝 Send the *reason* for cancellation:`,
      { parse_mode: 'Markdown', ...promptKeyboard() }
    );
  }

  async function handleMessageUser(ctx) {
    const order = await getSelectedOrder(ctx);
    if (!order) return;
    const orderId = order._id.toString();
    const userTelegramId = order.userId?.telegramId;
    if (!userTelegramId) return ctx.reply('❌ User telegram ID not found on this order.', adminOrderActionKeyboard());
    ctx.session.adminPendingAction = { type: 'msg_user', orderId, userTelegramId };
    await ctx.reply(`💬 *Message User* — Order \`${orderId.slice(-8).toUpperCase()}\`\n\nSend your message to the customer:`, { parse_mode: 'Markdown', ...promptKeyboard() });
  }

  async function handleWarnUser(ctx) {
    const order = await getSelectedOrder(ctx);
    if (!order) return;
    const orderId = order._id.toString();
    const userId = order.userId?.telegramId;
    const userTag = order.userId?.username ? `@${order.userId.username}` : `ID: ${userId}`;
    if (!userId) return ctx.reply('❌ User not found on this order.', adminOrderActionKeyboard());
    ctx.session.adminPendingAction = { type: 'warn_user', orderId, userId };
    await ctx.reply(
      `⚠️ *Issue Warning — Order* \`${orderId.slice(-8).toUpperCase()}\`\n\n` +
      `👤 User: *${userTag}*\n📦 Product: *${order.productId?.name || 'Unknown'}*\n\n` +
      `📝 Send the *reason* for this warning:`,
      { parse_mode: 'Markdown', ...promptKeyboard() }
    );
  }

  bot.hears('✅ Complete', requireRole('STAFF'), handleComplete);
  bot.hears('🔄 Processing', requireRole('STAFF'), handleProcessing);
  bot.hears('❌ Cancel & Refund', requireRole('STAFF'), handleCancelRefund);
  bot.hears('💬 Message User', requireRole('STAFF'), handleMessageUser);
  bot.hears('⚠️ Warn User', requireRole('STAFF'), handleWarnUser);
  bot.hears('📜 Use Template', requireRole('STAFF'), async (ctx) => {
    const order = await getSelectedOrder(ctx);
    if (!order) return;
    await ctx.reply(
      `📜 Template mode is now reply-keyboard only.\n\n` +
      `For now, press ✅ Complete and paste the delivery/template text you want to send to the customer.`,
      adminOrderActionKeyboard()
    );
  });
  bot.hears(['⬅️ Back to Orders', '🔄 Refresh Orders', '📦 Manage Orders'], requireRole('STAFF'), async (ctx) => {
    const orders = await Order.find({ status: 'Pending' })
      .populate('userId', 'username telegramId')
      .populate('productId', 'name finalPrice productType')
      .sort({ timestamp: -1 })
      .limit(10);
    if (!orders.length) {
      ctx.session.adminSelectedOrderId = null;
      return ctx.reply('✅ No pending orders right now.', adminOrdersKeyboard());
    }
    await ctx.reply(`📦 Pending orders: ${orders.length}\n\nShowing latest order. Use /pendingorders to list all.`, adminOrdersKeyboard());
    return showOrderCard(ctx, orders[0]);
  });

  // ── Text interceptor: handle all admin pending actions ────────────────────
  bot.on('text', async (ctx, next) => {
    const action = ctx.session?.adminPendingAction;
    if (!action) return next();

    if (ctx.message?.text?.trim() === '❌ Cancel') {
      ctx.session.adminPendingAction = null;
      return ctx.reply('❌ Cancelled.', adminOrderActionKeyboard());
    }

    const adminOk = await isAnyAdmin(ctx.from?.id);
    if (!adminOk) return next();

    const { type, orderId, userTelegramId } = action;
    const input = ctx.message.text.trim();
    ctx.session.adminPendingAction = null;

    const ref = { chatId: ctx.chat.id, messageId: (await ctx.reply('⌛')).message_id };

    try {
      if (type === 'complete') {
        await checklist(ctx, ref, [
          { label: 'Completing order',    delay: 600 },
          { label: 'Saving delivery',     delay: 700 },
          { label: 'Sending receipt',     delay: 600 },
        ], `✅ *Order completed!*`);

        const order = await completeOrder(orderId, ctx.from.id, input, ctx.telegram);
        await auditLog(ctx.from.id, 'ORDER_COMPLETED', orderId, 'Order', { manual: true });

        const customerTid = order.userId?.telegramId;
        if (customerTid) {
          try {
            const trackMsg = await OrderTrackingService.sendDeliveredReceipt(ctx.telegram, customerTid, order, input);
            if (trackMsg?.message_id) {
              await Order.findByIdAndUpdate(order._id, { trackingMsgId: trackMsg.message_id });
            }
          } catch (e) {
            await notifyCustomer(ctx, customerTid, `✅ *Order Complete!*\n\n📬 Delivery:\n\`${input}\``);
          }
        }

        await ctx.reply(
          `✅ Order \`${orderId.slice(-8).toUpperCase()}\` completed. Tracking receipt sent to customer.`,
          { parse_mode: 'Markdown', ...adminOrdersKeyboard() }
        );

      } else if (type === 'cancel_refund') {
        await checklist(ctx, ref, [
          { label: 'Cancelling order',   delay: 600 },
          { label: 'Refunding wallet',   delay: 700 },
          { label: 'Notifying customer', delay: 600 },
        ], `❌ *Order cancelled & refunded.*`);

        const order = await cancelAndRefund(orderId, ctx.from.id, input);
        await auditLog(ctx.from.id, 'ORDER_CANCELLED_REFUNDED', orderId, 'Order', { reason: input });

        const customerTid = order.userId?.telegramId;
        if (customerTid) {
          try {
            await OrderTrackingService.sendCancelled(ctx.telegram, customerTid, order, input);
          } catch (e) {
            await notifyCustomer(ctx, customerTid,
              `❌ *Order Cancelled*\n\n💰 *${price(order.amount)}* refunded to your wallet\n📝 Reason: ${input}`
            );
          }
        }

        await ctx.reply(
          `❌ Order \`${orderId.slice(-8).toUpperCase()}\` cancelled. *${price(order.amount)}* refunded to customer.`,
          { parse_mode: 'Markdown' }
        );

      } else if (type === 'msg_user') {
        await ctx.telegram.deleteMessage(ref.chatId, ref.messageId).catch(() => {});

        await ctx.telegram.sendMessage(
          userTelegramId,
          `💬 *Message from Mental Gaming Store*\n\n${input}\n\n_Re: Order \`${orderId.slice(-8).toUpperCase()}\`_`,
          { parse_mode: 'Markdown' }
        );
        await ctx.reply(`✅ Message sent to customer.`);

      } else if (type === 'warn_user') {
        await ctx.telegram.deleteMessage(ref.chatId, ref.messageId).catch(() => {});

        const result = await issueWarning(action.userId, ctx.from.id, input, ctx.telegram);
        const { user, level, coinPenalty, expiresAt, autoBanned } = result;

        const durationText = expiresAt
          ? `until *${expiresAt.toLocaleDateString('en-GB')}*`
          : autoBanned ? '🚫 *Permanently Banned*' : 'indefinitely';

        const penaltyLine = coinPenalty > 0 ? `\n🪙 Coin Penalty: −${coinPenalty.toLocaleString()} MC` : '';

        await ctx.reply(
          `⚠️ *Warning ${level}/3 Issued*\n\n` +
          `🆔 User: \`${user.telegramId}\`\n` +
          `📝 Reason: ${input}` +
          penaltyLine + `\n` +
          `⏳ Restricted: ${durationText}\n` +
          `🔒 Rights: ${user.restrictedRights.join(', ') || 'none'}\n` +
          (autoBanned ? `\n🚫 *User has been permanently banned.*` : ''),
          { parse_mode: 'Markdown' }
        );

        await auditLog(ctx.from.id, 'WARN_FROM_ORDER', action.orderId, 'Order', {
          userId: action.userId,
          warningLevel: level,
          reason: input,
        });
      }
    } catch (err) {
      console.error('[AdminOrders] Error:', err.message);
      await ctx.telegram.editMessageText(ref.chatId, ref.messageId, undefined, `❌ ${err.message}`);
    }
  });

  // ── /pendingorders ─────────────────────────────────────────────────────────
  bot.command('pendingorders', requireRole('STAFF'), async (ctx) => {
    const orders = await Order.find({ status: 'Pending' })
      .populate('userId', 'username telegramId')
      .populate('productId', 'name finalPrice productType')
      .sort({ timestamp: -1 })
      .limit(10);

    if (!orders.length) return ctx.reply('✅ No pending orders right now.');

    for (const order of orders) {
      await showOrderCard(ctx, order);
    }
  });

  // ── /addcodes — Add digital gift card codes ────────────────────────────────
  bot.command('addcodes', requireRole('MANAGER'), async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (args.length < 2) {
      return ctx.reply(
        '📋 *Add Digital Codes*\n\nUsage:\n`/addcodes <productId> code1 code2 code3`\n\nEach code separated by space.',
        { parse_mode: 'Markdown' }
      );
    }

    const productId = args[0];
    const codes = args.slice(1);

    try {
      const { addDigitalCodes } = require('../services/OrderService');
      const count = await addDigitalCodes(productId, codes, ctx.from.id);
      await auditLog(ctx.from.id, 'DIGITAL_CODES_ADDED', productId, 'Product', { count });
      await ctx.reply(`✅ Added *${count}* digital codes to product \`${productId}\``, {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  // ── /flashsale — Activate a flash sale ────────────────────────────────────
  bot.command('flashsale', requireRole('MANAGER'), async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (args.length < 3) {
      return ctx.reply(
        '📋 *Flash Sale Setup*\n\n`/flashsale <productId> <salePrice> <durationHours>`\n\nExample: `/flashsale abc123 2500 4`',
        { parse_mode: 'Markdown' }
      );
    }

    const [productId, salePriceStr, durationStr] = args;
    const salePrice  = parseInt(salePriceStr, 10);
    const durationH  = parseFloat(durationStr);

    if (isNaN(salePrice) || isNaN(durationH)) return ctx.reply('❌ Invalid price or duration.');

    const start = new Date();
    const end   = new Date(start.getTime() + durationH * 60 * 60 * 1000);

    try {
      const { activateFlashSale } = require('../services/FlashSaleService');
      const product = await activateFlashSale(productId, salePrice, start, end);
      await auditLog(ctx.from.id, 'FLASH_SALE_ACTIVATED', productId, 'Product', { salePrice, durationH });
      await ctx.reply(
        `🔥 *Flash Sale Activated!*\n\n` +
        `📦 *${product.name}*\n` +
        `💰 Sale Price: *${salePrice.toLocaleString()} KS*\n` +
        `⏳ Duration: *${durationH}h*\n` +
        `📅 Ends: ${end.toLocaleString('en-GB', { timeZone: 'Asia/Rangoon' })} MMT`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });
};
