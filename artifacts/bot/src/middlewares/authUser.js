const User = require('../models/User');

function attachUser() {
  return async (ctx, next) => {
    if (!ctx.from) return next();

    try {
      const user = await User.findOrCreate(ctx.from.id, ctx.from.username);

      if (user.isBlocked) {
        return ctx.reply('🚫 Your account has been suspended. Contact support.');
      }

      ctx.user = user;
    } catch (err) {
      console.error('[AuthUser] Error fetching user:', err.message);
    }

    return next();
  };
}

function requireRight(right) {
  return async (ctx, next) => {
    if (!ctx.user) return ctx.reply('❌ Could not verify your account. Try again.');

    if (!ctx.user.hasRight(right)) {
      return ctx.reply(`⛔ You do not have permission to perform this action.`);
    }

    return next();
  };
}

module.exports = { attachUser, requireRight };
