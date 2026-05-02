/**
 * Admin Order Processing
 *
 * Handles approve / cancel actions sent to admin from order notifications.
 * Uses session-based pending action to intercept admin text input for:
 *   - Delivery data (on approve)
 *   - Cancel reason (on cancel)
 *
 * After action → notifies the customer via Telegram message.
 */

const { Markup } = require('telegraf');
const { adminOnly } = require('../middlewares/adminCheck');
const { processOrder, cancelOrder } = require('../controllers/orderController');
const { checklist } = require('../utils/animations');
const { auditLog } = require('../services/logger');
const { price, statusBadge, formatDate } = require('../utils/ui');
const Order = require('../models/Order');
const { config } = require('../../config/settings');

function orderSummaryText(order) {
  const product = order.productId?.name || 'Unknown';
  const user = order.userId?.username ? `@${order.userId.username}` : `ID: ${order.userId?.telegramId}`;
  return (
    `🆔 *Order:* \`${order._id.toString().slice(-8).toUpperCase()}\`\n` +
    `👤 *Customer:* ${user}\n` +
    `📦 *Product:* ${product}\n` +
    `💰 *Amount:* ${price(order.amount)}\n` +
    `📊 *Status:* ${statusBadge(order.status)}\n` +
    `🕐 *Placed:* ${formatDate(order.timestamp)}`
  );
}

