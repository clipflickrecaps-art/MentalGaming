/**
 * adminGameConfig.js — Admin panel for game economics management
 *
 * Sections:
 *   💰 Coin Bonus Rates  — view/edit per-tier coin bonus rates
 *   📊 Tier Config       — view/edit tier thresholds and discounts
 *   🎰 Spin Rewards      — view/edit spin wheel prize weights & cost
 *   💳 Adjust Balance    — manually credit/debit KS or Coins for any user
 */

const { Markup } = require('telegraf');
const { adminOnly } = require('../middlewares/adminCheck');
const GameConfig = require('../models/GameConfig');
const User = require('../models/User');
const { creditKS, debitKS, creditCoin, debitCoin, _invalidateRateCache } = require('../services/WalletService');
const { auditLog } = require('../services/logger');
const { price } = require('../utils/ui');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function buildConfigText(cfg) {
  return (
    `⚙️ *Coins & Tiers Config*\n\n` +
    `*🪙 Coin Bonus Rates (% of KS → Mental Coins on top-up):*\n` +
    `  🥈 Silver:   \`${(cfg.coinBonusRateSilver * 100).toFixed(1)}%\`\n` +
    `  🥇 Gold:     \`${(cfg.coinBonusRateGold * 100).toFixed(1)}%\`\n` +
    `  💎 Platinum: \`${(cfg.coinBonusRatePlatinum * 100).toFixed(1)}%\`\n\n` +
    `*📊 Tier Thresholds (total KS deposited):*\n` +
    `  🥇 Gold:     \`${cfg.tierGoldMin.toLocaleString()} KS\`\n` +
    `  💎 Platinum: \`${cfg.tierPlatinumMin.toLocaleString()} KS\`\n\n` +
    `*🏷 Tier Discounts (% off final price):*\n` +
    `  🥈 Silver:   \`${cfg.tierSilverDiscount}%\`\n` +
    `  🥇 Gold:     \`${cfg.tierGoldDiscount}%\`\n` +
    `  💎 Platinum: \`${cfg.tierPlatinumDiscount}%\``
  );
}

function buildSpinText(cfg) {
  const prizes = [
    { label: '🎉 Thank You (no reward)', w: cfg.spinWeightThanks },
    { label: '🪙 50 Coins',             w: cfg.spinWeightCoins50 },
    { label: '🪙 200 Coins',            w: cfg.spinWeightCoins200 },
    { label: '🪙 500 Coins',            w: cfg.spinWeightCoins500 },
    { label: '💰 1,000 KS',             w: cfg.spinWeightKS1000 },
    { label: '💰 5,000 KS',             w: cfg.spinWeightKS5000 },
    { label: '🎰 Free Spin',            w: cfg.spinWeightFreeSpin },
  ];
  const total = prizes.reduce((s, p) => s + p.w, 0) || 1;
  const lines = prizes.map((p) => `  ${p.label}: weight \`${p.w}\` _(${((p.w / total) * 100).toFixed(1)}%)_`);
  return (
    `🎰 *Spin Wheel Config*\n\n` +
    `💳 Paid spin cost: \`${cfg.spinCostCoins} Mental Coins\`\n\n` +
    `*Prize Pool:*\n${lines.join('\n')}`
  );
}

