const { Markup } = require('telegraf');
const Nav = require('../services/NavigationService');
const { getTheme } = require('../services/ThemeService');
const { getUserOrders } = require('../controllers/orderController');
const { buildMessage, price, statusBadge, formatDate, truncate } = require('../utils/ui');
const Product = require('../models/Product');

Nav.register({
  id: 'my_orders',
  title: '📦 My Orders',
  build: async (ctx, theme) => {
    const orders = await getUserOrders(ctx.from.id);

    if (!orders.length) {
      return {
        text: buildMessage(theme, [
          {
            title: '📦 My Orders',
            lines: [
              `${theme.emoji.bullet} You have no orders yet.`,
              `${theme.emoji.store} Use /shop to browse products.`,
            ],
          },
        ]),
        keyboard: Markup.inlineKeyboard([
          [Markup.button.callback('🛒 Go to Shop', 'nav:go:shop')],
          [Nav.backButton('🔙 Main Menu')],
        ]),
      };
    }

    const recentOrders = orders.slice(0, 8);
    const rows = recentOrders.map((o) => {
      const productName = o.productId?.name ? truncate(o.productId.name, 22) : 'Unknown';
      const statusIcon = {
        Pending:   '🟡',
        Success:   '🟢',
        Cancelled: '🔴',
        Refunded:  '🔵',
      }[o.status] || '⚪';
      return [Markup.button.callback(
        `${statusIcon} ${productName} — ${price(o.amount)}`,
        `order_detail:${o._id}`
      )];
    });

    const pendingCount  = orders.filter((o) => o.status === 'Pending').length;
    const successCount  = orders.filter((o) => o.status === 'Success').length;

    const text = buildMessage(theme, [
      {
        title: '📦 My Orders',
        lines: [
          `${theme.emoji.bullet} Total: ${theme.format.bold(String(orders.length))}`,
          `🟡 Pending: ${pendingCount}  |  🟢 Completed: ${successCount}`,
          ``,
          `_Tap an order to view details:_`,
        ],
      },
    ]);

    return {
      text,
      keyboard: Markup.inlineKeyboard([...rows, [Nav.backButton('🔙 Main Menu')]]),
    };
  },
});

module.exports = function registerOrders(bot) {
  bot.command('orders', async (ctx) => {
    await Nav.navigate(ctx, 'my_orders');
  });

  bot.hears('📦 My Orders', async (ctx) => {
    await Nav.navigate(ctx, 'my_orders');
  });

  // Entry point: "Order Now" button from product page → enter order scene
  bot.action(/^order_start:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = ctx.match[1];
    ctx.session.orderProductId = productId;
    ctx.session.orderProduct = null;
    await ctx.scene.enter('order_scene');
  });

  // Order detail view
  bot.action(/^order_detail:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = ctx.match[1];
    const Order = require('../models/Order');

    try {
      const order = await Order.findById(orderId).populate('productId');
      if (!order) return ctx.reply('❌ Order not found.');

      const theme = getTheme(ctx.user);
      const product = order.productId;

      const lines = [
        `🆔 Order ID: ${theme.format.code(orderId.slice(-8).toUpperCase())}`,
        `📦 Product: ${theme.format.bold(product?.name || 'Unknown')}`,
        `💰 Amount: ${theme.format.bold(price(order.amount))}`,
        `📊 Status: ${statusBadge(order.status)}`,
        `🕐 Placed: ${formatDate(order.timestamp)}`,
      ];

      if (order.status === 'Success' && order.deliveredData) {
        lines.push(``, `${theme.emoji.success} *Delivery:*`);
        lines.push(theme.format.code(order.deliveredData));
      }

      if (order.status === 'Cancelled' && order.notes) {
        lines.push(``, `❌ *Cancel reason:* ${order.notes}`);
      }

      const text = buildMessage(theme, [{ title: '📦 Order Details', lines }]);

      const buttons = [[Nav.backButton('🔙 My Orders')]];
      if (order.status === 'Pending') {
        buttons.unshift([Markup.button.callback('❌ Cancel This Order', `user_cancel_order:${orderId}`)]);
      }

      await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  // User self-cancel
  bot.action(/^user_cancel_order:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = ctx.match[1];
    const { cancelOrder } = require('../controllers/orderController');

    try {
      await cancelOrder(orderId, ctx.from.id, 'Cancelled by customer');
      await ctx.editMessageText('❌ Your order has been cancelled.');
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });
};
