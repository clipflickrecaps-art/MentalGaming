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
const { getTierList, invalidateTierCache } = require('../services/MembershipService');

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


async function buildTierManagerText() {
  const tiers = await getTierList();
  const lines = tiers.map((t, i) =>
    `${i + 1}. ${t.badge || '⭐'} *${t.name}* — min \`${Number(t.min || 0).toLocaleString()} KS\` — discount \`${t.discount || 0}%\` — bonus \`${Math.round((t.bonusRate || 0) * 100 * 10) / 10}%\``
  );
  return `🏆 *Tier Manager*\n\n${lines.join('\n')}\n\nFormat to add/edit:\n\`Name | minKS | discount% | bonus% | badge\`\nExample: \`Diamond | 5000000 | 8 | 3 | 💎\``;
}

async function saveCustomTierList(tiers) {
  tiers.sort((a, b) => Number(a.min || 0) - Number(b.min || 0));
  if (!tiers.length || Number(tiers[0].min || 0) !== 0) {
    tiers.unshift({ name: 'Silver', min: 0, discount: 0, bonusRate: 0.01, badge: '🥈', color: '⬜' });
  }
  await GameConfig.set({ customTiers: tiers });
  invalidateTierCache();
}

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
        [Markup.button.callback('🏆 Tier Manager',          'gc_tier_manager')],
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


  // ── New Tier Manager ─────────────────────────────────────────────────────
  bot.action('gc_tier_manager', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(await buildTierManagerText(), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('➕ Add Tier', 'gc_tier_add'), Markup.button.callback('✏️ Edit Tier', 'gc_tier_edit')],
        [Markup.button.callback('🗑 Delete Tier', 'gc_tier_delete'), Markup.button.callback('📋 Replace All', 'gc_tier_replace')],
        [Markup.button.callback('🔄 Recalculate Users', 'gc_tier_recalc_users')],
        [Markup.button.callback('🔙 Back', 'admin_coins_panel')],
      ]),
    });
  });

  bot.action('gc_tier_add', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.gcEdit = { type: 'tierAdd' };
    await ctx.reply('➕ Send new tier as:\n`Name | minKS | discount% | bonus% | badge`\nExample: `Diamond | 5000000 | 8 | 3 | 💎`', { parse_mode: 'Markdown' });
  });

  bot.action('gc_tier_edit', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.gcEdit = { type: 'tierEdit' };
    await ctx.reply('✏️ Send edited tier as:\n`ExistingName | newMinKS | newDiscount% | newBonus% | newBadge`\nExample: `Gold | 300000 | 3 | 2 | 🥇`', { parse_mode: 'Markdown' });
  });

  bot.action('gc_tier_delete', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.gcEdit = { type: 'tierDelete' };
    await ctx.reply('🗑 Send tier name to delete.\nExample: `Gold`\n\nNote: users in deleted tier will be recalculated by deposit amount.', { parse_mode: 'Markdown' });
  });

  bot.action('gc_tier_replace', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.gcEdit = { type: 'tierReplace' };
    await ctx.reply('📋 Send all tiers, one per line:\n`Silver | 0 | 0 | 1 | 🥈`\n`Gold | 500000 | 2 | 1.5 | 🥇`\n`Platinum | 2000000 | 5 | 2 | 💎`', { parse_mode: 'Markdown' });
  });

  bot.action('gc_tier_recalc_users', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery('Recalculating...');
    const { calcTierFromDeposited } = require('../services/MembershipService');
    const users = await User.find({}, 'totalDeposited membershipTier');
    let changed = 0;
    for (const u of users) {
      const nextTier = await calcTierFromDeposited(u.totalDeposited || 0);
      if (u.membershipTier !== nextTier) {
        u.membershipTier = nextTier;
        await u.save();
        changed++;
      }
    }
    await ctx.reply(`✅ Recalculated ${users.length} users. Changed: ${changed}`);
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
    const Product = require('../models/Product');
    const products = await Product.find({}, 'mainFolder category').lean();
    const seen = new Set();
    const buttons = [];
    for (const p of products) {
      const folder = p.mainFolder || 'General';
      const cat = p.category || 'Uncategorized';
      const key = `${folder}||${cat}`;
      if (seen.has(key)) continue;
      seen.add(key);
      buttons.push([Markup.button.callback(`📂 ${folder} / 📁 ${cat}`, `ap_cat2:${encodeURIComponent(folder)}:${encodeURIComponent(cat)}`)]);
      if (buttons.length >= 15) break;
    }
    buttons.push([Markup.button.callback('📁 Manage Categories', 'cat_manager')]);
    buttons.push([Markup.button.callback('❌ Cancel', 'ap_cancel')]);
    await ctx.reply(`🛍️ *Add New Product*\n\nStep 1/5: Select folder/category:`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons),
    });
  });

  bot.action(/^ap_cat2:(.+):(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.adminAddProduct = { step: 'code', mainFolder: decodeURIComponent(ctx.match[1]), category: decodeURIComponent(ctx.match[2]) };
    await ctx.reply(`✅ Selected: *${decodeURIComponent(ctx.match[1])} / ${decodeURIComponent(ctx.match[2])}*\n\nStep 2/5: Enter product code/SKU (e.g. \`ML86\`):`, { parse_mode: 'Markdown' });
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
      if (addState.step === 'code') {
        if (input.length < 1 || input.length > 50) return ctx.reply('❌ Code must be 1–50 characters.');
        ctx.session.adminAddProduct = { ...addState, step: 'name', productCode: input };
        return ctx.reply(`✅ Code: *${input}*\n\nStep 3/5: Enter product name (e.g. "86 Diamonds"):` , { parse_mode: 'Markdown' });
      }
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
            productCode: addState.productCode || null,
            mainFolder: addState.mainFolder || 'General',
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
            `✅ *Product Created!*\n\n🏷 Code: ${product.productCode || '-'}\n📦 *${product.name}*\n📂 ${product.mainFolder || 'General'} / 📁 ${product.category}\n💰 ${price(product.finalPrice)}` +
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


    const parseTierInput = (line) => {
      const [name, min, discount, bonus, badge] = line.split('|').map(x => x.trim());
      if (!name) throw new Error('Tier name is required.');
      const minVal = parseInt(String(min || '0').replace(/,/g, ''), 10);
      const discVal = parseFloat(discount || '0');
      const bonusVal = parseFloat(bonus || '0');
      if (isNaN(minVal) || minVal < 0) throw new Error('minKS must be 0 or higher.');
      if (isNaN(discVal) || discVal < 0 || discVal > 100) throw new Error('discount must be 0–100.');
      if (isNaN(bonusVal) || bonusVal < 0 || bonusVal > 100) throw new Error('bonus must be 0–100.');
      return { name, min: minVal, discount: discVal, bonusRate: bonusVal / 100, badge: badge || '⭐', color: '▫️' };
    };

    if (state.type === 'tierAdd') {
      try {
        const newTier = parseTierInput(input);
        const tiers = await getTierList();
        if (tiers.some(t => t.name.toLowerCase() === newTier.name.toLowerCase())) return ctx.reply('❌ Tier already exists. Use Edit Tier.');
        tiers.push(newTier);
        await saveCustomTierList(tiers);
        ctx.session.gcEdit = null;
        return ctx.reply(`✅ Tier added: ${newTier.badge} *${newTier.name}*`, { parse_mode: 'Markdown' });
      } catch (e) { return ctx.reply(`❌ ${e.message}`); }
    }

    if (state.type === 'tierEdit') {
      try {
        const edited = parseTierInput(input);
        const tiers = await getTierList();
        const idx = tiers.findIndex(t => t.name.toLowerCase() === edited.name.toLowerCase());
        if (idx < 0) return ctx.reply('❌ Tier not found. Use Add Tier first.');
        tiers[idx] = edited;
        await saveCustomTierList(tiers);
        ctx.session.gcEdit = null;
        return ctx.reply(`✅ Tier updated: ${edited.badge} *${edited.name}*`, { parse_mode: 'Markdown' });
      } catch (e) { return ctx.reply(`❌ ${e.message}`); }
    }

    if (state.type === 'tierDelete') {
      const name = input.trim();
      let tiers = await getTierList();
      if (tiers.length <= 1) return ctx.reply('❌ At least one tier is required.');
      const before = tiers.length;
      tiers = tiers.filter(t => t.name.toLowerCase() !== name.toLowerCase());
      if (tiers.length === before) return ctx.reply('❌ Tier not found.');
      await saveCustomTierList(tiers);
      ctx.session.gcEdit = null;
      return ctx.reply(`✅ Deleted tier: *${name}*. Tap “Recalculate Users” if needed.`, { parse_mode: 'Markdown' });
    }

    if (state.type === 'tierReplace') {
      try {
        const tiers = input.split('\n').filter(Boolean).map(parseTierInput);
        if (!tiers.length) return ctx.reply('❌ Send at least one tier.');
        await saveCustomTierList(tiers);
        ctx.session.gcEdit = null;
        return ctx.reply(`✅ Replaced tier list with ${tiers.length} tiers.`, { parse_mode: 'Markdown' });
      } catch (e) { return ctx.reply(`❌ ${e.message}`); }
    }

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
