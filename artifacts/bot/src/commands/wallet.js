const { Markup } = require('telegraf');
const Nav = require('../services/NavigationService');
const { buildMessage, price } = require('../utils/ui');

Nav.register({
  id: 'wallet_view',
  title: '💰 Wallet',
  build: async (ctx, theme) => {
    const user = ctx.user;
    const balance = user?.walletBalance || 0;
    const coins = user?.mentalCoins || 0;
    const tier = user?.membershipTier || 'Silver';

    const tierBonus = { Silver: 0, Gold: 5, Platinum: 10 }[tier] || 0;

    const text = buildMessage(theme, [
      {
        title: '💰 My Wallet',
        lines: [
          `${theme.emoji.money} Balance: ${theme.format.bold(price(balance))}`,
          `${theme.emoji.coin} Mental Coins: ${theme.format.bold(coins.toLocaleString())}`,
          ``,
          `${theme.emoji.star} Membership: ${theme.format.bold(tier)}`,
          `🎁 Coin Bonus on orders: ${theme.format.bold(`+${tierBonus}%`)}`,
          ``,
          `_To top up your wallet, contact support or use /support._`,
        ],
      },
    ]);

    return {
      text,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('📜 Transaction History', 'wallet_history')],
        [Markup.button.callback('💬 Request Top-Up',     'support_topup')],
        [Nav.backButton('🔙 Main Menu')],
      ]),
    };
  },
});

module.exports = function registerWallet(bot) {
  bot.command('wallet', async (ctx) => {
    await Nav.navigate(ctx, 'wallet_view');
  });

  bot.hears('💰 Wallet', async (ctx) => {
    await Nav.navigate(ctx, 'wallet_view');
  });

  bot.action('wallet_history', async (ctx) => {
    await ctx.answerCbQuery();
    const { getUserOrders } = require('../controllers/orderController');
    const orders = await getUserOrders(ctx.from.id, 'Success');

    if (!orders.length) {
      return ctx.reply('📜 No completed transactions yet.');
    }

    const { getTheme } = require('../services/ThemeService');
    const theme = getTheme(ctx.user);
    const lines = orders.slice(0, 8).map((o, i) => {
      const product = o.productId?.name || 'Unknown';
      const date = new Date(o.timestamp).toLocaleDateString('en-GB', { timeZone: 'Asia/Rangoon' });
      return `${i + 1}. *${product}* — \`${price(o.amount)}\` — ${date}`;
    });

    await ctx.reply(
      `📜 *Transaction History* (last ${lines.length})\n\n${lines.join('\n')}`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.action('support_topup', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      `💬 *Wallet Top-Up Request*\n\n` +
      `To top up your wallet, please contact our admin:\n` +
      `📩 Use /support to open a ticket.\n\n` +
      `_Payment methods: KPay, Wave, AYA Pay_`,
      { parse_mode: 'Markdown' }
    );
  });
};
