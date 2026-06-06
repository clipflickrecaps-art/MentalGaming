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
const OrderTrackingService = require('../services/OrderTrackingService');
const Order = require('../models/Order');
const { applyTierDiscount } = require('../services/MembershipService');
const { getEntries, formatEntry } = require('../services/AddressBookService');
const { validatePromo, applyPromo } = require('../services/PromoService');
const { checklist } = require('../utils/animations');
const { buildMessage, price, formatDate } = require('../utils/ui');
const { auditLog } = require('../services/logger');
const { flashLabel, formatCountdown } = require('../services/FlashSaleService');
const Product = require('../models/Product');
const Catalog = require('../models/Catalog');
const User = require('../models/User');

// ── Helper: build quantity selector keyboard ───────────────────────────────────
// maxQty: 0/null = unlimited, N = cap
// Shows 1–N inline buttons when N ≤ 10, otherwise 1–5 shortcuts + ✏️ Custom button
function buildQtyButtons(unitPrice, balanceKS, maxQty) {
  const useInlineOnly = maxQty >= 1 && maxQty <= 10;
  const shortcutCount = useInlineOnly ? maxQty : 5;
  const buttons = [];
  const row = [];
  for (let i = 1; i <= shortcutCount; i++) {
    const total = unitPrice * i;
    const canAfford = balanceKS >= total;
    row.push(Markup.button.callback(`${i}× ${canAfford ? '' : '🔴'}`, `order_qty:${i}`));
    if (row.length === 5) { buttons.push([...row]); row.length = 0; }
  }
  if (row.length) buttons.push([...row]);
  if (!useInlineOnly) {
    // Show custom input button for unlimited or maxQty > 10
    const label = maxQty > 10 ? `✏️ Custom (max ${maxQty})` : '✏️ Custom Qty';
    buttons.push([Markup.button.callback(label, 'order_custom_qty')]);
  }
  buttons.push([Markup.button.callback('❌ Cancel', 'order_cancel_scene')]);
  return buttons;
}

// ── Games that require Zone ID (legacy — kept for products with no catalog) ───
const ZONE_REQUIRED = ['mobile legends', 'ml', 'moonton'];

function needsZone(gameName = '') {
  return ZONE_REQUIRED.some((g) => gameName.toLowerCase().includes(g));
}

// ── Resolve the checkout fields for a product ─────────────────────────────────
// Returns array of field defs from: product override > catalog > legacy fallback
async function resolveCheckoutFields(product) {
  // Product has explicit override (empty array means "no fields")
  if (Array.isArray(product.checkoutFieldsOverride) && product.checkoutFieldsOverride !== null) {
    return product.checkoutFieldsOverride
      .slice()
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }
  // Pull from catalog
  if (product.catalogId) {
    const catalog = await Catalog.findById(product.catalogId).lean();
    if (catalog?.checkoutFields?.length) {
      return catalog.checkoutFields
        .slice()
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    }
  }
  // Legacy fallback: DirectTopup products always need a Game ID
  if (product.productType === 'DirectTopup') {
    return [
      { key: 'game_id', label: 'Game ID', fieldType: 'text', required: true, placeholder: 'Enter your Player ID' },
      ...(needsZone(product.category || product.name)
        ? [{ key: 'zone_id', label: 'Zone ID', fieldType: 'number', required: true, placeholder: 'Zone / Server ID' }]
        : []),
    ];
  }
  return [];
}

