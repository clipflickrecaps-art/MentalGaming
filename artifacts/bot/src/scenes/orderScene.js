/**
 * OrderWizard Scene — Full Rewrite
 *
 * Flow:
 *   Step 0 → Product summary + balance check → [▶️ Order Now] or [💳 Top Up]
 *   Step 1 → DirectTopup: address book or manual Game ID input
 *            DigitalCode: skip to step 2 automatically
 *   Step 2 → Promo code input (with [⏭ Skip] button)
 *   Step 3 → Order summary → [✅ Confirm] [❌ Cancel]
 *   (Execution) → deduct wallet → create order → animate → notify admin
 */

const { Scenes, Markup } = require('telegraf');
const { config } = require('../../config/settings');
const { getTheme } = require('../services/ThemeService');
const { createOrder } = require('../services/OrderService');
const { applyTierDiscount } = require('../services/MembershipService');
const { getEntries, formatEntry } = require('../services/AddressBookService');
const { validatePromo, applyPromo } = require('../services/PromoService');
const { checklist } = require('../utils/animations');
const { buildMessage, price, formatDate } = require('../utils/ui');
const { auditLog } = require('../services/logger');
const { flashLabel, formatCountdown } = require('../services/FlashSaleService');
const Product = require('../models/Product');
const User = require('../models/User');

// ── Games that require Zone ID ────────────────────────────────────────────────
const ZONE_REQUIRED = ['mobile legends', 'ml', 'moonton'];

function needsZone(gameName = '') {
  return ZONE_REQUIRED.some((g) => gameName.toLowerCase().includes(g));
}

// ── Admin notification keyboard ───────────────────────────────────────────────
function adminOrderKeyboard(orderId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Complete Order',      `admin_complete:${orderId}`)],
    [Markup.button.callback('❌ Cancel & Refund',     `admin_cancel_refund:${orderId}`)],
    [Markup.button.callback('💬 Message User',        `admin_msg_user:${orderId}`)],
    [Markup.button.callback('👁 View Details',        `admin_order_view:${orderId}`)],
  ]);
}

