/**
 * /trackorder — Live order status lookup
 *
 * Usage:
 *   /trackorder            → list recent Pending/Processing orders with [Track] buttons
 *   /trackorder <shortId>  → show tracking card for that order (last-8 hex chars)
 *
 * Customers can only view their own orders.
 * Admins (STAFF+) can look up any order by short ID.
 *
 * A [🔄 Refresh] button is shown while the order is still active (Pending / Processing).
 * When complete, [📦 All Orders] nav button replaces it.
 */

const { Markup } = require('telegraf');
const { getTheme } = require('../services/ThemeService');
const { buildTimeline } = require('../services/OrderTrackingService');
const { buildMessage, price, formatDate } = require('../utils/ui');
const { isAnyAdmin } = require('../middlewares/adminCheck');
const Order = require('../models/Order');
const User  = require('../models/User');

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_ICON = {
  Pending:    '⏳',
  Processing: '🔄',
  Success:    '✅',
  Cancelled:  '❌',
  Refunded:   '💸',
};

const STATUS_LABEL = {
  Pending:    'Pending — awaiting processing',
  Processing: 'Processing — our team is on it',
  Success:    'Delivered ✅',
  Cancelled:  'Cancelled',
  Refunded:   'Refunded',
};

// ── Card builder ──────────────────────────────────────────────────────────────

function buildTrackingCard(order, theme) {
  const shortId     = order._id.toString().slice(-8).toUpperCase();
  const productName = order.productId?.name || 'Your Order';
  const icon        = STATUS_ICON[order.status] || '•';
  const statusLabel = STATUS_LABEL[order.status] || order.status;

  const gameIdLine = order.gameId
    ? `🎮 Game ID: ${theme.format.code(order.gameId)}${order.zoneId ? ` / Zone: ${order.zoneId}` : ''}`
    : null;
  const promoLine  = order.promoCode
    ? `🎟 Promo: ${theme.format.code(order.promoCode)}`
    : null;

  const timelineBlock = order.statusHistory?.length
    ? buildTimeline(order.statusHistory)
    : `  ⏳ — No updates yet`;

  const deliveryLines = order.status === 'Success' && order.deliveredData
    ? [``, `📬 *Delivery Data:*`, `\`${order.deliveredData}\``]
    : [];

  const cancelLines = order.status === 'Cancelled' && order.cancelReason
    ? [``, `📝 *Reason:* ${order.cancelReason}`]
    : [];

  const hasDiscount = (order.tierDiscount || 0) > 0 || (order.promoDiscount || 0) > 0;
  const priceLine   = hasDiscount
    ? `💰 Paid: *${price(order.amount)}* _(was ${price(order.originalAmount || order.amount)})_`
    : `💰 Paid: *${price(order.amount)}*`;

  const lines = [
    `🆔 Order: ${theme.format.code(shortId)}`,
    `📦 *${productName}*`,
    gameIdLine,
    promoLine,
    priceLine,
    `🗂 Type: ${order.productType === 'DigitalCode' ? '🎁 Digital Code' : '🎮 Direct Top-up'}`,
    `🕐 Placed: ${formatDate(order.timestamp)}`,
    ``,
    `${icon} *Status: ${statusLabel}*`,
    `\`━━━━━━━━━━━━━━━━━━━━━━\``,
    `🕐 *Timeline:*`,
    timelineBlock,
    ...deliveryLines,
    ...cancelLines,
  ].filter((l) => l !== null);

  return buildMessage(theme, [{ title: '📍 Order Tracking', lines }]);
}

// ── Keyboard ───────────────────────────────────────────────────────────────────

function trackKeyboard(orderId, isActive) {
  const rows = [];
  if (isActive) {
    rows.push([Markup.button.callback('🔄 Refresh Status', `track_refresh:${orderId}`)]);
  }
  rows.push([
    Markup.button.callback('📦 All Orders', 'nav:go:my_orders'),
  ]);
  return Markup.inlineKeyboard(rows);
}

// ── Short-ID lookup ────────────────────────────────────────────────────────────

