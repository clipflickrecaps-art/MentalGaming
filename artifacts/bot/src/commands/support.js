const { Markup } = require('telegraf');
const Nav = require('../services/NavigationService');
const { buildMessage } = require('../utils/ui');
const { config } = require('../../config/settings');

Nav.register({
  id: 'support_view',
  title: '💬 Support',
  build: async (ctx, theme) => {
    const text = buildMessage(theme, [
      {
        title: '💬 Customer Support',
        lines: [
          `${theme.emoji.bullet} Available: *9AM – 11PM* (MMT)`,
          `${theme.emoji.bullet} Response time: *within 30 minutes*`,
          ``,
          `*How can we help you?*`,
        ],
      },
    ]);

    return {
      text,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('📦 Order Issue',   'support_order')],
        [Markup.button.callback('💰 Wallet / Payment', 'support_topup')],
        [Markup.button.callback('🐛 Report a Bug',  'support_bug')],
        [Markup.button.callback('❓ General Query',  'support_general')],
        [Nav.backButton('🔙 Main Menu')],
      ]),
    };
  },
});

module.exports = function registerSupport(bot) {
  bot.command('support', async (ctx) => {
    await Nav.navigate(ctx, 'support_view');
  });

  bot.hears('💬 Support', async (ctx) => {
    await Nav.navigate(ctx, 'support_view');
  });

  async function openSupportTicket(ctx, topic) {
    await ctx.answerCbQuery();
    const user = ctx.from;
    const userTag = user.username ? `@${user.username}` : `ID: ${user.id}`;

    await ctx.reply(
      `💬 *Support Ticket — ${topic}*\n\n` +
      `Please describe your issue in detail.\n` +
      `Include: Order ID (if any), what happened, and what you expected.\n\n` +
      `_Your message will be forwarded to admin._`,
      { parse_mode: 'Markdown', ...Markup.forceReply() }
    );

    ctx.session.supportTicketTopic = topic;
  }

  bot.action('support_order',   (ctx) => openSupportTicket(ctx, '📦 Order Issue'));
  bot.action('support_bug',     (ctx) => openSupportTicket(ctx, '🐛 Bug Report'));
  bot.action('support_general', (ctx) => openSupportTicket(ctx, '❓ General Query'));

  // Intercept support ticket messages
  bot.on('text', async (ctx, next) => {
    const topic = ctx.session?.supportTicketTopic;
    if (!topic) return next();

    ctx.session.supportTicketTopic = null;
    const user = ctx.from;
    const userTag = user.username ? `@${user.username}` : `ID: ${user.id}`;
    const messageText = ctx.message.text;

    try {
      await ctx.telegram.sendMessage(
        config.bot.adminId,
        `📩 *Support Ticket*\n\n` +
        `*Topic:* ${topic}\n` +
        `*From:* ${userTag} _(${user.first_name})_\n` +
        `*Message:*\n${messageText}`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(`💬 Reply to ${userTag}`, `reply_user:${user.id}`)],
          ]),
        }
      );

      await ctx.reply(
        `✅ *Ticket submitted!*\n\n` +
        `Our team will respond shortly.\n_Topic: ${topic}_`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      await ctx.reply('❌ Failed to send ticket. Please try again later.');
    }
  });

  // Admin reply to user
  bot.action(/^reply_user:(\d+)$/, async (ctx) => {
    if (ctx.from.id !== config.bot.adminId) return ctx.answerCbQuery('Access denied', { show_alert: true });

    const userId = parseInt(ctx.match[1], 10);
    ctx.session.adminReplyToUser = userId;
    await ctx.answerCbQuery();
    await ctx.reply(
      `✍️ Type your reply to user ID ${userId}:`,
      { parse_mode: 'Markdown', ...Markup.forceReply() }
    );
  });

  // Send admin reply to user
  bot.on('text', async (ctx, next) => {
    const replyTarget = ctx.session?.adminReplyToUser;
    if (!replyTarget || ctx.from.id !== config.bot.adminId) return next();

    ctx.session.adminReplyToUser = null;
    try {
      await ctx.telegram.sendMessage(
        replyTarget,
        `💬 *Reply from Mental Gaming Store Support:*\n\n${ctx.message.text}`,
        { parse_mode: 'Markdown' }
      );
      await ctx.reply(`✅ Reply sent to user ${replyTarget}.`);
    } catch {
      await ctx.reply(`❌ Could not deliver reply. User may have blocked the bot.`);
    }
  });
};
