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
const User = require('../models/User');

// ── Games that require Zone ID ────────────────────────────────────────────────
const ZONE_REQUIRED = ['mobile legends', 'ml', 'moonton'];

function needsZone(gameName = '') {
  return ZONE_REQUIRED.some((g) => gameName.toLowerCase().includes(g));
}

function normalizeKey(label = '') {
  const l = String(label).toLowerCase();
  if (l.includes('server') || l.includes('zone')) return l.includes('server') ? 'serverId' : 'zoneId';
  if (l.includes('player') && l.includes('name')) return 'playerName';
  if (l.includes('uid')) return 'uid';
  if (l.includes('email')) return 'email';
  if (l.includes('phone')) return 'phone';
  if (l.includes('id')) return 'gameId';
  return String(label || 'info').trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'info';
}

function defaultRequiredFields(product) {
  if (product.productType !== 'DirectTopup') return [];
  const name = `${product.name} ${product.category} ${product.mainFolder}`.toLowerCase();
  if (name.includes('mobile legends') || name.includes('mlbb') || name.includes('ml diamonds') || name.includes('ml ')) {
    return [
      { key: 'gameId', label: 'Game ID', required: true, hint: 'Example: 123456789' },
      { key: 'serverId', label: 'Server ID', required: true, hint: 'Example: 1234' },
    ];
  }
  if (name.includes('pubg') || name.includes('hok') || name.includes('honor of kings') || name.includes('free fire') || name.includes('ff ')) {
    return [{ key: 'gameId', label: 'Game ID / Player ID', required: true, hint: 'Enter your in-game ID' }];
  }
  return [{ key: 'gameId', label: 'Game ID / Player ID', required: true, hint: 'Enter your in-game ID' }];
}

function getProductRequiredFields(product) {
  const fields = Array.isArray(product.requiredFields) && product.requiredFields.length
    ? product.requiredFields
    : defaultRequiredFields(product);
  return fields.map((f) => ({
    key: f.key || normalizeKey(f.label),
    label: f.label || f.key || 'Info',
    required: f.required !== false,
    hint: f.hint || '',
  }));
}

function formatRequiredFields(fields) {
  return fields.map((f, i) => `${i + 1}. ${f.label}${f.required ? ' *' : ''}${f.hint ? ` — ${f.hint}` : ''}`).join('\n');
}

function parseRequiredInput(input, fields) {
  const raw = String(input || '').trim();
  const parts = raw.includes('|')
    ? raw.split('|').map((x) => x.trim())
    : raw.split('\n').map((x) => x.trim()).filter(Boolean);
  if (parts.length === 1 && fields.length > 1) {
    // Backward compatible for MLBB style: "gameId serverId".
    const ws = parts[0].split(/\s+/).filter(Boolean);
    if (ws.length >= fields.length) return fields.map((f, i) => ({ key: f.key, label: f.label, value: ws[i] || '' }));
  }
  return fields.map((f, i) => ({ key: f.key, label: f.label, value: parts[i] || '' }));
}

function validateRequiredInfo(info, fields) {
  const missing = fields.filter((f, i) => f.required !== false && !String(info[i]?.value || '').trim());
  return missing.map((f) => f.label);
}

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

function requiredInfoLines(info = [], gameId = null, zoneId = null) {
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
  for (const item of (Array.isArray(info) ? info : [])) add(item?.label, item?.value, item?.key);
  add('Game ID', gameId, 'gameId');
  add('Server ID', zoneId, 'zoneId');
  return lines;
}

