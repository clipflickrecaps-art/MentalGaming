/**
 * Shop command — registers all navigation folders and wires /shop entry.
 */

const { Markup } = require('telegraf');
const Nav = require('../services/NavigationService');
const Product = require('../models/Product');
const CacheService = require('../services/CacheService');
const { loadingMessage, resolveMessage } = require('../utils/animations');
const { buildMessage, price, truncate } = require('../utils/ui');
const { t } = require('../utils/i18n');

function backRow() {
  return Nav.backButton();
}

Nav.register({
  id: 'main',
  title: 'Main Menu',
  build: async (ctx, theme) => {
    const name = ctx.from?.first_name || 'there';
    const balanceKS   = ctx.user?.balanceKS   || 0;
    const balanceCoin = ctx.user?.balanceCoin  || 0;
    const tier        = ctx.user?.membershipTier || 'Silver';

    const text = buildMessage(theme, [
      {
        title: t(ctx, 'main_title'),
        lines: [
          `${theme.emoji.user} ${t(ctx, 'welcome')}, ${theme.format.bold(name)}!`,
          `${theme.emoji.money} ${t(ctx, 'balance')}: ${theme.format.code(price(balanceKS))}`,
          `${theme.emoji.coin} ${t(ctx, 'coins')}: ${theme.format.code(balanceCoin.toLocaleString() + ' MC')}`,
          `${theme.emoji.star} ${t(ctx, 'tier')}: ${tier}`,
        ],
      },
      { title: null, lines: [t(ctx, 'choose')] },
    ]);

    // Fullfix11: main menu must be reply keyboard only.
    const keyboard = Markup.keyboard([
      ['🛒 Shop', '📦 My Orders'],
      ['💰 Wallet', '👤 My Profile'],
      ['🗓 Check In', '🎰 Spin Wheel'],
      ['📢 Channels', '💬 Support'],
      ['📚 FAQ', '⚙️ Settings'],
    ]).resize();

    return { text, keyboard };
  },
});

Nav.register({
  id: 'shop',
  title: '🛒 Shop',
  build: async (ctx, theme) => {
    const text = buildMessage(theme, [
      {
        title: '🛒 Game Store',
        lines: [
          `${theme.emoji.bullet} Browse by game or category.`,
          `${theme.emoji.bullet} All prices shown in KS.`,
        ],
      },
    ]);

    // Dynamic category root: reads categories from MongoDB so admin-added products appear immediately.
    const categories = await Product.distinct('category', { isActive: true });
    const buttons = categories.sort().map((cat) => Nav.itemButton(cat, `shop_cat:${encodeURIComponent(cat)}`, '📁'));
    const rows = buttons.length ? Nav.buildRows(buttons, 2) : [
      [Nav.folderButton('Mobile Legends', 'ml'), Nav.folderButton('Free Fire', 'ff')],
      [Nav.folderButton('Gift Cards', 'giftcard'), Nav.folderButton('PUBG Mobile', 'pubg')],
      [Nav.folderButton('Genshin Impact', 'genshin'), Nav.folderButton('Valorant', 'valorant')],
    ];
    const keyboard = Markup.inlineKeyboard([...rows, backRow()]);

    return { text, keyboard };
  },
});

function buildGameFolder(id, title, subfolders, description = '') {
  Nav.register({
    id,
    title,
    build: async (ctx, theme) => {
      const lines = description
        ? [description, '', `${theme.emoji.bullet} Select a package:`]
        : [`${theme.emoji.bullet} Select a package:`];
      const text = buildMessage(theme, [{ title, lines }]);
      const rows = Nav.buildRows(subfolders.map((f) => Nav.folderButton(f.label, f.id)), 2);
      return { text, keyboard: Markup.inlineKeyboard([...rows, backRow()]) };
    },
  });
}

