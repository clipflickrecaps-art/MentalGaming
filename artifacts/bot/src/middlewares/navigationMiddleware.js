/**
 * Navigation Middleware
 *
 * Intercepts global nav:* callback actions so any registered folder
 * can use back buttons without wiring them into every command.
 *
 * Handled actions:
 *   nav:back        → go back one level in history
 *   nav:go:<id>     → navigate to folder <id>
 *   nav:home        → clear history and go to main
 *   theme_set:<key> → set user theme preference
 */

const Nav = require('../services/NavigationService');
const { setUserTheme, buildThemeKeyboard, getTheme } = require('../services/ThemeService');

function navigationMiddleware(bot) {
  bot.action('nav:back', async (ctx) => {
    await ctx.answerCbQuery();
    await Nav.back(ctx);
  });

  bot.action('nav:home', async (ctx) => {
    await ctx.answerCbQuery();
    Nav.clearHistory(ctx);
    await Nav.navigate(ctx, 'main', true);
  });

  bot.action(/^nav:go:(.+)$/, async (ctx) => {
    const folderId = ctx.match[1];
    await ctx.answerCbQuery();
    await Nav.navigate(ctx, folderId, true);
  });

  bot.action(/^theme_set:(.+)$/, async (ctx) => {
    const themeName = ctx.match[1];
    await ctx.answerCbQuery(`Theme set to ${themeName}`);

    try {
      await setUserTheme(ctx.from.id, themeName);
      if (ctx.user) ctx.user.theme = themeName;

      const theme = getTheme(ctx.user);
      await ctx.editMessageText(
        `${theme.format.header('Theme Updated')}\n${theme.emoji.settings} Your theme is now set to ${theme.format.bold(themeName === 'auto' ? 'Auto (Myanmar Time)' : themeName)}.\n\n_Changes apply immediately to all menus._`,
        {
          parse_mode: 'Markdown',
          ...buildThemeKeyboard(themeName),
        }
      );
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });
}

module.exports = { navigationMiddleware };