const SPIN_WEIGHT_FIELDS = {
  thanks:    'spinWeightThanks',
  coins_50:  'spinWeightCoins50',
  coins_200: 'spinWeightCoins200',
  coins_500: 'spinWeightCoins500',
  ks_1000:   'spinWeightKS1000',
  ks_5000:   'spinWeightKS5000',
  free_spin: 'spinWeightFreeSpin',
};

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = function registerAdminGameConfig(bot) {

  // ── Coins & Tiers panel ────────────────────────────────────────────────────
  bot.action('admin_coins_panel', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const cfg = await GameConfig.get();
    const text = await buildConfigText(cfg);
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🪙 Edit Coin Rates',        'gc_edit_coin_menu')],
        [Markup.button.callback('📊 Edit Tier Thresholds',   'gc_edit_tier_menu')],
        [Markup.button.callback('🏷 Edit Tier Discounts',    'gc_edit_discount_menu')],
        [Markup.button.callback('💳 Adjust User Balance',    'gc_adjust_menu')],
        [Markup.button.callback('🔙 Back to Admin Panel',    'nav:go:admin_main')],
      ]),
    });
  });

  // ── Spin panel ─────────────────────────────────────────────────────────────
  bot.action('admin_spin_panel', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const cfg = await GameConfig.get();
    await ctx.reply(buildSpinText(cfg), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Edit Prize Weights', 'gc_edit_spin_weights')],
        [Markup.button.callback('💳 Edit Spin Cost',     'gc_edit_spin_cost')],
        [Markup.button.callback('🔙 Back to Admin Panel', 'nav:go:admin_main')],
      ]),
    });
  });

  // ── Coin rate edit ─────────────────────────────────────────────────────────
  bot.action('gc_edit_coin_menu', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const cfg = await GameConfig.get();
    await ctx.reply(
      `🪙 *Edit Coin Bonus Rates*\n\nCurrent rates:\n` +
      `🥈 Silver: ${(cfg.coinBonusRateSilver * 100).toFixed(1)}%\n` +
      `🥇 Gold: ${(cfg.coinBonusRateGold * 100).toFixed(1)}%\n` +
      `💎 Platinum: ${(cfg.coinBonusRatePlatinum * 100).toFixed(1)}%\n\nSelect tier:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🥈 Silver', 'gc_set_coin:Silver'), Markup.button.callback('🥇 Gold', 'gc_set_coin:Gold')],
          [Markup.button.callback('💎 Platinum', 'gc_set_coin:Platinum')],
          [Markup.button.callback('🔙 Back', 'admin_coins_panel')],
        ]),
      }
    );
  });

  bot.action(/^gc_set_coin:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.gcEdit = { type: 'coinRate', tier: ctx.match[1] };
    await ctx.reply(
      `🪙 Set *${ctx.match[1]}* coin bonus rate\n\nEnter as percentage (e.g. \`1.5\` for 1.5%):`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Tier threshold edit ────────────────────────────────────────────────────
  bot.action('gc_edit_tier_menu', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const cfg = await GameConfig.get();
    await ctx.reply(
      `📊 *Edit Tier Thresholds*\n\nCurrent thresholds:\n` +
      `🥇 Gold: ${cfg.tierGoldMin.toLocaleString()} KS\n` +
      `💎 Platinum: ${cfg.tierPlatinumMin.toLocaleString()} KS\n\nSelect tier:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🥇 Gold', 'gc_set_tier:Gold'), Markup.button.callback('💎 Platinum', 'gc_set_tier:Platinum')],
          [Markup.button.callback('🔙 Back', 'admin_coins_panel')],
        ]),
      }
    );
  });

  bot.action(/^gc_set_tier:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.gcEdit = { type: 'tierMin', tier: ctx.match[1] };
    await ctx.reply(
      `📊 Set *${ctx.match[1]}* threshold\n\nEnter minimum total KS deposited (e.g. \`500000\`):`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Tier discount edit ─────────────────────────────────────────────────────
  bot.action('gc_edit_discount_menu', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const cfg = await GameConfig.get();
    await ctx.reply(
      `🏷 *Edit Tier Discounts*\n\nCurrent discounts:\n` +
      `🥈 Silver: ${cfg.tierSilverDiscount}%\n` +
      `🥇 Gold: ${cfg.tierGoldDiscount}%\n` +
      `💎 Platinum: ${cfg.tierPlatinumDiscount}%\n\nSelect tier:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🥈 Silver', 'gc_set_disc:Silver'), Markup.button.callback('🥇 Gold', 'gc_set_disc:Gold')],
          [Markup.button.callback('💎 Platinum', 'gc_set_disc:Platinum')],
          [Markup.button.callback('🔙 Back', 'admin_coins_panel')],
        ]),
      }
    );
  });

  bot.action(/^gc_set_disc:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.gcEdit = { type: 'discount', tier: ctx.match[1] };
    await ctx.reply(
      `🏷 Set *${ctx.match[1]}* discount\n\nEnter percentage (e.g. \`2\` for 2%):`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Spin config edit ───────────────────────────────────────────────────────
  bot.action('gc_edit_spin_cost', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const cfg = await GameConfig.get();
    ctx.session.gcEdit = { type: 'spinCost' };
    await ctx.reply(
      `💳 *Edit Spin Cost*\n\nCurrent: *${cfg.spinCostCoins} Mental Coins*\n\nEnter new cost in coins:`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.action('gc_edit_spin_weights', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(`🎰 *Edit Prize Weights*\n\nSelect prize to edit:`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🎉 Thank You',  'gc_spin_w:thanks'),    Markup.button.callback('🪙 50 Coins',  'gc_spin_w:coins_50')],
        [Markup.button.callback('🪙 200 Coins',  'gc_spin_w:coins_200'), Markup.button.callback('🪙 500 Coins', 'gc_spin_w:coins_500')],
        [Markup.button.callback('💰 1,000 KS',   'gc_spin_w:ks_1000'),   Markup.button.callback('💰 5,000 KS', 'gc_spin_w:ks_5000')],
        [Markup.button.callback('🎰 Free Spin',  'gc_spin_w:free_spin')],
        [Markup.button.callback('🔙 Back',       'admin_spin_panel')],
      ]),
    });
  });

  bot.action(/^gc_spin_w:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.gcEdit = { type: 'spinWeight', prizeId: ctx.match[1] };
    await ctx.reply(
      `🎰 Set weight for *${ctx.match[1]}*\n\nEnter new weight (integer). Higher = more likely.\nCurrent total should be ~100 for easy probability reading.`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── User balance adjustment ────────────────────────────────────────────────
  bot.action('gc_adjust_menu', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.gcEdit = { type: 'adjustUserId' };
    await ctx.reply(`💳 *Adjust User Balance*\n\nEnter the Telegram ID of the user:`, { parse_mode: 'Markdown' });
  });

  bot.action(/^gc_adj:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const op = ctx.match[1];
    if (op === 'cancel') {
      ctx.session.gcEdit = null;
      return ctx.reply('❌ Cancelled.');
    }
    const state = ctx.session?.gcEdit;
    if (!state) return ctx.reply('❌ Session expired. Start again.');
    const labels = { addks: 'Add KS', subks: 'Remove KS', addcoin: 'Add Coins', subcoin: 'Remove Coins' };
    const unit = op.includes('coin') ? 'Mental Coins' : 'KS';
    ctx.session.gcEdit = { type: 'adjustAmount', userId: state.userId, userName: state.userName, op };
    await ctx.reply(`Enter amount to *${labels[op] || op}* (in ${unit}):`, { parse_mode: 'Markdown' });
  });

  // ── Product management wizard (add) ───────────────────────────────────────
  bot.action('admin_product_add', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.adminAddProduct = { step: 'category' };
    const rows = [
      ['ML Diamonds',      'ML Weekly Pass',  'ML Starlight'],
      ['FF Diamonds',      'FF Membership'],
      ['PUBG UC',          'PUBG Royal Pass'],
      ['Genshin Genesis',  'Genshin BP'],
      ['Valorant Points',  'Valorant Premium'],
      ['Google Play',      'App Store'],
      ['Steam',            'Razer Gold'],
    ].map((group) => group.map((cat) => Markup.button.callback(cat, `ap_cat:${cat}`)));
    await ctx.reply(`🛍️ *Add New Product*\n\nStep 1/4: Select category:`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([...rows, [Markup.button.callback('❌ Cancel', 'ap_cancel')]]),
    });
  });

  bot.action(/^ap_cat:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.adminAddProduct = { step: 'name', category: ctx.match[1] };
    await ctx.reply(`✅ Category: *${ctx.match[1]}*\n\nStep 2/4: Enter product name (e.g. "86 Diamonds"):`, { parse_mode: 'Markdown' });
  });

  bot.action('ap_cancel', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery('Cancelled');
    ctx.session.adminAddProduct = null;
    await ctx.reply('❌ Product creation cancelled.');
  });

  bot.action(/^ap_toggle:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const Product = require('../models/Product');
    const p = await Product.findById(ctx.match[1]);
    if (!p) return ctx.reply('❌ Product not found.');
    p.isActive = !p.isActive;
    await p.save();
    await auditLog(ctx.from.id, p.isActive ? 'PRODUCT_ACTIVATED' : 'PRODUCT_DEACTIVATED', ctx.match[1], 'Product', {});
    await ctx.reply(`${p.isActive ? '✅' : '🔴'} *${p.name}* is now *${p.isActive ? 'Active' : 'Inactive'}*.`, { parse_mode: 'Markdown' });
  });

  bot.action(/^ap_delete_ask:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const Product = require('../models/Product');
    const p = await Product.findById(ctx.match[1]);
    if (!p) return ctx.reply('❌ Product not found.');
    ctx.session.confirmDeleteProduct = ctx.match[1];
    await ctx.reply(
      `⚠️ Delete *${p.name}*?\n\nThis cannot be undone.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Yes, Delete', 'ap_delete_confirm'), Markup.button.callback('❌ Cancel', 'ap_delete_cancel')],
        ]),
      }
    );
  });

  bot.action('ap_delete_confirm', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const Product = require('../models/Product');
    const productId = ctx.session.confirmDeleteProduct;
    ctx.session.confirmDeleteProduct = null;
    if (!productId) return ctx.reply('❌ No product selected.');
    const p = await Product.findByIdAndDelete(productId);
    if (!p) return ctx.reply('❌ Product not found.');
    await auditLog(ctx.from.id, 'PRODUCT_DELETED', productId, 'Product', { name: p.name });
    await ctx.reply(`🗑 *${p.name}* deleted.`, { parse_mode: 'Markdown' });
  });

  bot.action('ap_delete_cancel', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery('Cancelled');
    ctx.session.confirmDeleteProduct = null;
    await ctx.reply('❌ Delete cancelled.');
  });

  // ── Universal text interceptor for all gcEdit / adminAddProduct flows ──────
  bot.on('text', async (ctx, next) => {
    const { config } = require('../../config/settings');
    if (Number(ctx.from?.id) !== Number(config.bot.adminId)) return next();

    // ── Product wizard ──────────────────────────────────────────────────────
    const addState = ctx.session?.adminAddProduct;
    if (addState) {
      const input = ctx.message.text.trim();
      if (addState.step === 'name') {
        if (input.length < 2 || input.length > 80) return ctx.reply('❌ Name must be 2–80 characters.');
        ctx.session.adminAddProduct = { ...addState, step: 'price', name: input };
        return ctx.reply(`✅ Name: *${input}*\n\nStep 3/4: Enter price in KS (e.g. \`5000\`):`, { parse_mode: 'Markdown' });
      }
      if (addState.step === 'price') {
        const p = parseInt(input.replace(/,/g, ''), 10);
        if (isNaN(p) || p <= 0) return ctx.reply('❌ Enter a positive number.');
        ctx.session.adminAddProduct = { ...addState, step: 'description', price: p };
        return ctx.reply(`✅ Price: *${price(p)}*\n\nStep 4/4: Enter description (or type \`skip\`):`, { parse_mode: 'Markdown' });
      }
      if (addState.step === 'description') {
        const desc = input.toLowerCase() === 'skip' ? '' : input;
        ctx.session.adminAddProduct = null;
        const Product = require('../models/Product');
        try {
          const product = await Product.create({
            name: addState.name,
            category: addState.category,
            region: 'Global',
            baseCurrency: 'MMK',
            baseCost: addState.price,
            finalPrice: addState.price,
            description: desc,
            isActive: true,
          });
          await auditLog(ctx.from.id, 'PRODUCT_CREATED', product._id.toString(), 'Product', { name: product.name, price: addState.price });
          const CacheService = require('../services/CacheService');
          if (typeof CacheService.invalidate === 'function') CacheService.invalidate(addState.category);
          return ctx.reply(
            `✅ *Product Created!*\n\n📦 *${product.name}*\n📁 ${product.category}\n💰 ${price(product.finalPrice)}` +
            (desc ? `\n📝 ${desc}` : '') +
            `\n\n_It now appears in the shop under ${product.category}._`,
            { parse_mode: 'Markdown' }
          );
        } catch (err) {
          ctx.session.adminAddProduct = null;
          return ctx.reply(`❌ Failed: ${err.message}`);
        }
      }
    }

    // ── GameConfig edit flows ───────────────────────────────────────────────
    const state = ctx.session?.gcEdit;
    if (!state) return next();

    const input = ctx.message.text.trim();

    if (state.type === 'coinRate') {
      const pct = parseFloat(input);
      if (isNaN(pct) || pct < 0 || pct > 100) return ctx.reply('❌ Enter 0–100 (e.g. 1.5 for 1.5%).');
      const field = { Silver: 'coinBonusRateSilver', Gold: 'coinBonusRateGold', Platinum: 'coinBonusRatePlatinum' }[state.tier];
      await GameConfig.set({ [field]: pct / 100 });
      if (_invalidateRateCache) _invalidateRateCache();
      ctx.session.gcEdit = null;
      await auditLog(ctx.from.id, 'UPDATE_COIN_RATE', null, 'GameConfig', { tier: state.tier, pct });
      return ctx.reply(`✅ *${state.tier}* coin bonus rate → *${pct}%*`, { parse_mode: 'Markdown' });
    }

    if (state.type === 'tierMin') {
      const val = parseInt(input.replace(/,/g, ''), 10);
      if (isNaN(val) || val <= 0) return ctx.reply('❌ Enter a positive integer.');
      const field = { Gold: 'tierGoldMin', Platinum: 'tierPlatinumMin' }[state.tier];
      await GameConfig.set({ [field]: val });
      ctx.session.gcEdit = null;
      await auditLog(ctx.from.id, 'UPDATE_TIER_THRESHOLD', null, 'GameConfig', { tier: state.tier, min: val });
      return ctx.reply(`✅ *${state.tier}* threshold → *${val.toLocaleString()} KS*`, { parse_mode: 'Markdown' });
    }

    if (state.type === 'discount') {
      const pct = parseFloat(input);
      if (isNaN(pct) || pct < 0 || pct > 100) return ctx.reply('❌ Enter 0–100.');
      const field = { Silver: 'tierSilverDiscount', Gold: 'tierGoldDiscount', Platinum: 'tierPlatinumDiscount' }[state.tier];
      await GameConfig.set({ [field]: pct });
      ctx.session.gcEdit = null;
      await auditLog(ctx.from.id, 'UPDATE_TIER_DISCOUNT', null, 'GameConfig', { tier: state.tier, pct });
      return ctx.reply(`✅ *${state.tier}* discount → *${pct}%*`, { parse_mode: 'Markdown' });
    }

    if (state.type === 'spinCost') {
      const val = parseInt(input, 10);
      if (isNaN(val) || val < 0) return ctx.reply('❌ Enter a non-negative integer.');
      await GameConfig.set({ spinCostCoins: val });
      ctx.session.gcEdit = null;
      await auditLog(ctx.from.id, 'UPDATE_SPIN_COST', null, 'GameConfig', { cost: val });
      return ctx.reply(`✅ Spin cost → *${val} Mental Coins*`, { parse_mode: 'Markdown' });
    }

    if (state.type === 'spinWeight') {
      const val = parseInt(input, 10);
      if (isNaN(val) || val < 0) return ctx.reply('❌ Enter a non-negative integer.');
      const field = SPIN_WEIGHT_FIELDS[state.prizeId];
      if (!field) return ctx.reply('❌ Unknown prize ID.');
      await GameConfig.set({ [field]: val });
      ctx.session.gcEdit = null;
      await auditLog(ctx.from.id, 'UPDATE_SPIN_WEIGHT', null, 'GameConfig', { prize: state.prizeId, weight: val });
      return ctx.reply(`✅ Weight for *${state.prizeId}* → *${val}*`, { parse_mode: 'Markdown' });
    }

    if (state.type === 'adjustUserId') {
      const id = parseInt(input, 10);
      if (isNaN(id)) return ctx.reply('❌ Enter a valid Telegram ID (numbers only).');
      const user = await User.findByTelegramId(id);
      if (!user) return ctx.reply(`❌ User \`${id}\` not found.`, { parse_mode: 'Markdown' });
      ctx.session.gcEdit = { type: 'adjustType', userId: id, userName: user.username || user.first_name || String(id) };
      return ctx.reply(
        `👤 *${ctx.session.gcEdit.userName}* (\`${id}\`)\n💰 KS: ${price(user.balanceKS)} | 🪙 Coins: ${user.balanceCoin.toLocaleString()} MC\n\nChoose action:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('➕ Add KS',     'gc_adj:addks'),   Markup.button.callback('➖ Remove KS',     'gc_adj:subks')],
            [Markup.button.callback('➕ Add Coins',  'gc_adj:addcoin'), Markup.button.callback('➖ Remove Coins',  'gc_adj:subcoin')],
            [Markup.button.callback('❌ Cancel',     'gc_adj:cancel')],
          ]),
        }
      );
    }

    if (state.type === 'adjustAmount') {
      const amount = parseInt(input.replace(/,/g, ''), 10);
      if (isNaN(amount) || amount <= 0) return ctx.reply('❌ Enter a positive integer.');
      const user = await User.findByTelegramId(state.userId);
      if (!user) return ctx.reply('❌ User not found.');
      ctx.session.gcEdit = null;
      try {
        if (state.op === 'addks') {
          await creditKS(user._id, amount, { type: 'AdminCredit', note: 'Admin manual credit' });
          await auditLog(ctx.from.id, 'ADMIN_CREDIT_KS', user._id.toString(), 'User', { amount });
          return ctx.reply(`✅ +*${amount.toLocaleString()} KS* credited to *${state.userName}*`, { parse_mode: 'Markdown' });
        } else if (state.op === 'subks') {
          await debitKS(user._id, amount, { type: 'AdminDebit', note: 'Admin manual debit' });
          await auditLog(ctx.from.id, 'ADMIN_DEBIT_KS', user._id.toString(), 'User', { amount });
          return ctx.reply(`✅ -*${amount.toLocaleString()} KS* debited from *${state.userName}*`, { parse_mode: 'Markdown' });
        } else if (state.op === 'addcoin') {
          await creditCoin(user._id, amount, { type: 'Bonus', note: 'Admin manual coin credit' });
          await auditLog(ctx.from.id, 'ADMIN_CREDIT_COIN', user._id.toString(), 'User', { amount });
          return ctx.reply(`✅ +*${amount.toLocaleString()} MC* credited to *${state.userName}*`, { parse_mode: 'Markdown' });
        } else if (state.op === 'subcoin') {
          await debitCoin(user._id, amount, { type: 'Debit', note: 'Admin manual coin debit' });
          await auditLog(ctx.from.id, 'ADMIN_DEBIT_COIN', user._id.toString(), 'User', { amount });
          return ctx.reply(`✅ -*${amount.toLocaleString()} MC* debited from *${state.userName}*`, { parse_mode: 'Markdown' });
        }
      } catch (err) {
        return ctx.reply(`❌ ${err.message}`);
      }
    }

    return next();
  });
};