// ── Admin notification keyboard (reply keyboard only) ───────────────────────
function adminOrderKeyboard() {
  return Markup.keyboard([
    ['📦 Manage Orders', '🔄 Refresh Orders'],
    ['📊 Dashboard', '🏠 Admin Menu'],
  ]).resize();
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
    const tierResult = await applyTierDiscount(effectivePrice, tier);
    const tierDiscount    = tierResult.discount;
    const tierDiscountPct = tierResult.pct;
    const priceAfterTier  = tierResult.finalPrice;

    ctx.session.orderSession = {
      productId: product._id.toString(),
      productName: product.name,
      productCode: product.productCode,
      mainFolder: product.mainFolder,
      productType: product.productType,
      originalPrice: product.finalPrice,
      flashSalePrice: isFlashSale ? effectivePrice : null,
      isFlashSale,
      tierDiscount,
      tierDiscountPct,
      effectivePrice: priceAfterTier,   // price after flash + tier, before promo
      gameName: product.category,
      requiredFields: getProductRequiredFields(product),
      requiredInfo: [],
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

    const fields = Array.isArray(sess.requiredFields) && sess.requiredFields.length
      ? sess.requiredFields
      : [{ key: 'gameId', label: 'Game ID / Player ID', required: true, hint: 'Enter your in-game ID' }];

    if (ctx.session._requiredInfoPrompted) {
      if (!ctx.message?.text) return ctx.reply('Please send the required info.');
      const info = parseRequiredInput(ctx.message.text, fields);
      const missing = validateRequiredInfo(info, fields);
      if (missing.length) {
        return ctx.reply(`❌ Missing required info: ${missing.join(', ')}\n\nSend again in this format:\n${fields.map(f => f.label).join(' | ')}`);
      }

      sess.requiredInfo = info;
      const byKey = Object.fromEntries(info.map((x) => [String(x.key).toLowerCase(), x.value]));
      sess.gameId = byKey.gameid || byKey.playerid || byKey.uid || info.find(x => /id/i.test(x.key) || /id/i.test(x.label))?.value || null;
      sess.zoneId = byKey.serverid || byKey.zoneid || info.find(x => /server|zone/i.test(x.key) || /server|zone/i.test(x.label))?.value || null;
      ctx.session._requiredInfoPrompted = false;
      return ctx.wizard.selectStep(2), ctx.wizard.steps[2](ctx);
    }

    await ctx.reply(
      `🎮 *Delivery Info Required*\n\nThis product is manual delivery. Please send customer info for admin delivery.\n\n${formatRequiredFields(fields)}\n\nFormat:\n\`${fields.map(f => f.label).join(' | ')}\``,
      { parse_mode: 'Markdown' }
    );
    ctx.session._requiredInfoPrompted = true;
    return ctx.wizard.next();
  },

  // ── Step 2: Promo code input ──────────────────────────────────────────────
  async (ctx) => {
    const sess = ctx.session.orderSession;
    if (!sess) { await ctx.reply('❌ Session expired.'); return ctx.scene.leave(); }

    // If arriving via text (promo code input)
    if (ctx.message?.text && !ctx.message.text.startsWith('/')) {
      const code = ctx.message.text.trim();
      const result = await validatePromo(code, ctx.from.id, sess.effectivePrice, { productId: sess.productId, productCode: sess.productCode, category: sess.gameName, mainFolder: sess.mainFolder });

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
    const infoLines = requiredInfoLines(sess.requiredInfo, sess.gameId, sess.zoneId);
    const gameIdLine = infoLines.length
      ? infoLines
      : (sess.gameId ? [`🎮 Game ID: ${theme.format.code(sess.gameId)}${sess.zoneId ? ` / Zone: ${sess.zoneId}` : ''}`] : []);
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
      requiredInfo: sess.requiredInfo || [],
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
    ctx.session._requiredInfoPrompted = false;
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
    ctx.session._requiredInfoPrompted = false;
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
  const infoLine       = requiredInfoLines(sess.requiredInfo || [], sess.gameId, sess.zoneId).length
    ? '\n' + requiredInfoLines(sess.requiredInfo || [], sess.gameId, sess.zoneId).join('\n')
    : '';
  const typeLabel      = sess.productType || 'DirectTopup';

  const text =
    `🟡 *Pending Order*\n\n` +
    `🆔 Order: \`${shortId}\`\n` +
    `👤 Customer: ${userTag}\n` +
    `📦 Product: ${sess.productName}\n` +
    `🎮 Type: ${typeLabel}` +
    infoLine +
    `\n💰 Original: ${price(sess.originalPrice)}` +
    flashSaleLine +
    tierLine +
    promoLine +
    `\n✨ Charged: *${price(sess.finalAmount)}*` +
    `\n📊 Status: Pending` +
    `\n🕐 Placed: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Rangoon', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}`;

  try {
    await ctx.telegram.sendMessage(config.bot.adminId, text, {
      parse_mode: 'Markdown',
      ...adminOrderKeyboard(),
    });
  } catch (err) {
    console.error('[OrderScene] Admin notify failed:', err.message);
  }
}

module.exports = orderScene;
