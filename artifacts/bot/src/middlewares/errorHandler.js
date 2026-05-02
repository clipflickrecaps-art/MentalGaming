function errorHandler() {
  return async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      console.error('[ErrorHandler] Unhandled error:', err);
      try {
        await ctx.reply('❌ Something went wrong. Please try again later.');
      } catch (_) {}
    }
  };
}

module.exports = { errorHandler };
