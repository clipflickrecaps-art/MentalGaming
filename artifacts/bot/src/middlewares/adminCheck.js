const { config } = require('../../config/settings');

function adminOnly() {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId !== config.bot.adminId) {
      return ctx.reply('⛔ Access denied. This command is for admins only.');
    }
    return next();
  };
}

function superAdminOnly(allowedIds = []) {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    const ids = [config.bot.adminId, ...allowedIds];
    if (!ids.includes(userId)) {
      return ctx.reply('⛔ Access denied.');
    }
    return next();
  };
}

module.exports = { adminOnly, superAdminOnly };
