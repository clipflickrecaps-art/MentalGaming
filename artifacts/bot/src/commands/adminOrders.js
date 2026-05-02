/**
 * Admin Order Processing — Full Rewrite
 *
 * [✅ Complete]        → DirectTopup: ask delivery data → send receipt
 *                       DigitalCode: auto-pull code → send receipt
 * [❌ Cancel & Refund] → ask reason → cancelAndRefund → notify user
 * [💬 Message User]   → ask message → forward to user
 * [👁 View Details]   → show full order card
 */

const { Markup } = require('telegraf');
const { adminOnly } = require('../middlewares/adminCheck');
const { completeOrder, cancelAndRefund } = require('../services/OrderService');
const { checklist } = require('../utils/animations');
const { auditLog } = require('../services/logger');
const { price, formatDate } = require('../utils/ui');
const Order = require('../models/Order');
const { config } = require('../../config/settings');

// ── Professional receipt ──────────────────────────────────────────────────────
function buildReceipt(order, deliveredData) {
  const shortId  = order._id.toString().slice(-8).toUpperCase();
  const product  = order.productId?.name || 'Unknown Product';
  const now      = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Rangoon' });
  const promoLine = order.promoCode
    ? `🎟 Promo: \`${order.promoCode}\` \\(\\-${order.promoDiscount?.toLocaleString() || 0} KS\\)\n`
    : '';
  const idLine = order.gameId
    ? `🎮 Game ID: \`${order.gameId}\`${order.zoneId ? ` / Zone: \`${order.zoneId}\`` : ''}\n`
    : '';

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
  const idLine   = order.gameId ? `\n🎮 Game ID: \`${order.gameId}\`${order.zoneId ? ` (Zone: ${order.zoneId})` : ''}` : '';
  const typeIcon = order.productType === 'DigitalCode' ? '🎁' : '🎮';

  return (
    `🆔 Order: \`${order._id.toString().slice(-8).toUpperCase()}\`\n` +
    `👤 Customer: ${user}\n` +
    `📦 Product: ${product}\n` +
    `${typeIcon} Type: ${order.productType}` +
    idLine +
    `\n💰 Amount: ${price(order.amount)}\n` +
    `📊 Status: ${order.status}\n` +
    `🕐 Placed: ${formatDate(order.timestamp)}`
  );
}

async function notifyCustomer(ctx, telegramId, text, extra = {}) {
  try {
    await ctx.telegram.sendMessage(telegramId, text, { parse_mode: 'Markdown', ...extra });
  } catch (err) {
    console.error(`[AdminOrders] Notify failed for ${telegramId}:`, err.message);
  }
}

module.exports = function registerAdminOrders(bot) {

  // ── View order details ─────────────────────────────────────────────────────
  bot.action(/^admin_order_view:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = ctx.match[1];
    const order = await Order.findById(orderId).populate('userId').populate('productId');
    if (!order) return ctx.reply('❌ Order not found.');

    await ctx.reply(
      `📋 *Order Details*\n\n${orderSummaryText(order)}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Complete', `admin_complete:${orderId}`)],
          [Markup.button.callback('❌ Cancel & Refund', `admin_cancel_refund:${orderId}`)],
          [Markup.button.callback('💬 Message User', `admin_msg_user:${orderId}`)],
        ]),
      }
    );
  });

  // ── Complete (DirectTopup: ask delivery, DigitalCode: auto) ───────────────
  bot.action(/^admin_complete:(.+)$/, adminOnly(), async (ctx) => {
    const orderId = ctx.match[1];
    await ctx.answerCbQuery();

    const order = await Order.findById(orderId).populate('productId').populate('userId');
    if (!order) return ctx.reply('❌ Order not found.');
    if (order.status !== 'Pending') return ctx.answerCbQuery(`Already ${order.status}`, { show_alert: true });

    if (order.productType === 'DigitalCode') {
      // Auto-pull code
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
          await notifyCustomer(ctx, customerTid,
            buildReceipt(completedOrder, completedOrder.deliveredData),
            { parse_mode: 'MarkdownV2' }
          );
        }
      } catch (err) {
        await ctx.telegram.editMessageText(ref.chatId, ref.messageId, undefined, `❌ ${err.message}`);
      }

    } else {
      // DirectTopup: ask for delivery data
      ctx.session.adminPendingAction = { type: 'complete', orderId };
      await ctx.reply(
        `✅ *Completing Order* \`${orderId.slice(-8).toUpperCase()}\`\n\n` +
        `📦 *${order.productId?.name}*\n🎮 Game ID: \`${order.gameId || 'N/A'}\`\n\n` +
        `📝 Send the *delivery data* to the customer:`,
        { parse_mode: 'Markdown', ...Markup.forceReply() }
      );
    }
  });

  // ── Cancel & Refund ────────────────────────────────────────────────────────
  bot.action(/^admin_cancel_refund:(.+)$/, adminOnly(), async (ctx) => {
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
  bot.action(/^admin_msg_user:(.+)$/, adminOnly(), async (ctx) => {
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

  // ── Text interceptor: handle all admin pending actions ────────────────────
  bot.on('text', async (ctx, next) => {
    const action = ctx.session?.adminPendingAction;
    if (!action || ctx.from.id !== config.bot.adminId) return next();

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
          await notifyCustomer(ctx, customerTid,
            buildReceipt(order, input),
            { parse_mode: 'MarkdownV2' }
          );
        }

        await ctx.reply(
          `✅ Order \`${orderId.slice(-8).toUpperCase()}\` completed. Receipt sent to customer.`,
          { parse_mode: 'Markdown' }
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
          await notifyCustomer(ctx, customerTid,
            `❌ *Your order has been cancelled.*\n\n` +
            `📦 *${order.productId?.name || 'Your order'}*\n` +
            `💰 Refund: *${price(order.amount)}* returned to your wallet\n` +
            `📝 Reason: ${input}\n\n` +
            `_Contact /support if you have questions._`
          );
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
      }
    } catch (err) {
      console.error('[AdminOrders] Error:', err.message);
      await ctx.telegram.editMessageText(ref.chatId, ref.messageId, undefined, `❌ ${err.message}`);
    }
  });

  // ── /pendingorders ─────────────────────────────────────────────────────────
  bot.command('pendingorders', adminOnly(), async (ctx) => {
    const orders = await Order.find({ status: 'Pending' })
      .populate('userId', 'username telegramId')
      .populate('productId', 'name finalPrice productType')
      .sort({ timestamp: -1 })
      .limit(10);

    if (!orders.length) return ctx.reply('✅ No pending orders right now.');

    for (const order of orders) {
      await ctx.reply(`🟡 *Pending Order*\n\n${orderSummaryText(order)}`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Complete', `admin_complete:${order._id}`)],
          [Markup.button.callback('❌ Cancel & Refund', `admin_cancel_refund:${order._id}`)],
          [Markup.button.callback('💬 Message', `admin_msg_user:${order._id}`)],
        ]),
      });
    }
  });

  // ── /addcodes — Add digital gift card codes ────────────────────────────────
  bot.command('addcodes', adminOnly(), async (ctx) => {
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
      await ctx.reply(`✅ Added *${count}* digital codes to product \`${productId}\``, {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  // ── /flashsale — Activate a flash sale ────────────────────────────────────
  bot.command('flashsale', adminOnly(), async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (args.length < 4) {
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