const orderScene = new Scenes.WizardScene(
  'order_scene',

  // ── Step 0: Product summary + balance check ───────────────────────────────
  async (ctx) => {
    const productId = ctx.session.orderProductId;
    if (!productId) {
      await ctx.reply('❌ Something went wrong. Please start from the /shop.');
      return ctx.scene.leave();
    }

    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      await ctx.reply('❌ This product is no longer available.');
      return ctx.scene.leave();
    }
    if (!product.isInStock()) {
      await ctx.reply('❌ This product is currently out of stock.');
      return ctx.scene.leave();
    }

    const user = await User.findByTelegramId(ctx.from.id);
    if (!user) return ctx.scene.leave();

    const { price: effectivePrice, isFlashSale, msLeft } = product.getEffectivePrice();
    const stockLabel = product.stockCount === -1 ? '∞ Unlimited' : `${product.stockCount} left`;
    const theme = getTheme(ctx.user);

    // ── Apply tier discount (after flash sale, before promo) ─────────────────
    const tier = user.membershipTier || 'Silver';
    const tierResult = applyTierDiscount(effectivePrice, tier);
    const tierDiscount    = tierResult.discount;
    const tierDiscountPct = tierResult.pct;
    const priceAfterTier  = tierResult.finalPrice;

    ctx.session.orderSession = {
      productId: product._id.toString(),
      productName: product.name,
      productType: product.productType,
      originalPrice: product.finalPrice,
      flashSalePrice: isFlashSale ? effectivePrice : null,
      isFlashSale,
      tierDiscount,
      tierDiscountPct,
      effectivePrice: priceAfterTier,   // price after flash + tier, before promo
      gameName: product.category,
      gameId: null,
      zoneId: null,
      promoCode: null,
      promoDiscount: 0,
      finalAmount: priceAfterTier,
    };

    const hasBalance = user.balanceKS >= priceAfterTier;
    const balanceLine = hasBalance
      ? `💰 Your Balance: ${theme.format.bold(price(user.balanceKS))} ✅`
      : `💰 Your Balance: ${theme.format.bold(price(user.balanceKS))} ❌ _(Need ${price(priceAfterTier - user.balanceKS)} more)_`;

    const tierBadgeMap = { Silver: '🥈', Gold: '🥇', Platinum: '💎' };
    const flashLine = isFlashSale
      ? [`🔥 *FLASH SALE* — ⏳ Ends in: *${formatCountdown(msLeft)}*`]
      : [];
    const tierLine = tierDiscount > 0
      ? [`${tierBadgeMap[tier]} ${tier} Discount (${tierDiscountPct}%): *−${price(tierDiscount)}*`]
      : [];

    const text = buildMessage(theme, [{
      title: '🛒 Order Summary',
      lines: [
        `${theme.emoji.item} *${product.name}*`,
        `🗂 Type: ${product.productType === 'DigitalCode' ? '🎁 Digital Code' : '🎮 Direct Top-up'}`,
        `🌍 Region: ${product.region}`,
        ...flashLine,
        isFlashSale
          ? `${theme.emoji.money} Price: ~~${price(product.finalPrice)}~~ → *${price(effectivePrice)}*`
          : `${theme.emoji.money} Price: ${theme.format.bold(price(product.finalPrice))}`,
        ...tierLine,
        tierDiscount > 0
          ? `✨ Your Price: ${theme.format.bold(price(priceAfterTier))}`
          : null,
        `📦 Stock: ${stockLabel}`,
        ``,
        balanceLine,
      ].filter(Boolean),
    }]);

    if (!hasBalance) {
      await ctx.reply(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('💳 Top Up Wallet', 'start_topup')],
          [Markup.button.callback('❌ Cancel', 'order_cancel_scene')],
        ]),
      });
      return ctx.scene.leave();
    }

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('▶️ Order Now', 'order_proceed')],
        [Markup.button.callback('❌ Cancel', 'order_cancel_scene')],
      ]),
    });

    return ctx.wizard.next();
  },

  // ── Step 1: Game ID (DirectTopup) or auto-skip (DigitalCode) ─────────────
  async (ctx) => {
    const sess = ctx.session.orderSession;
    if (!sess) { await ctx.reply('❌ Session expired.'); return ctx.scene.leave(); }

    if (sess.productType === 'DigitalCode') {
      ctx.wizard.selectStep(2);
      return ctx.wizard.steps[2](ctx);
    }

    // Show address book if entries exist
    if (ctx.session._addressBookShown) {
      // Waiting for manual game ID text
      if (!ctx.message?.text) return ctx.reply('Please enter your Game ID:');
      const input = ctx.message.text.trim().split(/\s+/);
      sess.gameId = input[0];
      sess.zoneId = input[1] || null;
      ctx.session._addressBookShown = false;
      return ctx.wizard.selectStep(2), ctx.wizard.steps[2](ctx);
    }

    // Fetch saved addresses
    const savedIds = await getEntries(ctx.from.id, sess.gameName);
    if (savedIds.length > 0) {
      const buttons = savedIds.slice(0, 5).map((e) => [
        Markup.button.callback(
          `${e.isDefault ? '⭐ ' : ''}${formatEntry(e)}`,
          `order_pick_id:${e._id}`
        ),
      ]);
      buttons.push([Markup.button.callback('➕ Enter New ID', 'order_new_id')]);
      buttons.push([Markup.button.callback('❌ Cancel', 'order_cancel_scene')]);

      await ctx.reply(
        `🎮 *Choose your Game ID*\n\nSelect a saved account or enter a new one:`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
      );
    } else {
      await askForGameId(ctx, sess);
    }

    return ctx.wizard.next();
  },

  // ── Step 2: Promo code input ──────────────────────────────────────────────
  async (ctx) => {
    const sess = ctx.session.orderSession;
    if (!sess) { await ctx.reply('❌ Session expired.'); return ctx.scene.leave(); }

    // If arriving via text (promo code input)
    if (ctx.message?.text && !ctx.message.text.startsWith('/')) {
      const code = ctx.message.text.trim();
      const result = await validatePromo(code, ctx.from.id, sess.effectivePrice);

      if (!result.valid) {
        await ctx.reply(`❌ ${result.error}\n\nTry another code or tap ⏭ Skip:`, {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⏭ Skip Promo', 'order_skip_promo')],
            [Markup.button.callback('❌ Cancel', 'order_cancel_scene')],
          ]),
        });
        return;
      }

      sess.promoCode = code.toUpperCase();
      sess.promoDiscount = result.discount;
      sess.finalAmount = Math.max(0, sess.effectivePrice - result.discount);
      return ctx.wizard.selectStep(3), ctx.wizard.steps[3](ctx);
    }

    // Prompt for promo code
    await ctx.reply(
      `🎟 *Promo Code*\n\nDo you have a promo code? Enter it below or skip:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⏭ Skip', 'order_skip_promo')],
          [Markup.button.callback('❌ Cancel', 'order_cancel_scene')],
        ]),
      }
    );

    return ctx.wizard.next();
  },

  // ── Step 3: Order confirmation ────────────────────────────────────────────
  async (ctx) => {
    const sess = ctx.session.orderSession;
    if (!sess) { await ctx.reply('❌ Session expired.'); return ctx.scene.leave(); }

    const user = await User.findByTelegramId(ctx.from.id);
    const theme = getTheme(ctx.user);

    const promoLine = sess.promoCode
      ? [`🎟 Promo *${sess.promoCode}*: −${price(sess.promoDiscount)}`]
      : [];
    const gameIdLine = sess.gameId
      ? [`🎮 Game ID: ${theme.format.code(sess.gameId)}${sess.zoneId ? ` / Zone: ${sess.zoneId}` : ''}`]
      : [];
    const tierBadgeMap = { Silver: '🥈', Gold: '🥇', Platinum: '💎' };
    const userTier = user?.membershipTier || 'Silver';
    const tierLine = sess.tierDiscount > 0
      ? [`${tierBadgeMap[userTier]} ${userTier} Discount (${sess.tierDiscountPct}%): −${price(sess.tierDiscount)}`]
      : [];
    const flashLine = sess.isFlashSale
      ? [`🔥 Flash Sale Price: ${price(sess.flashSalePrice || sess.originalPrice)}`]
      : [];
    const hasAnyDiscount = sess.tierDiscount > 0 || sess.promoDiscount > 0 || sess.isFlashSale;

    const text = buildMessage(theme, [{
      title: '✅ Confirm Order',
      lines: [
        `📦 *${sess.productName}*`,
        ...gameIdLine,
        ``,
        `💰 Original Price: ${price(sess.originalPrice)}`,
        ...flashLine,
        ...tierLine,
        ...promoLine,
        hasAnyDiscount ? `──────────────` : null,
        `✨ *Final Price: ${price(sess.finalAmount)}*`,
        `💳 Balance After: *${price((user?.balanceKS || 0) - sess.finalAmount)}*`,
        ``,
        `_Tap Confirm to place your order._`,
      ].filter(Boolean),
    }]);

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Confirm Order', 'order_final_confirm')],
        [Markup.button.callback('❌ Cancel', 'order_cancel_scene')],
      ]),
    });

    return ctx.wizard.next();
  },

  // ── Step 4: Execution placeholder ────────────────────────────────────────
  async (ctx) => ctx.scene.leave()
);

// ── Helpers ────────────────────────────────────────────────────────────────────
async function askForGameId(ctx, sess) {
  const zoneHint = needsZone(sess.gameName) ? '\n_Zone ID is required for Mobile Legends (e.g. `12345 9001`)_' : '';
  await ctx.reply(
    `🎮 *Enter your Game ID*${zoneHint}\n\nType your Player ID${needsZone(sess.gameName) ? ' and Zone ID separated by a space' : ''}:`,
    { parse_mode: 'Markdown' }
  );
  ctx.session._addressBookShown = true;
}

// ── Action: Proceed to game ID step ────────────────────────────────────────────
orderScene.action('order_proceed', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  ctx.wizard.selectStep(1);
  return ctx.wizard.steps[1](ctx);
});

// ── Action: Pick saved address book ID ─────────────────────────────────────────
orderScene.action(/^order_pick_id:(.+)$/, async (ctx) => {
  const { AddressBook } = require('../models/AddressBook');
  await ctx.answerCbQuery();
  const entryId = ctx.match[1];
  const AddressBookModel = require('../models/AddressBook');
  const entry = await AddressBookModel.findById(entryId);
  if (!entry) return ctx.reply('❌ ID not found.');

  const sess = ctx.session.orderSession;
  sess.gameId = entry.gameId;
  sess.zoneId = entry.zoneId;
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await ctx.reply(`✅ Using: ${formatEntry(entry)}`);

  ctx.wizard.selectStep(2);
  return ctx.wizard.steps[2](ctx);
});

// ── Action: Enter new game ID ──────────────────────────────────────────────────
orderScene.action('order_new_id', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await askForGameId(ctx, ctx.session.orderSession);
});

// ── Action: Skip promo ─────────────────────────────────────────────────────────
orderScene.action('order_skip_promo', async (ctx) => {
  await ctx.answerCbQuery('Skipping promo');
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  ctx.wizard.selectStep(3);
  return ctx.wizard.steps[3](ctx);
});

// ── Action: Final confirm → execute order ─────────────────────────────────────
orderScene.action('order_final_confirm', async (ctx) => {
  await ctx.answerCbQuery('Processing...');
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

  const sess = ctx.session.orderSession;
  if (!sess) {
    await ctx.reply('❌ Session expired. Please try again from /shop.');
    return ctx.scene.leave();
  }

  const ref = { chatId: ctx.chat.id, messageId: (await ctx.reply('⌛')).message_id };

  try {
    await checklist(ctx, ref, [
      { label: 'Validating balance',    delay: 600 },
      { label: 'Deducting wallet',      delay: 700 },
      { label: 'Creating order',        delay: 700 },
      { label: 'Notifying admin',       delay: 600 },
    ],
      `✅ *Order placed!*\n\n` +
      `📦 ${sess.productName}\n` +
      `💰 ${price(sess.finalAmount)} deducted\n\n` +
      `_Your order is Pending. You'll be notified once it's complete._`
    );

    const { order } = await createOrder(ctx.from.id, sess.productId, {
      gameId: sess.gameId,
      zoneId: sess.zoneId,
      gameName: sess.gameName,
      promoCode: sess.promoCode,
      promoDiscount: sess.promoDiscount,
      tierDiscount: sess.tierDiscount || 0,
      tierDiscountPct: sess.tierDiscountPct || 0,
      finalAmount: sess.finalAmount,
    });

    if (sess.promoCode) {
      await applyPromo(sess.promoCode, ctx.from.id).catch(() => {});
    }

    await auditLog(ctx.from.id, 'ORDER_PLACED', order._id.toString(), 'Order', {
      product: sess.productName,
      amount: sess.finalAmount,
      type: sess.productType,
    });

    await notifyAdmin(ctx, order, sess);

    ctx.session.orderSession = null;
    ctx.session.orderProductId = null;
    ctx.session._addressBookShown = false;
  } catch (err) {
    await ctx.telegram.editMessageText(ref.chatId, ref.messageId, undefined, `❌ ${err.message}`);
  }

  return ctx.scene.leave();
});

// ── Action: Cancel ─────────────────────────────────────────────────────────────
orderScene.action('order_cancel_scene', async (ctx) => {
  await ctx.answerCbQuery('Cancelled');
  await ctx.editMessageText('❌ Order cancelled.');
  ctx.session.orderSession = null;
  ctx.session.orderProductId = null;
  ctx.session._addressBookShown = false;
  return ctx.scene.leave();
});

// ── Admin notification ─────────────────────────────────────────────────────────
async function notifyAdmin(ctx, order, sess) {
  const user = ctx.from;
  const userTag = user.username ? `@${user.username}` : `ID: ${user.id}`;
  const orderId = order._id.toString();
  const shortId = orderId.slice(-8).toUpperCase();

  const promoLine      = sess.promoCode    ? `\n🎟 Promo: \`${sess.promoCode}\` (−${price(sess.promoDiscount)})` : '';
  const tierLine       = sess.tierDiscount > 0 ? `\n🏷 Tier Discount (${sess.tierDiscountPct}%): −${price(sess.tierDiscount)}` : '';
  const flashSaleLine  = sess.isFlashSale  ? `\n🔥 Flash Sale applied` : '';
  const gameIdLine     = sess.gameId ? `\n🎮 Game ID: \`${sess.gameId}\`${sess.zoneId ? ` / Zone: \`${sess.zoneId}\`` : ''}` : '';
  const typeIcon       = sess.productType === 'DigitalCode' ? '🎁 Digital Code' : '🎮 Direct Top-up';

  const text =
    `🔔 *New Order — Action Required*\n\n` +
    `🆔 Order: \`${shortId}\`\n` +
    `👤 Customer: ${userTag} *(${user.first_name})*\n` +
    `📦 Product: *${sess.productName}*\n` +
    `🗂 Type: ${typeIcon}` +
    gameIdLine +
    `\n💰 Original: ${price(sess.originalPrice)}` +
    flashSaleLine +
    tierLine +
    promoLine +
    `\n✨ *Charged: ${price(sess.finalAmount)}*` +
    `\n🕐 Time: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Rangoon' })} MMT`;

  try {
    await ctx.telegram.sendMessage(config.bot.adminId, text, {
      parse_mode: 'Markdown',
      ...adminOrderKeyboard(orderId),
    });
  } catch (err) {
    console.error('[OrderScene] Admin notify failed:', err.message);
  }
}

module.exports = orderScene;