buildGameFolder('ml', '📱 Mobile Legends', [
  { id: 'ml_diamonds',  label: 'Diamonds'    },
  { id: 'ml_weekly',    label: 'Weekly Pass' },
  { id: 'ml_starlight', label: 'Starlight'   },
], '🎮 Top up ML Diamonds, Weekly Pass & Starlight directly to your in-game account. Fastest delivery in Myanmar!');

buildGameFolder('ff', '🔥 Free Fire', [
  { id: 'ff_diamonds',   label: 'Diamonds'   },
  { id: 'ff_membership', label: 'Membership' },
], '💥 Boost your Free Fire gameplay with Diamonds and Elite/Gold Memberships. Instant top-up, best rates!');

buildGameFolder('pubg', '🎯 PUBG Mobile', [
  { id: 'pubg_uc',        label: 'UC'          },
  { id: 'pubg_royalpass', label: 'Royal Pass'  },
], '🎯 Top up PUBG UC and Royal Pass Season upgrades at unbeatable prices. Delivered to your game ID instantly!');

buildGameFolder('genshin', '✨ Genshin Impact', [
  { id: 'genshin_genesis', label: 'Genesis Crystals' },
  { id: 'genshin_bp',      label: 'Battle Pass'      },
], '✨ Power up your Genshin Impact journey with Genesis Crystals and Welkin Moon Battle Pass. Worldwide server support!');

buildGameFolder('valorant', '🔫 Valorant', [
  { id: 'valorant_vp',      label: 'VP Points'      },
  { id: 'valorant_premium', label: 'Premium Bundle' },
], '🔫 Grab Valorant Points and Premium Battle Pass upgrades for all regions. Competitive prices, instant delivery!');

buildGameFolder('giftcard', '🎁 Gift Cards', [
  { id: 'gc_google', label: 'Google Play' },
  { id: 'gc_apple',  label: 'App Store'   },
  { id: 'gc_steam',  label: 'Steam'       },
  { id: 'gc_razer',  label: 'Razer Gold'  },
], '🎁 Digital gift cards for all major platforms. Available in multiple denominations, no account required!');

function buildProductFolder(id, title, category, parent) {
  Nav.register({
    id,
    title,
    build: async (ctx, theme) => {
      const products = await CacheService.getCachedProducts(category);

      if (!products.length) {
        return {
          text: buildMessage(theme, [{ title, lines: [`${theme.emoji.warning} No products available.`] }]),
          keyboard: Markup.inlineKeyboard([backRow()]),
        };
      }

      const rows = products.map((p) => [
        Markup.button.callback(
          `${theme.emoji.item} ${truncate(p.name, 28)} — ${price(p.finalPrice)}`,
          `product:${p._id}`
        ),
      ]);

      const text = buildMessage(theme, [{
        title,
        lines: [
          `${theme.emoji.bullet} ${products.length} package(s) available`,
          `${theme.emoji.bullet} Tap to order`,
        ],
      }]);

      return { text, keyboard: Markup.inlineKeyboard([...rows, backRow()]) };
    },
  });
}

buildProductFolder('ml_diamonds',    '💎 ML Diamonds',       'ML Diamonds',      'ml');
buildProductFolder('ml_weekly',      '🎫 ML Weekly Pass',    'ML Weekly Pass',   'ml');
buildProductFolder('ml_starlight',   '⭐ ML Starlight',      'ML Starlight',     'ml');
buildProductFolder('ff_diamonds',    '🔥 FF Diamonds',       'FF Diamonds',      'ff');
buildProductFolder('ff_membership',  '🃏 FF Membership',     'FF Membership',    'ff');
buildProductFolder('pubg_uc',        '🎯 PUBG UC',           'PUBG UC',          'pubg');
buildProductFolder('pubg_royalpass', '👑 PUBG Royal Pass',   'PUBG Royal Pass',  'pubg');
buildProductFolder('genshin_genesis','✨ Genesis Crystals',  'Genshin Genesis',  'genshin');
buildProductFolder('genshin_bp',     '📘 Genshin BP',        'Genshin BP',       'genshin');
buildProductFolder('valorant_vp',    '🔫 Valorant Points',   'Valorant Points',  'valorant');
buildProductFolder('valorant_premium','🌟 Premium Bundle',   'Valorant Premium', 'valorant');
buildProductFolder('gc_google',      '🟢 Google Play',       'Google Play',      'giftcard');
buildProductFolder('gc_apple',       '🍎 App Store',         'App Store',        'giftcard');
buildProductFolder('gc_steam',       '♨️ Steam',             'Steam',            'giftcard');
buildProductFolder('gc_razer',       '🐍 Razer Gold',        'Razer Gold',       'giftcard');

