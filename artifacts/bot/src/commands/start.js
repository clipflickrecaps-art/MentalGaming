const { mainMenuKeyboard } = require('../utils/keyboard');

module.exports = function registerStart(bot) {
  bot.start(async (ctx) => {
    const name = ctx.from.first_name || ctx.from.username || 'there';
    const tier = ctx.user?.membershipTier || 'Silver';

    await ctx.reply(
      `👋 Welcome to *Mental Gaming Store*, ${name}!\n\n` +
        `🎮 Your go-to store for game credits, top-ups, and gift cards.\n` +
        `💳 Membership Tier: *${tier}*\n\n` +
        `Use the menu below to get started:`,
      {
        parse_mode: 'Markdown',
        ...mainMenuKeyboard(),
      }
    );
  });
};