async function findByShortId(shortId) {
  // MongoDB ObjectIds are 24-char hex; last 8 = unique enough for lookup
  return Order.find()
    .populate('productId', 'name productType')
    .populate('userId', 'telegramId username first_name')
    .sort({ timestamp: -1 })
    .limit(2000)
    .lean()
    .then((docs) => docs.filter((d) => d._id.toString().slice(-8).toUpperCase() === shortId));
}

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = function registerTrackOrder(bot) {

  // ── /trackorder [shortId] ─────────────────────────────────────────────────
  bot.command('trackorder', async (ctx) => {
    const arg       = ctx.message.text.split(/\s+/)[1]?.toUpperCase().trim();
    const theme     = getTheme(ctx.user);
    const adminFlag = await isAnyAdmin(ctx.from.id);

    // ── No arg: show list of active orders ──────────────────────────────────
    if (!arg) {
      let orders;
      if (adminFlag) {
        orders = await Order.find({ status: { $in: ['Pending', 'Processing'] } })
          .populate('productId', 'name')
          .populate('userId', 'username first_name telegramId')
          .sort({ timestamp: -1 })
          .limit(12);
      } else {
        const user = await User.findByTelegramId(ctx.from.id);
        if (!user) return ctx.reply('❌ User not found.');
        orders = await Order.find({ userId: user._id, status: { $in: ['Pending', 'Processing'] } })
          .populate('productId', 'name')
          .sort({ timestamp: -1 })
          .limit(8);
      }

      if (!orders.length) {
        return ctx.reply(
          buildMessage(theme, [{
            title: '📍 Order Tracking',
            lines: [
              `${theme.emoji.bullet} No active orders right now.`,
              `_All your recent orders are complete._`,
              ``,
              `Use \`/trackorder <ID>\` to look up any past order.`,
              `Use /orders to view your full history.`,
            ],
          }]),
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('📦 My Orders', 'nav:go:my_orders')]]),
          }
        );
      }

      const rows = orders.map((o) => {
        const shortId = o._id.toString().slice(-8).toUpperCase();
        const icon    = STATUS_ICON[o.status] || '•';
        const name    = (o.productId?.name || 'Order').slice(0, 22);
        const suffix  = adminFlag && o.userId?.username ? ` — @${o.userId.username}` : '';
        return [Markup.button.callback(
          `${icon} [${shortId}] ${name}${suffix}`,
          `track_show:${o._id}`
        )];
      });
      rows.push([Markup.button.callback('📦 All Orders', 'nav:go:my_orders')]);

      const headerLine = adminFlag
        ? `🔎 ${orders.length} active order${orders.length !== 1 ? 's' : ''} (Pending / Processing)`
        : `🔎 ${orders.length} active order${orders.length !== 1 ? 's' : ''} — tap to track`;

      return ctx.reply(
        buildMessage(theme, [{
          title:  '📍 Order Tracking',
          lines:  [headerLine, ``, `_Tap an order to see its live status:_`],
        }]),
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) }
      );
    }

    // ── With arg: look up by short ID ────────────────────────────────────────
    const candidates = await findByShortId(arg);

    if (!candidates.length) {
      return ctx.reply(
        `❌ No order found with ID \`${arg}\`.\n\n` +
        `_Use the last 8 characters of your order ID — e.g._ \`/trackorder ABC12345\``,
        { parse_mode: 'Markdown' }
      );
    }

    const order = candidates[0];

    // Ownership check for customers
    if (!adminFlag) {
      const user = await User.findByTelegramId(ctx.from.id);
      if (!user || order.userId?._id?.toString() !== user._id.toString()) {
        return ctx.reply(`❌ Order \`${arg}\` not found in your account.`, { parse_mode: 'Markdown' });
      }
    }

    const isActive = ['Pending', 'Processing'].includes(order.status);
    const text     = buildTrackingCard(order, theme);
    return ctx.reply(text, { parse_mode: 'Markdown', ...trackKeyboard(order._id.toString(), isActive) });
  });

  // ── [Track] inline button → show tracking card in a new message ───────────
  bot.action(/^track_show:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Loading status…');
    const orderId   = ctx.match[1];
    const theme     = getTheme(ctx.user);
    const adminFlag = await isAnyAdmin(ctx.from.id);

    try {
      const order = await Order.findById(orderId)
        .populate('productId', 'name productType')
        .populate('userId', 'telegramId username');
      if (!order) return ctx.reply('❌ Order not found.');

      if (!adminFlag) {
        const user = await User.findByTelegramId(ctx.from.id);
        if (!user || order.userId?._id?.toString() !== user._id.toString()) {
          return ctx.answerCbQuery('❌ This order is not in your account.', { show_alert: true });
        }
      }

      const isActive = ['Pending', 'Processing'].includes(order.status);
      const text     = buildTrackingCard(order, theme);
      await ctx.reply(text, { parse_mode: 'Markdown', ...trackKeyboard(orderId, isActive) });
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  // ── [🔄 Refresh] → edit card in-place with latest DB state ────────────────
  bot.action(/^track_refresh:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Refreshing…');
    const orderId   = ctx.match[1];
    const theme     = getTheme(ctx.user);
    const adminFlag = await isAnyAdmin(ctx.from.id);

    try {
      const order = await Order.findById(orderId)
        .populate('productId', 'name productType')
        .populate('userId', 'telegramId username');
      if (!order) return ctx.answerCbQuery('Order not found.', { show_alert: true });

      if (!adminFlag) {
        const user = await User.findByTelegramId(ctx.from.id);
        if (!user || order.userId?._id?.toString() !== user._id.toString()) {
          return ctx.answerCbQuery('❌ Access denied.', { show_alert: true });
        }
      }

      const isActive = ['Pending', 'Processing'].includes(order.status);
      const text     = buildTrackingCard(order, theme);

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...trackKeyboard(orderId, isActive),
      }).catch(() =>
        ctx.reply(text, { parse_mode: 'Markdown', ...trackKeyboard(orderId, isActive) })
      );
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });
};
