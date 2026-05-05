/**
 * AntiSpam Middleware
 *
 * Sliding-window rate limiter (per user, per minute).
 * Tracks spam strike count — on warningThreshold consecutive violations,
 * automatically issues a warning via UserManagementService.
 *
 * Admin is always exempt.
 */

const { config } = require('../../config/settings');

// { userId → { count, windowStart, strikes, lastWarned } }
const requestMap = new Map();

function antiSpam() {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    // Admin is always exempt
    if (userId === config.bot.adminId) return next();

    const now      = Date.now();
    const windowMs = 60_000;
    const maxReq   = config.antiSpam.maxRequestsPerMinute;
    const maxStrikes = config.antiSpam.warningThreshold;

    if (!requestMap.has(userId)) {
      requestMap.set(userId, { count: 1, windowStart: now, strikes: 0, lastWarned: 0 });
      return next();
    }

    const rec = requestMap.get(userId);

    // Reset window if expired
    if (now - rec.windowStart > windowMs) {
      rec.count       = 1;
      rec.windowStart = now;
      rec.strikes     = 0;
      return next();
    }

    rec.count += 1;

    if (rec.count > maxReq) {
      rec.strikes += 1;

      // Auto-warn after N consecutive spam violations (throttled to once per 5 min)
      if (rec.strikes >= maxStrikes && now - rec.lastWarned > 5 * 60_000) {
        rec.lastWarned = now;
        rec.strikes    = 0;

        // Fire-and-forget: don't block current request handling
        setImmediate(async () => {
          try {
            const { warnUser } = require('../services/UserManagementService');
            const result = await warnUser(userId, config.bot.adminId, 'Auto: excessive message rate');

            if (result.autoBanned) {
              await ctx.telegram.sendMessage(
                userId,
                '🚫 *Your account has been suspended* due to repeated spam violations.\n_Contact support to appeal._',
                { parse_mode: 'Markdown' }
              ).catch(() => {});
            } else {
              await ctx.telegram.sendMessage(
                userId,
                `⚠️ *Spam Warning (${result.user.warningsCount}/3)*\n\nYou are sending messages too quickly.\n_${3 - result.user.warningsCount} more warning(s) will result in a ban._`,
                { parse_mode: 'Markdown' }
              ).catch(() => {});
            }

            // Notify admin
            await ctx.telegram.sendMessage(
              config.bot.adminId,
              `🤖 *Auto Spam Warning Issued*\n\nUser: \`${userId}\`\nWarnings: ${result.user.warningsCount}/3`,
              { parse_mode: 'Markdown' }
            ).catch(() => {});
          } catch {}
        });
      }

      console.warn(`[AntiSpam] User ${userId} rate limited (${rec.count}/${maxReq}, strikes: ${rec.strikes})`);
      return ctx.reply('🚫 Slow down! You are sending messages too fast.').catch(() => {});
    }

    return next();
  };
}

// Cleanup stale records every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [uid, rec] of requestMap.entries()) {
    if (now - rec.windowStart > 120_000) requestMap.delete(uid);
  }
}, 120_000);

module.exports = { antiSpam };
