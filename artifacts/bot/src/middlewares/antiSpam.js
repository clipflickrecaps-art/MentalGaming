const { config } = require('../../config/settings');

const requestMap = new Map();

function antiSpam() {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const now = Date.now();
    const windowMs = 60_000;
    const maxRequests = config.antiSpam.maxRequestsPerMinute;

    if (!requestMap.has(userId)) {
      requestMap.set(userId, { count: 1, windowStart: now });
      return next();
    }

    const record = requestMap.get(userId);

    if (now - record.windowStart > windowMs) {
      record.count = 1;
      record.windowStart = now;
      return next();
    }

    record.count += 1;

    if (record.count > maxRequests) {
      console.warn(`[AntiSpam] User ${userId} exceeded rate limit`);
      return ctx.reply('🚫 You are sending messages too fast. Please slow down.');
    }

    return next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [userId, record] of requestMap.entries()) {
    if (now - record.windowStart > 120_000) {
      requestMap.delete(userId);
    }
  }
}, 60_000);

module.exports = { antiSpam };