module.exports = function registerShop(bot) {
  bot.command('shop', async (ctx) => {
    Nav.clearHistory(ctx);
    await Nav.navigate(ctx, 'shop');
  });

  bot.hears('🛒 Shop', async (ctx) => {
    Nav.clearHistory(ctx);
    await Nav.navigate(ctx, 'shop');
  });

  bot.command('menu', async (ctx) => {
    Nav.clearHistory(ctx);
    await Nav.navigate(ctx, 'main');
  });


  bot.action(/^shop_cat:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const category = decodeURIComponent(ctx.match[1]);
    const products = await CacheService.getCachedProducts(category);
    const theme = require('../services/ThemeService').getTheme(ctx.user);

    if (!products.length) {
      return ctx.reply('❌ No active products in this category.', {
        ...Markup.inlineKeyboard([Nav.backButton()]),
      });
    }

    const rows = products.map((p) => [
      Markup.button.callback(`${theme.emoji.item} ${truncate(p.name, 28)} — ${price(p.finalPrice)}`, `product:${p._id}`),
    ]);

    await ctx.reply(buildMessage(theme, [{
      title: `📁 ${category}`,
      lines: [`${products.length} package(s) available`, 'Tap a product to order.'],
    }]), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([...rows, Nav.backButton()]),
    });
  });

  bot.action(/^product:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const productId = ctx.match[1];
    const ref = await loadingMessage(ctx, '⌛ Loading product\\.\\.\\.');

    try {
      const product = await Product.findById(productId);
      if (!product) return resolveMessage(ctx, ref, '❌ Product not found.');

      const theme = require('../services/ThemeService').getTheme(ctx.user);
      const stockLabel = product.stockCount === -1 ? '∞ Unlimited' : `${product.stockCount} left`;

      const text = buildMessage(theme, [{
        title: product.name,
        lines: [
          `${theme.emoji.folder} Category: ${product.category}`,
          `🌍 Region: ${product.region}`,
          `${theme.emoji.money} Price: ${theme.format.bold(price(product.finalPrice))}`,
          `📦 Stock: ${stockLabel}`,
          product.description ? `\n📝 ${product.description}` : null,
        ],
      }]);

      await resolveMessage(ctx, ref, text, {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🛒 Order Now', `order_start:${product._id}`)],
          Nav.backButton(),
        ]),
      });
    } catch (err) {
      await resolveMessage(ctx, ref, `❌ Error: ${err.message}`);
    }
  });


  // ── Main-menu shortcut actions ─────────────────────────────────────────────
  bot.action('quick_promo', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(`🎟 *Promo Code*\n\nSend your code like this:\n\`/promo YOUR_CODE\`\n\nPromo codes can also be applied during checkout.`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Main Menu', 'nav:go:main')]]),
    });
  });

  bot.action('quick_myids', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(`📖 *Saved Game IDs*\n\nUse \`/myids\` to view saved IDs, or \`/saveid GameName GameID ZoneID Nickname\` to save one.`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('➕ Save ID Help', 'ab_start_save'), Markup.button.callback('🔙 Main Menu', 'nav:go:main')]]),
    });
  });

  bot.action('quick_referral', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(`🔗 *Referral*\n\nUse \`/referral\` to view your invite link, rewards, and leaderboard.`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Main Menu', 'nav:go:main')]]),
    });
  });

};
