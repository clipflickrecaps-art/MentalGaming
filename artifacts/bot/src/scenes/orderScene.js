/**
 * Order Scene — Full order placement wizard
 *
 * Flow:
 *   Enter (productId in session)
 *   Step 0 → Show product summary + [✅ Confirm] [❌ Cancel]
 *   Action 'order_confirm' → ask for payment screenshot
 *   Step 1 → Receive photo → checklist animation → create order → notify admin → done
 */

const { Scenes, Markup } = require('telegraf');
const { config } = require('../../config/settings');
const { getTheme } = require('../services/ThemeService');
const { createOrder } = require('../controllers/orderController');
const { checklist, loadingMessage } = require('../utils/animations');
const { buildMessage, price, truncate } = require('../utils/ui');
const { auditLog } = require('../services/logger');
const Product = require('../models/Product');

function adminOrderKeyboard(orderId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Approve & Deliver', `admin_approve:${orderId}`)],
    [Markup.button.callback('❌ Cancel Order', `admin_cancel:${orderId}`)],
    [Markup.button.callback('👁 View Full Order', `admin_order_view:${orderId}`)],
  ]);
}

const orderScene = new Scenes.WizardScene(
  'order_scene',

  // ── Step 0: Load product → show summary + confirm buttons ─────────────
  async (ctx) => {
    const productId = ctx.session.orderProductId;
    if (!productId) {
      await ctx.reply('❌ Something went wrong. Please try again from the shop.');
      return ctx.scene.leave();
    }

    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      await ctx.reply('❌ This product is no longer available.');
      return ctx.scene.leave();
    }

    if (!product.isInStock()) {
      await ctx.reply('❌ This product is out of stock.');
      return ctx.scene.leave();
    }

    ctx.session.orderProduct = { id: product._id.toString(), name: product.name, price: product.finalPrice };

    const theme = getTheme(ctx.user);
    const stockLabel = product.stockCount === -1 ? '∞ Unlimited' : `${product.stockCount} left`;

    const text = buildMessage(theme, [
      {
        title: '🛒 Order Confirmation',
        lines: [
          `${theme.emoji.item} Product: ${theme.format.bold(product.name)}`,
          `🌍 Region: ${product.region}`,
          `📦 Category: ${product.category}`,
          `${theme.emoji.money} Price: ${theme.format.bold(price(product.finalPrice))}`,
          `📊 Stock: ${stockLabel}`,
          ``,
          `_Confirm to proceed. You will be asked to upload a payment screenshot._`,
        ],
      },
    ]);

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Confirm Order', 'order_confirm')],
        [Markup.button.callback('❌ Cancel', 'order_cancel_scene')],
      ]),
    });

    return ctx.wizard.next();
  },

  // ── Step 1: Wait for screenshot photo ─────────────────────────────────
  async (ctx) => {
    if (!ctx.message?.photo) {
      return ctx.reply('📸 Please upload your *payment screenshot* as a photo to complete the order.', {
        parse_mode: 'Markdown',
      });
    }

    const photo = ctx.message.photo;
    const fileId = photo[photo.length - 1].file_id;
    const productData = ctx.session.orderProduct;

    if (!productData) {
      await ctx.reply('❌ Session expired. Please start your order again.');
      return ctx.scene.leave();
    }

    // Animated checklist
    const ref = { chatId: ctx.chat.id, messageId: (await ctx.reply('⌛')).message_id };

    try {
      await checklist(ctx, ref,
        [
          { label: 'Receiving screenshot',   delay: 600 },
          { label: 'Verifying payment info', delay: 800 },
          { label: 'Creating your order',    delay: 700 },
          { label: 'Notifying admin',        delay: 600 },
        ],
        `✅ *Order placed successfully!*\n\n` +
        `📦 Product: *${productData.name}*\n` +
        `💰 Amount: *${price(productData.price)}*\n\n` +
        `_Your order is now Pending. You'll be notified once it's approved._`
      );

      const { order } = await createOrder(ctx.from.id, productData.id, fileId);

      await auditLog(ctx.from.id, 'ORDER_PLACED', order._id.toString(), 'Order', {
        product: productData.name,
        amount: productData.price,
      });

      // Notify admin
      await notifyAdmin(ctx, order, productData, fileId);

      ctx.session.orderProductId = null;
      ctx.session.orderProduct = null;
    } catch (err) {
      await ctx.telegram.editMessageText(ref.chatId, ref.messageId, undefined, `❌ Error: ${err.message}`);
    }

    return ctx.scene.leave();
  }
);

// ── Action: Confirm order → advance to screenshot step ────────────────────
orderScene.action('order_confirm', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await ctx.reply(
    `📸 *Upload Payment Screenshot*\n\n` +
    `Please send your payment screenshot as a *photo* to confirm your order.\n\n` +
    `_Make sure the transaction reference is visible._`,
    { parse_mode: 'Markdown' }
  );
  ctx.wizard.selectStep(1);
});

// ── Action: Cancel ─────────────────────────────────────────────────────────
orderScene.action('order_cancel_scene', async (ctx) => {
  await ctx.answerCbQuery('Order cancelled');
  await ctx.editMessageText('❌ Order cancelled. Browse the shop anytime with /shop.');
  ctx.session.orderProductId = null;
  ctx.session.orderProduct = null;
  return ctx.scene.leave();
});

// ── Helper: Send admin notification ───────────────────────────────────────
async function notifyAdmin(ctx, order, productData, screenshotFileId) {
  const user = ctx.from;
  const userTag = user.username ? `@${user.username}` : `ID: ${user.id}`;
  const orderId = order._id.toString();

  const caption =
    `🔔 *New Order — Action Required*\n\n` +
    `🆔 Order: \`${orderId.slice(-8).toUpperCase()}\`\n` +
    `👤 Customer: ${userTag} *(${user.first_name})*\n` +
    `📦 Product: *${productData.name}*\n` +
    `💰 Amount: *${price(productData.price)}*\n` +
    `🕐 Time: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Rangoon' })} MMT`;

  try {
    await ctx.telegram.sendPhoto(config.bot.adminId, screenshotFileId, {
      caption,
      parse_mode: 'Markdown',
      ...adminOrderKeyboard(orderId),
    });
  } catch (err) {
    console.error('[OrderScene] Failed to notify admin:', err.message);
  }
}

module.exports = orderScene;
