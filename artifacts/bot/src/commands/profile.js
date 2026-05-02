const Nav = require('../services/NavigationService');
const { buildMessage, tierBadge, price, formatDate } = require('../utils/ui');
const { Markup } = require('telegraf');

Nav.register({
  id: 'profile_view',
  title: '👤 My Profile',
  build: async (ctx, theme) => {
    const user = ctx.user;
    if (!user) return { text: '❌ Could not load profile.', keyboard: Markup.inlineKeyboard([Nav.backButton()]) };

    const text = buildMessage(theme, [
      {
        title: '👤 My Profile',
        lines: [
          `${theme.emoji.user} Username: ${theme.format.bold(user.username ? `@${user.username}` : 'Not set')}`,
          `🆔 Telegram ID: ${theme.format.code(String(user.telegramId))}`,
          `${theme.emoji.star} Tier: ${theme.format.bold(tierBadge(user.membershipTier))}`,
          `${theme.emoji.money} Wallet: ${theme.format.bold(price(user.walletBalance))}`,
          `${theme.emoji.coin} Mental Coins: ${theme.format.bold(user.mentalCoins.toLocaleString())}`,
          `${theme.emoji.warning} Warnings: ${user.warningsCount}/3`,
          `📅 Joined: ${formatDate(user.joinDate)}`,
        ],
      },
    ]);

    return {
      text,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('⚙️ Theme Settings', 'nav:go:settings_view')],
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
