const Nav = require('../services/NavigationService');
const { buildMessage, price, formatDate } = require('../utils/ui');
const { COIN_BONUS_RATE } = require('../services/WalletService');
const { Markup } = require('telegraf');

function tierBadge(tier) {
  const map = { Silver: '🥈 Silver', Gold: '🥇 Gold', Platinum: '💎 Platinum' };
  return map[tier] || tier;
}

Nav.register({
  id: 'profile_view',
  title: '👤 My Profile',
  build: async (ctx, theme) => {
    const user = ctx.user;
    if (!user) return { text: '❌ Could not load profile.', keyboard: Markup.inlineKeyboard([Nav.backButton()]) };

    const balanceKS   = user.balanceKS   || 0;
    const balanceCoin = user.balanceCoin  || 0;
    const deposited   = user.totalDeposited || 0;
    const tier        = user.membershipTier || 'Silver';
    const bonusPct    = Math.round((COIN_BONUS_RATE[tier] || 0.01) * 100 * 10) / 10;

    const text = buildMessage(theme, [
      {
        title: '👤 My Profile',
        lines: [
          `${theme.emoji.user} ${user.username ? `@${user.username}` : 'No username'}`,
          `🆔 ID: ${theme.format.code(String(user.telegramId))}`,
          `${theme.emoji.star} Tier: ${theme.format.bold(tierBadge(tier))}`,
          ``,
          `${theme.emoji.money} KS Balance: ${theme.format.bold(price(balanceKS))}`,
          `${theme.emoji.coin} Mental Coins: ${theme.format.bold(balanceCoin.toLocaleString() + ' MC')}`,
          `💼 Total Deposited: ${price(deposited)}`,
          `🎁 Coin Bonus Rate: +${bonusPct}%`,
          ``,
          `${theme.emoji.warning} Warnings: ${user.warningsCount}/3`,
          `📅 Joined: ${formatDate(user.joinDate)}`,
        ],
      },
    ]);

    return {
      text,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('💳 Top Up', 'start_topup'), Markup.button.callback('📜 History', 'wallet_history')],
        [Markup.button.callback('⚙️ Settings', 'nav:go:settings_view')],
        [Nav.backButton('🔙 Main Menu')],
      ]),
    };
  },
});

module.exports = function registerProfile(bot) {
  bot.command('profile', async (ctx) => {
    await Nav.navigate(ctx, 'profile_view');
  });

  bot.hears('👤 My Profile', async (ctx) => {
    await Nav.navigate(ctx, 'profile_view');
  });
};
