/**
 * Feedback & Review Commands
 *
 * User:
 *   /reviews            — public review wall (4-5★)
 *
 * Admin (MANAGER+):
 *   /setfeedbackchannel <@channel or -100id>  — set public review channel
 *   /feedbackstats                            — overview of feedback metrics
 *   /togglefeedback                           — pause/resume automated requests
 *
 * Callbacks (registered globally — triggered by FeedbackService rating prompts):
 *   rate:<orderId>:<1-5|skip>
 *   rate_comment:<reviewId>
 *   rate_skip_comment:<reviewId>
 */

const { Markup } = require('telegraf');
const { requireRole, adminOnly } = require('../middlewares/adminCheck');
const {
  submitRating,
  submitComment,
  forwardToChannel,
  getPublicReviews,
  getStats,
} = require('../services/FeedbackService');
const { auditLog } = require('../services/logger');
const SystemStatus = require('../models/SystemStatus');
const Review       = require('../models/Review');

// ── Star display ──────────────────────────────────────────────────────────────

function stars(n) {
  return '⭐'.repeat(n || 0) + '☆'.repeat(5 - (n || 0));
}

// ── Module ─────────────────────────────────────────────────────────────────────

module.exports = function registerFeedback(bot) {

  // ── /reviews — public review wall ────────────────────────────────────────────

  bot.command('reviews', async (ctx) => {
    const reviews = await getPublicReviews(10);

    if (!reviews.length) {
      return ctx.reply(
        `🌟 *Customer Reviews*\n\n` +
        `_No reviews yet — be the first to rate your order!_\n\n` +
        `After every successful order, we'll ask for your feedback.`,
        { parse_mode: 'Markdown' }
      );
    }

    const statsData = await getStats();

    const header =
      `🌟 *Customer Reviews*\n` +
      `\`━━━━━━━━━━━━━━━━━━━━━━\`\n` +
      `⭐ Average: *${statsData.avgRating}/5* from *${statsData.rated}* reviews\n` +
      `✨ 5-Star Reviews: *${statsData.fiveStars}*\n` +
      `\`━━━━━━━━━━━━━━━━━━━━━━\`\n\n`;

    const cards = reviews.slice(0, 5).map((r) =>
      `${stars(r.rating)}\n_"${r.comment}"_\n🛒 ${r.productName}`
    ).join('\n\n──────────────────────\n\n');

    await ctx.reply(header + cards, { parse_mode: 'Markdown' });
  });

  // ── Rating callback: rate:<orderId>:<1-5|skip> ────────────────────────────────

  bot.action(/^rate:(.+):(\d+|skip)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId   = ctx.match[1];
    const ratingStr = ctx.match[2];

    if (ratingStr === 'skip') {
      // Mark as skipped
      await Review.findOneAndUpdate(
        { orderId, telegramId: ctx.from.id },
        { skipped: true }
      );
      await ctx.editMessageText(
        `_Thanks! You can always leave a review later from /reviews._`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const rating = parseInt(ratingStr, 10);
    const review = await submitRating(orderId, ctx.from.id, rating);

    if (!review) {
      return ctx.editMessageText('❌ Could not save your rating. Please try /support.');
    }

    // Edit the original rating message
    await ctx.editMessageText(
      `${stars(rating)} *Thank you for rating ${rating}/5!*\n\n` +
      (rating >= 3
        ? `Would you like to leave a comment? _(Optional)_`
        : `_We're sorry to hear that. We'll work to improve!_`),
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(
          rating >= 3
            ? [
                [Markup.button.callback('✍️ Add a Comment', `rate_comment:${review._id}`)],
                [Markup.button.callback('⏭️ Skip',          `rate_skip_comment:${review._id}`)],
              ]
            : [
                [Markup.button.callback('🎫 Get Support', 'support_ai_start')],
                [Markup.button.callback('⏭️ Done',         `rate_skip_comment:${review._id}`)],
              ]
        ),
      }
    );
  });

  // ── Prompt for comment ─────────────────────────────────────────────────────────

  bot.action(/^rate_comment:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const reviewId = ctx.match[1];
    ctx.session.awaitingReviewComment = reviewId;

    await ctx.reply(
      `✍️ *Leave a Comment*\n\n` +
      `Tell us about your experience (max 500 chars):\n` +
      `_Your review may be featured on our public wall!_`,
      { parse_mode: 'Markdown', ...Markup.forceReply() }
    );
  });

  // ── Skip comment ──────────────────────────────────────────────────────────────

  bot.action(/^rate_skip_comment:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery('Thanks for your feedback!');
    ctx.session.awaitingReviewComment = null;

    const review = await Review.findById(ctx.match[1]);
    // If 4-5 stars but no comment — still forward if already has comment from before
    if (review?.isPublic && review.comment && !review.forwardedToChannel) {
      await forwardToChannel(review, ctx.telegram);
    }

    await ctx.editMessageText(
      `✅ *Feedback saved! Thank you.* 🙏\n\n_We appreciate your time._`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Text interceptor: review comment ─────────────────────────────────────────

  bot.on('text', async (ctx, next) => {
    if (!ctx.session?.awaitingReviewComment) return next();
    if (ctx.message?.text?.startsWith('/')) return next();

    const reviewId = ctx.session.awaitingReviewComment;
    ctx.session.awaitingReviewComment = null;

    const comment = ctx.message.text.trim();
    if (comment.length < 3) {
      return ctx.reply('❌ Comment too short. Try again or use /reviews.');
    }

    const review = await submitComment(reviewId, comment, ctx.telegram);
    if (!review) return ctx.reply('❌ Could not save comment.');

    const isPublished = review.forwardedToChannel;
    await ctx.reply(
      `✅ *Review saved!*\n\n` +
      `${stars(review.rating)} ${review.rating}/5 — _"${comment}"_\n\n` +
      (isPublished
        ? `🌟 *Your review has been featured on our wall!*`
        : `_Thank you for helping us improve!_`),
      { parse_mode: 'Markdown' }
    );
  });

  // ── Admin: /setfeedbackchannel <channelId> ────────────────────────────────────

  bot.command('setfeedbackchannel', requireRole('MANAGER'), async (ctx) => {
    const channelId = ctx.message.text.split(/\s+/)[1];
    if (!channelId) {
      const status = await SystemStatus.get();
      return ctx.reply(
        `📢 *Feedback Channel Config*\n\n` +
        `Current: ${status.feedbackChannelId || '_Not set_'}\n` +
        `Enabled: ${status.feedbackEnabled ? '🟢 Yes' : '🔴 No'}\n\n` +
        `Usage: \`/setfeedbackchannel @channel_username\`\n` +
        `or: \`/setfeedbackchannel -1001234567890\``,
        { parse_mode: 'Markdown' }
      );
    }

    await SystemStatus.set({ feedbackChannelId: channelId }, ctx.from.id);
    await auditLog(ctx.from.id, 'SET_FEEDBACK_CHANNEL', null, 'System', { channelId });

    await ctx.reply(
      `✅ Feedback channel set to: *${channelId}*\n\n` +
      `4-5★ reviews with comments will now be forwarded there automatically.`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Admin: /feedbackstats ─────────────────────────────────────────────────────

  bot.command('feedbackstats', requireRole('MANAGER'), async (ctx) => {
    const [statsData, status] = await Promise.all([
      getStats(),
      SystemStatus.get(),
    ]);

    const ratingBreakdown = await Review.aggregate([
      { $match: { rating: { $ne: null } } },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ]);

    const breakdownLines = ratingBreakdown.map((r) =>
      `  ${stars(r._id)} × ${r.count}`
    ).join('\n') || '  _None yet_';

    await ctx.reply(
      `📊 *Feedback Statistics*\n` +
      `\`━━━━━━━━━━━━━━━━━━━━━━\`\n` +
      `*Program:* ${status.feedbackEnabled ? '🟢 Active' : '🔴 Paused'}\n` +
      `*Channel:* ${status.feedbackChannelId || '_Not configured_'}\n` +
      `\`──────────────────────\`\n` +
      `📩 Requests Sent: *${statsData.total}*\n` +
      `📝 Responses: *${statsData.rated}* (${statsData.responseRate}%)\n` +
      `⭐ Average Rating: *${statsData.avgRating}/5*\n` +
      `✨ 5-Star Reviews: *${statsData.fiveStars}*\n` +
      `\`──────────────────────\`\n` +
      `*Rating Breakdown:*\n${breakdownLines}`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Admin: /togglefeedback ────────────────────────────────────────────────────

  bot.command('togglefeedback', requireRole('MANAGER'), async (ctx) => {
    const status   = await SystemStatus.get();
    const newState = !status.feedbackEnabled;

    await SystemStatus.set({ feedbackEnabled: newState }, ctx.from.id);
    await auditLog(ctx.from.id, newState ? 'FEEDBACK_ENABLED' : 'FEEDBACK_DISABLED', null, 'System', {});

    await ctx.reply(
      newState
        ? `🟢 *Automated feedback requests are now ACTIVE.*`
        : `🔴 *Automated feedback requests are now PAUSED.*`,
      { parse_mode: 'Markdown' }
    );
  });
};