async function notifyCustomer(ctx, telegramId, text) {
  try {
    await ctx.telegram.sendMessage(telegramId, text, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error(`[AdminOrders] Failed to notify customer ${telegramId}:`, err.message);
  }
}

module.exports = function registerAdminOrders(bot) {

  // ── View order detail ────────────────────────────────────────────────────
  bot.action(/^admin_order_view:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = ctx.match[1];

    try {
      const order = await Order.findById(orderId).populate('userId').populate('productId');
      if (!order) return ctx.reply('❌ Order not found.');

      const text = `📋 *Order Details*\n\n${orderSummaryText(order)}`;
      await ctx.reply(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Approve & Deliver', `admin_approve:${orderId}`)],
          [Markup.button.callback('❌ Cancel Order',      `admin_cancel:${orderId}`)],
        ]),
      });
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  // ── Approve: prompt admin for delivery data ───────────────────────────────
  bot.action(/^admin_approve:(.+)$/, adminOnly(), async (ctx) => {
    const orderId = ctx.match[1];
    await ctx.answerCbQuery();

    const order = await Order.findById(orderId).populate('productId');
    if (!order) return ctx.reply('❌ Order not found.');
    if (order.status !== 'Pending') {
      return ctx.answerCbQuery(`Order is already ${order.status}`, { show_alert: true });
    }

    ctx.session.adminPendingAction = { type: 'approve', orderId };

    await ctx.reply(
      `✅ *Approving Order* \`${orderId.slice(-8).toUpperCase()}\`\n\n` +
      `📦 Product: *${order.productId?.name}*\n\n` +
      `📝 *Send the delivery data* (game code, account info, etc.) to complete this order:\n` +
      `_Type and send your reply now._`,
      { parse_mode: 'Markdown', ...Markup.forceReply() }
    );
  });

  // ── Cancel: prompt admin for reason ──────────────────────────────────────
  bot.action(/^admin_cancel:(.+)$/, adminOnly(), async (ctx) => {
    const orderId = ctx.match[1];
    await ctx.answerCbQuery();

    const order = await Order.findById(orderId).populate('productId');
    if (!order) return ctx.reply('❌ Order not found.');
    if (order.status !== 'Pending') {
      return ctx.answerCbQuery(`Order is already ${order.status}`, { show_alert: true });
    }

    ctx.session.adminPendingAction = { type: 'cancel', orderId };

    await ctx.reply(
      `❌ *Cancelling Order* \`${orderId.slice(-8).toUpperCase()}\`\n\n` +
      `📦 Product: *${order.productId?.name}*\n\n` +
      `📝 *Send the cancel reason* for the customer:`,
      { parse_mode: 'Markdown', ...Markup.forceReply() }
    );
  });

  // ── Global text interceptor: handle admin delivery data / cancel reason ───
  bot.on('text', async (ctx, next) => {
    const action = ctx.session?.adminPendingAction;
    if (!action || ctx.from.id !== config.bot.adminId) return next();

    const { type, orderId } = action;
    const input = ctx.message.text.trim();
    ctx.session.adminPendingAction = null;

    const ref = { chatId: ctx.chat.id, messageId: (await ctx.reply('⌛')).message_id };

    try {
      if (type === 'approve') {
        await checklist(ctx, ref,
          [
            { label: 'Verifying order',       delay: 600 },
            { label: 'Processing approval',   delay: 700 },
            { label: 'Saving delivery data',  delay: 600 },
            { label: 'Notifying customer',    delay: 700 },
          ],
          `✅ *Order approved and delivered!*`
        );

        const order = await processOrder(orderId, ctx.from.id, input);
        await auditLog(ctx.from.id, 'ORDER_APPROVED', orderId, 'Order', { deliveredData: '(hidden)' });

        const customerTelegramId = order.userId?.telegramId;
        if (customerTelegramId) {
          await notifyCustomer(ctx, customerTelegramId,
            `✅ *Your order is complete!*\n\n` +
            `📦 *${order.productId?.name}*\n\n` +
            `📬 *Your delivery:*\n\`${input}\`\n\n` +
            `_Thank you for shopping at Mental Gaming Store!_ 🎮`
          );
        }

        await ctx.reply(
          `✅ Order \`${orderId.slice(-8).toUpperCase()}\` approved.\nCustomer has been notified.`,
          { parse_mode: 'Markdown' }
        );

      } else if (type === 'cancel') {
        await checklist(ctx, ref,
          [
            { label: 'Processing cancellation', delay: 600 },
            { label: 'Notifying customer',       delay: 700 },
          ],
          `❌ *Order cancelled.*`
        );

        const order = await cancelOrder(orderId, ctx.from.id, input);
        await auditLog(ctx.from.id, 'ORDER_CANCELLED', orderId, 'Order', { reason: input });

        const customerTelegramId = order.userId?.telegramId;
        if (customerTelegramId) {
          const fullOrder = await Order.findById(orderId).populate('productId');
          await notifyCustomer(ctx, customerTelegramId,
            `❌ *Your order has been cancelled.*\n\n` +
            `📦 *${fullOrder?.productId?.name || 'Your order'}*\n\n` +
            `📝 *Reason:* ${input}\n\n` +
            `_Contact support if you have questions: /support_`
          );
        }

        await ctx.reply(
          `❌ Order \`${orderId.slice(-8).toUpperCase()}\` cancelled.\nCustomer has been notified.`,
          { parse_mode: 'Markdown' }
        );
      }
    } catch (err) {
      console.error('[AdminOrders] Action failed:', err.message);
      await ctx.telegram.editMessageText(ref.chatId, ref.messageId, undefined, `❌ Error: ${err.message}`);
    }
  });

  // ── /pendingorders command ────────────────────────────────────────────────
  bot.command('pendingorders', adminOnly(), async (ctx) => {
    const orders = await Order.find({ status: 'Pending' })
      .populate('userId', 'username telegramId first_name')
      .populate('productId', 'name finalPrice')
      .sort({ timestamp: -1 })
      .limit(10);

    if (!orders.length) {
      return ctx.reply('✅ No pending orders right now.');
    }

    for (const order of orders) {
      const text = `🟡 *Pending Order*\n\n${orderSummaryText(order)}`;
      await ctx.reply(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Approve',    `admin_approve:${order._id}`)],
          [Markup.button.callback('❌ Cancel',     `admin_cancel:${order._id}`)],
          [Markup.button.callback('👁 View Detail', `admin_order_view:${order._id}`)],
        ]),
      });
    }
  });
};
