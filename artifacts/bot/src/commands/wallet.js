const { Markup } = require('telegraf');
const Nav = require('../services/NavigationService');
const { buildMessage, price, formatDate } = require('../utils/ui');
const { getHistory, getCoinBonusRates } = require('../services/WalletService');
const { getTierConfig } = require('../services/MembershipService');
const User = require('../models/User');

Nav.register({
  id: 'wallet_view',
  title: '💰 Wallet',
  build: async (ctx, theme) => {
    // Fallback to direct DB lookup if middleware didn't attach user
    const user = ctx.user || (ctx.from?.id ? await User.findByTelegramId(ctx.from.id) : null);
    if (!user) {
      return {
        text: '❌ Could not load wallet. Please tap retry below.',
        keyboard: Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Retry', 'nav:go:wallet_view')],
          Nav.backButton('🔙 Main Menu'),
        ]),
      };
    }

    const balanceKS   = user.balanceKS   || 0;
    const balanceCoin = user.balanceCoin  || 0;
    const tier        = user.membershipTier || 'Silver';
    const deposited   = user.totalDeposited || 0;
    const bonusRates  = await getCoinBonusRates();
    const bonusPct    = Math.round((bonusRates[tier] || 0.01) * 100 * 10) / 10;
    const tierCfg     = await getTierConfig();

    const nextTierMap  = { Silver: 'Gold', Gold: 'Platinum', Platinum: null };
    const nextTier     = nextTierMap[tier];
    const nextMin      = nextTier ? tierCfg[nextTier]?.min : null;
    const progressLine = nextTier && nextMin
      ? `📊 To ${nextTier}: ${price(Math.max(0, nextMin - deposited))} more`
      : `🏆 Maximum tier reached!`;

    const text = buildMessage(theme, [
      {
        title: '💰 My Wallet',
        lines: [
          `${theme.emoji.money} KS Balance: ${theme.format.bold(price(balanceKS))}`,
          `${theme.emoji.coin} Mental Coins: ${theme.format.bold(balanceCoin.toLocaleString() + ' MC')}`,
          ``,
          `${theme.emoji.star} Tier: ${theme.format.bold(tier)}`,
          `🎁 Coin Bonus Rate: ${theme.format.bold(`+${bonusPct}%`)} on top-ups`,
          `💼 Total Deposited: ${price(deposited)}`,
          progressLine,
        ],
      },
    ]);

    return {
      text,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('💳 Top Up Wallet',       'start_topup')],
        [Markup.button.callback('📜 Transaction History', 'wallet_history')],
        [Markup.button.callback('🎁 Coin History',        'coin_history')],
        Nav.backButton('🔙 Main Menu'),
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

  bot.action('start_topup', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('topup_scene');
  });

  bot.action('wallet_history', async (ctx) => {
    await ctx.answerCbQuery();
    const user = await User.findByTelegramId(ctx.from.id);
    if (!user) return ctx.reply('❌ User not found. Please /start first.');

    const txs = await getHistory(user._id, { limit: 10, wallet: 'KS' });
    if (!txs.length) return ctx.reply('📜 No KS transactions yet. Use /topup to top up your wallet.');

    const typeIcon = {
      Topup: '💳', Purchase: '🛍️', Refund: '↩️',
      AdminCredit: '⬆️', AdminDebit: '⬇️', Debit: '📤',
    };
    const lines = txs.map((t) => {
      const icon = typeIcon[t.type] || '•';
      const sign = t.amount > 0 ? '+' : '';
      const dot  = { Completed: '🟢', Pending: '🟡', Rejected: '🔴' }[t.status] || '⚪';
      return `${icon} ${sign}${t.amount.toLocaleString()} KS  ${dot}  _${formatDate(t.timestamp)}_`;
    });

    await ctx.reply(
      `📜 *KS Transaction History*\n\n${lines.join('\n')}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back to Wallet', 'nav:go:wallet_view')]]),
      }
    );
  });

  bot.action('coin_history', async (ctx) => {
    await ctx.answerCbQuery();
    const user = await User.findByTelegramId(ctx.from.id);
    if (!user) return ctx.reply('❌ User not found. Please /start first.');

    const txs = await getHistory(user._id, { limit: 10, wallet: 'Coin' });
    if (!txs.length) return ctx.reply('🪙 No coin transactions yet.');

    const lines = txs.map((t) => {
      const sign = t.amount > 0 ? '+' : '';
      return `🎁 ${sign}${t.amount.toLocaleString()} MC  _${formatDate(t.timestamp)}_`;
    });

    await ctx.reply(
      `🪙 *Mental Coin History*\n\n${lines.join('\n')}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back to Wallet', 'nav:go:wallet_view')]]),
      }
    );
  });
};