// ── Admin notification keyboard ───────────────────────────────────────────────
function adminOrderKeyboard(orderId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Complete Order',      `admin_complete:${orderId}`)],
    [Markup.button.callback('❌ Cancel & Refund',     `admin_cancel_refund:${orderId}`)],
    [
      Markup.button.callback('💬 Message User',       `admin_msg_user:${orderId}`),
      Markup.button.callback('⚠️ Warn User',          `admin_warn_user:${orderId}`),
    ],
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

    // Resolve checkout fields once at session start
    const checkoutFields = await resolveCheckoutFields(product);

    // How many can be ordered per transaction
    // null/0 = unlimited, 1 = no selector, N = cap at N
    const maxQty = (product.maxQuantity === null || product.maxQuantity === undefined) ? 0 : product.maxQuantity;
    const allowMultiple = maxQty !== 1;
    // Show inline buttons if maxQty ≤ 10; otherwise show preset shortcuts + Custom input
    const useButtons = maxQty > 1 && maxQty <= 10;
    const buttonCount = useButtons ? maxQty : 5; // 1–5 as shortcuts when unlimited/large

    ctx.session.orderSession = {
      productId: product._id.toString(),
      productName: product.name,
      productType: product.productType,
      originalPrice: product.finalPrice,
      flashSalePrice: isFlashSale ? effectivePrice : null,
      isFlashSale,
      tierDiscount,
      tierDiscountPct,
      unitPrice: priceAfterTier,        // price per 1 unit (after flash + tier)
      effectivePrice: priceAfterTier,   // total price (unit × qty), before promo
      orderQuantity: 1,
      maxQuantity: maxQty,
      gameName: product.category,
      gameId: null,
      zoneId: null,
      checkoutFields,
      checkoutData: {},
      checkoutFieldIndex: 0,
      promoCode: null,
      promoDiscount: 0,
      finalAmount: priceAfterTier,
    };

    const tierBadgeMap = { Silver: '🥈', Gold: '🥇', Platinum: '💎' };
    const flashLine = isFlashSale
      ? [`🔥 *FLASH SALE* — ⏳ Ends in: *${formatCountdown(msLeft)}*`]
      : [];
    const tierLine = tierDiscount > 0
      ? [`${tierBadgeMap[tier]} ${tier} Discount (${tierDiscountPct}%): *−${price(tierDiscount)}*`]
      : [];

    const productInfoText = buildMessage(theme, [{
      title: '🛒 Select Quantity',
      lines: [
        `${theme.emoji.item} *${product.name}*`,
        `🗂 Type: ${product.productType === 'DigitalCode' ? '🎁 Digital Code' : '🎮 Direct Top-up'}`,
        `🌍 Region: ${product.region}`,
        ...flashLine,
        isFlashSale
          ? `${theme.emoji.money} Unit Price: ~~${price(product.finalPrice)}~~ → *${price(effectivePrice)}*`
          : `${theme.emoji.money} Unit Price: ${theme.format.bold(price(product.finalPrice))}`,
        ...tierLine,
        tierDiscount > 0 ? `✨ Your Unit Price: ${theme.format.bold(price(priceAfterTier))}` : null,
        `📦 Stock: ${stockLabel}`,
        maxQty > 1 ? `⚠️ _Max ${maxQty} per order_` : null,
        ``,
        `💰 Your Balance: ${theme.format.bold(price(user.balanceKS))}`,
        ``,
        allowMultiple ? `How many do you want to order?` : null,
      ].filter(Boolean),
    }]);

    // Single quantity — skip selector, show order summary directly
    if (!allowMultiple) {
      const hasBalance = user.balanceKS >= priceAfterTier;
      if (!hasBalance) {
        await ctx.reply(productInfoText, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('💳 Top Up Wallet', 'start_topup')],
            [Markup.button.callback('❌ Cancel', 'order_cancel_scene')],
          ]),
        });
        return ctx.scene.leave();
      }
      await ctx.reply(productInfoText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('▶️ Order Now', 'order_proceed')],
          [Markup.button.callback('❌ Cancel', 'order_cancel_scene')],
        ]),
      });
      return ctx.wizard.next();
    }

    // Multi-quantity — show selector buttons + optional Custom input
    const qtyButtons = buildQtyButtons(priceAfterTier, user.balanceKS, maxQty);

    await ctx.reply(productInfoText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(qtyButtons),
    });

    return ctx.wizard.next();
  },

  // ── Step 1: Checkout field collection (dynamic) or auto-skip ─────────────
  async (ctx) => {
    const sess = ctx.session.orderSession;
    if (!sess) { await ctx.reply('❌ Session expired.'); return ctx.scene.leave(); }

    const fields = sess.checkoutFields || [];

    // No fields needed (DigitalCode with no catalog fields, or catalog with 0 fields)
    if (!fields.length) {
      ctx.wizard.selectStep(2);
      return ctx.wizard.steps[2](ctx);
    }

    // If arriving here via text input: store value for current field
    if (ctx.session._collectingFieldIndex != null && ctx.message?.text) {
      const idx = ctx.session._collectingFieldIndex;
      const field = fields[idx];
      if (field) {
        const val = ctx.message.text.trim();
        if (!val && field.required) {
          return ctx.reply(`⚠️ *${field.label}* is required. Please enter a value:`);
        }
        if (!sess.checkoutData) sess.checkoutData = {};
        sess.checkoutData[field.key] = val;

        // Backfill legacy gameId/zoneId for admin notify
        if (field.key === 'game_id') sess.gameId = val;
        if (field.key === 'zone_id') sess.zoneId = val;

        const nextIdx = idx + 1;
        if (nextIdx < fields.length) {
          ctx.session._collectingFieldIndex = nextIdx;
          return askForField(ctx, fields[nextIdx]);
        }

        // All fields collected — proceed to promo step
        ctx.session._collectingFieldIndex = null;
        ctx.wizard.selectStep(2);
        return ctx.wizard.steps[2](ctx);
      }
    }

    // First field: check address book if it's the first field and is a game_id type
    const firstField = fields[0];
    if (!ctx.session._collectingFieldIndex && firstField.key === 'game_id') {
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
        ctx.session._collectingFieldIndex = 0;
        return ctx.wizard.next();
      }
    }

    // Start collecting from field 0
    ctx.session._collectingFieldIndex = 0;
    await askForField(ctx, firstField);
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

    // Show collected checkout fields
    const checkoutLines = sess.checkoutFields?.length
      ? Object.entries(sess.checkoutData || {})
          .map(([k, v]) => {
            const fdef = (sess.checkoutFields || []).find((f) => f.key === k);
            return `📋 ${fdef?.label || k}: ${theme.format.code(String(v))}`;
          })
      : (sess.gameId
          ? [`🎮 Game ID: ${theme.format.code(sess.gameId)}${sess.zoneId ? ` / Zone: ${sess.zoneId}` : ''}`]
          : []);
    const gameIdLine = checkoutLines;
    const tierBadgeMap = { Silver: '🥈', Gold: '🥇', Platinum: '💎' };
    const userTier = user?.membershipTier || 'Silver';
    const tierLine = sess.tierDiscount > 0
      ? [`${tierBadgeMap[userTier]} ${userTier} Discount (${sess.tierDiscountPct}%): −${price(sess.tierDiscount)}`]
      : [];
    const flashLine = sess.isFlashSale
      ? [`🔥 Flash Sale Price: ${price(sess.flashSalePrice || sess.originalPrice)}`]
      : [];
    const hasAnyDiscount = sess.tierDiscount > 0 || sess.promoDiscount > 0 || sess.isFlashSale;

    const qty = sess.orderQuantity || 1;
    const qtyLabel = qty > 1 ? ` × ${qty}` : '';
    const text = buildMessage(theme, [{
      title: '✅ Confirm Order',
      lines: [
        `📦 *${sess.productName}*${qtyLabel}`,
        ...gameIdLine,
        ``,
        qty > 1 ? `💰 Unit Price: ${price(sess.unitPrice || sess.originalPrice)}` : null,
        qty > 1 ? `🔢 Quantity: ${qty}` : null,
        `💰 Original${qty > 1 ? ' Total' : ''}: ${price(sess.originalPrice * qty)}`,
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

async function askForField(ctx, field) {
  const optLabel = field.required ? '' : ' _(optional — send `-` to skip)_';
  const placeholder = field.placeholder ? `\n_e.g. ${field.placeholder}_` : '';
  await ctx.reply(
    `📝 *${field.label}*${optLabel}${placeholder}\n\nPlease enter your ${field.label}:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel', 'order_cancel_scene')],
      ]),
    }
  );
}

// ── Action: Quantity selected ───────────────────────────────────────────────────
orderScene.action(/^order_qty:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const qty = parseInt(ctx.match[1], 10);
  const sess = ctx.session.orderSession;
  if (!sess) { await ctx.reply('❌ Session expired.'); return ctx.scene.leave(); }

  const user = await User.findByTelegramId(ctx.from.id);
  const theme = getTheme(ctx.user);

  // Validate qty against maxQuantity
  if (sess.maxQuantity > 0 && qty > sess.maxQuantity) {
    return ctx.answerCbQuery(`❌ Max ${sess.maxQuantity} per order`, { show_alert: true });
  }

  const totalPrice = sess.unitPrice * qty;
  sess.orderQuantity = qty;
  sess.effectivePrice = totalPrice;
  sess.finalAmount = totalPrice;

  const hasBalance = user.balanceKS >= totalPrice;
  const tierBadgeMap = { Silver: '🥈', Gold: '🥇', Platinum: '💎' };
  const userTier = user?.membershipTier || 'Silver';
  const tierLine = sess.tierDiscount > 0
    ? [`${tierBadgeMap[userTier]} ${userTier} Discount (per unit): −${price(sess.tierDiscount)}`]
    : [];

  const summaryText = buildMessage(theme, [{
    title: '🛒 Order Summary',
    lines: [
      `${theme.emoji.item} *${sess.productName}* × ${qty}`,
      ...tierLine,
      `${theme.emoji.money} Unit Price: ${price(sess.unitPrice)}`,
      qty > 1 ? `✨ Total: *${price(totalPrice)}*` : null,
      ``,
      hasBalance
        ? `💰 Your Balance: ${theme.format.bold(price(user.balanceKS))} ✅`
        : `💰 Your Balance: ${theme.format.bold(price(user.balanceKS))} ❌ _(Need ${price(totalPrice - user.balanceKS)} more)_`,
    ].filter(Boolean),
  }]);

  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

  if (!hasBalance) {
    await ctx.reply(summaryText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('💳 Top Up Wallet', 'start_topup')],
        [Markup.button.callback('🔙 Change Quantity', 'order_change_qty')],
        [Markup.button.callback('❌ Cancel', 'order_cancel_scene')],
      ]),
    });
    return;
  }

  await ctx.reply(summaryText, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback(`▶️ Order ${qty}× Now`, 'order_proceed')],
      [Markup.button.callback('🔙 Change Quantity', 'order_change_qty')],
      [Markup.button.callback('❌ Cancel', 'order_cancel_scene')],
    ]),
  });
});

// ── Action: Custom quantity — prompt user to type a number ─────────────────────
orderScene.action('order_custom_qty', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  const sess = ctx.session.orderSession;
  if (!sess) { await ctx.reply('❌ Session expired.'); return ctx.scene.leave(); }
  sess.awaitingCustomQty = true;
  const maxNote = sess.maxQuantity > 0 ? ` (max ${sess.maxQuantity})` : '';
  await ctx.reply(
    `🔢 *Enter Quantity*${maxNote}\n\n📦 *${sess.productName}*\n💰 Unit Price: ${price(sess.unitPrice)}\n\n_Type the number of units you want to order:_`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'order_cancel_scene')]]) }
  );
});

// ── Action: Change quantity (re-show selector) ──────────────────────────────────
orderScene.action('order_change_qty', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  const sess = ctx.session.orderSession;
  if (!sess) { await ctx.reply('❌ Session expired.'); return ctx.scene.leave(); }
  const user = await User.findByTelegramId(ctx.from.id);
  const qtyButtons = buildQtyButtons(sess.unitPrice, user.balanceKS, sess.maxQuantity || 0);
  await ctx.reply(
    `🔢 *Select Quantity*\n\n📦 *${sess.productName}*\n💰 Unit Price: ${price(sess.unitPrice)}\n💳 Your Balance: ${price(user.balanceKS)}\n\n🔴 = insufficient balance`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(qtyButtons) }
  );
});

// ── Scene-level text handler: custom qty input ─────────────────────────────────
orderScene.on('text', async (ctx, next) => {
  const sess = ctx.session.orderSession;
  if (!sess || !sess.awaitingCustomQty) return next();

  sess.awaitingCustomQty = false;
  const val = parseInt(ctx.message.text.trim(), 10);
  if (isNaN(val) || val < 1) {
    return ctx.reply('❌ Please enter a valid number ≥ 1.');
  }
  if (sess.maxQuantity > 0 && val > sess.maxQuantity) {
    return ctx.reply(`❌ Max allowed is ${sess.maxQuantity} per order.`);
  }

  const user = await User.findByTelegramId(ctx.from.id);
  const theme = getTheme(ctx.user);
  const totalPrice = sess.unitPrice * val;
  sess.orderQuantity = val;
  sess.effectivePrice = totalPrice;
  sess.finalAmount = totalPrice;

  const hasBalance = user.balanceKS >= totalPrice;
  const summaryText = buildMessage(theme, [{
    title: '🛒 Order Summary',
    lines: [
      `📦 *${sess.productName}* × ${val}`,
      `${theme.emoji.money} Unit Price: ${price(sess.unitPrice)}`,
      val > 1 ? `✨ Total: *${price(totalPrice)}*` : null,
      ``,
      hasBalance
        ? `💰 Your Balance: ${theme.format.bold(price(user.balanceKS))} ✅`
        : `💰 Your Balance: ${theme.format.bold(price(user.balanceKS))} ❌ _(Need ${price(totalPrice - user.balanceKS)} more)_`,
    ].filter(Boolean),
  }]);

  if (!hasBalance) {
    return ctx.reply(summaryText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('💳 Top Up Wallet', 'start_topup')],
        [Markup.button.callback('🔙 Change Quantity', 'order_change_qty')],
        [Markup.button.callback('❌ Cancel', 'order_cancel_scene')],
      ]),
    });
  }

  return ctx.reply(summaryText, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback(`▶️ Order ${val}× Now`, 'order_proceed')],
      [Markup.button.callback('🔙 Change Quantity', 'order_change_qty')],
      [Markup.button.callback('❌ Cancel', 'order_cancel_scene')],
    ]),
  });
});

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
      `📦 ${sess.productName}${(sess.orderQuantity || 1) > 1 ? ` × ${sess.orderQuantity}` : ''}\n` +
      `💰 ${price(sess.finalAmount)} deducted\n\n` +
      `_Your order is Pending. You'll be notified once it's complete._`
    );

    // Build checkoutData array from collected hash
    const checkoutDataArr = Object.entries(sess.checkoutData || {}).map(([key, value]) => {
      const fdef = (sess.checkoutFields || []).find((f) => f.key === key);
      return { key, label: fdef?.label || key, value: String(value) };
    });

    const { order } = await createOrder(ctx.from.id, sess.productId, {
      gameId: sess.gameId,
      zoneId: sess.zoneId,
      gameName: sess.gameName,
      promoCode: sess.promoCode,
      promoDiscount: sess.promoDiscount,
      tierDiscount: sess.tierDiscount || 0,
      tierDiscountPct: sess.tierDiscountPct || 0,
      finalAmount: sess.finalAmount,
      checkoutData: checkoutDataArr,
    });

    if (sess.promoCode) {
      await applyPromo(sess.promoCode, ctx.from.id).catch(() => {});
    }

    await auditLog(ctx.from.id, 'ORDER_PLACED', order._id.toString(), 'Order', {
      product: sess.productName,
      amount: sess.finalAmount,
      type: sess.productType,
    });

    // ── Send live tracking card (replies to checklist message) ────────────────
    try {
      const trackMsg = await OrderTrackingService.sendOrderPlaced(
        ctx.telegram,
        ctx.from.id,
        order,
        sess,
        ref.messageId  // chain as reply to the checklist confirmation
      );
      if (trackMsg?.message_id) {
        await Order.findByIdAndUpdate(order._id, {
          trackingMsgId: trackMsg.message_id,
          $push: { statusHistory: { status: 'Pending', at: new Date(), note: 'Order placed' } },
        });
      }
    } catch (e) {
      console.error('[OrderTracking] sendOrderPlaced failed:', e.message);
    }

    await notifyAdmin(ctx, order, sess);

    ctx.session.orderSession = null;
    ctx.session.orderProductId = null;
    ctx.session._addressBookShown = false;
    ctx.session._collectingFieldIndex = null;
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
  ctx.session._collectingFieldIndex = null;
  return ctx.scene.leave();
});

// ── Admin notification ─────────────────────────────────────────────────────────
async function notifyAdmin(ctx, order, sess) {
  const user = ctx.from;
  const userTag = user.username ? `@${user.username}` : `ID: ${user.id}`;
  const orderId = order._id.toString();
  const shortId = orderId.slice(-8).toUpperCase();

  const promoLine     = sess.promoCode    ? `\n🎟 Promo: \`${sess.promoCode}\` (−${price(sess.promoDiscount)})` : '';
  const tierLine      = sess.tierDiscount > 0 ? `\n🏷 Tier Discount (${sess.tierDiscountPct}%): −${price(sess.tierDiscount)}` : '';
  const flashSaleLine = sess.isFlashSale  ? `\n🔥 Flash Sale applied` : '';
  const typeIcon      = sess.productType === 'DigitalCode' ? '🎁 Digital Code' : '🎮 Direct Top-up';

  // Build delivery info lines from dynamic checkoutData or legacy gameId
  const checkoutDataEntries = Object.entries(sess.checkoutData || {});
  const deliveryLines = checkoutDataEntries.length
    ? checkoutDataEntries.map(([k, v]) => {
        const fdef = (sess.checkoutFields || []).find((f) => f.key === k);
        return `\n📋 ${fdef?.label || k}: \`${v}\``;
      }).join('')
    : (sess.gameId ? `\n🎮 Game ID: \`${sess.gameId}\`${sess.zoneId ? ` / Zone: \`${sess.zoneId}\`` : ''}` : '');

  const text =
    `🔔 *New Order — Action Required*\n\n` +
    `🆔 Order: \`${shortId}\`\n` +
    `👤 Customer: ${userTag} *(${user.first_name})*\n` +
    `📦 Product: *${sess.productName}*${(sess.orderQuantity || 1) > 1 ? ` × ${sess.orderQuantity}` : ''}\n` +
    `🗂 Type: ${typeIcon}` +
    deliveryLines +
    `\n💰 Original: ${price(sess.originalPrice * (sess.orderQuantity || 1))}` +
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
