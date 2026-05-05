const { buildSettingsKeyboard, getTheme } = require('../services/ThemeService');
const { buildMessage } = require('../utils/ui');
const { Markup } = require('telegraf');
const Nav = require('../services/NavigationService');
const User = require('../models/User');

Nav.register({
  id: 'settings_view',
  title: '⚙️ Settings',
  build: async (ctx, theme) => {
    const currentTheme = ctx.user?.theme    || 'auto';
    const currentLang  = ctx.user?.language || 'en';

    const langLabel = currentLang === 'mm' ? '🇲🇲 Myanmar' : '🇬🇧 English';

    const text = buildMessage(theme, [
      {
        title: '⚙️ Settings',
        lines: [
          `${theme.emoji.settings} *Display Theme:* ${currentTheme === 'auto' ? 'Auto (Myanmar Time)' : currentTheme}`,
          `_Auto mode: 6PM–6AM MMT = Dark, 6AM–6PM = Light_`,
          ``,
          `🌐 *Language:* ${langLabel}`,
        ],
      },
    ]);

    return { text, keyboard: buildSettingsKeyboard(currentTheme, currentLang) };
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
