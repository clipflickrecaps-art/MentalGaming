const { buildThemeKeyboard, getTheme } = require('../services/ThemeService');
const { buildMessage } = require('../utils/ui');
const { Markup } = require('telegraf');
const Nav = require('../services/NavigationService');

Nav.register({
  id: 'settings_view',
  title: '⚙️ Settings',
  build: async (ctx, theme) => {
    const currentTheme = ctx.user?.theme || 'auto';
    const text = buildMessage(theme, [
      {
        title: '⚙️ Settings',
        lines: [
          `${theme.emoji.settings} Choose your preferred display theme:`,
          `_Auto mode uses Myanmar Standard Time (6PM–6AM = Dark)_`,
        ],
      },
    ]);
    return { text, keyboard: buildThemeKeyboard(currentTheme) };
  },
});

module.exports = function registerSettings(bot) {
  bot.command('settings', async (ctx) => {
    await Nav.navigate(ctx, 'settings_view');
  });

  bot.hears('⚙️ Settings', async (ctx) => {
    await Nav.navigate(ctx, 'settings_view');
  });
};
