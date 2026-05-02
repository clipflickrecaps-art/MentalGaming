/**
 * Support Command
 *
 * User: /support → enters supportScene (AI assistant → escalate)
 * Admin: ticket management — reply, resolve, list open tickets
 */

const { Markup } = require('telegraf');
const Nav = require('../services/NavigationService');
const { buildMessage, formatDate } = require('../utils/ui');
const { adminOnly } = require('../middlewares/adminCheck');
const { auditLog } = require('../services/logger');
const SupportTicket = require('../models/SupportTicket');
const { config } = require('../../config/settings');

const TOPIC_META = {
  order:   { label: '📦 Order Issue',      emoji: '📦' },
  payment: { label: '💳 Payment / Wallet', emoji: '💳' },
  game:    { label: '🎮 Game Help',        emoji: '🎮' },
  bug:     { label: '🐛 Bug Report',       emoji: '🐛' },
  general: { label: '❓ General Query',    emoji: '❓' },
};

Nav.register({
  id: 'support_view',
  title: '💬 Support',
  build: async (ctx, theme) => {
    const text = buildMessage(theme, [
      {
        title: '💬 Customer Support',
        lines: [
          `🤖 AI Assistant available *24/7*`,
          `👨 Human support: *9AM – 11PM* MMT`,
          `⚡ AI responds instantly`,
          ``,
          `*How can we help you today?*`,
        ],
      },
    ]);

    return {
      text,
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback('🤖 Get AI Help',        'support_ai_start')],
        [Markup.button.callback('📦 Order Issue',        'support_ai_start')],
        [Markup.button.callback('💳 Payment / Wallet',   'support_ai_start')],
        [Nav.backButton('🔙 Main Menu')],
      ]),
    };
  },
});

module.exports = function registerSupport(bot) {

  // ── User: /support ─────────────────────────────────────────────────────────
  bot.command('support', async (ctx) => {
    await ctx.scene.enter('support_scene');
  });

  bot.hears('💬 Support', async (ctx) => {
    await ctx.scene.enter('support_scene');
  });

  bot.action('support_ai_start', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('support_scene');
  });

  // ── User: /mytickets ───────────────────────────────────────────────────────
  bot.command('mytickets', async (ctx) => {
    const tickets = await SupportTicket.find({ telegramId: ctx.from.id })
      .sort({ createdAt: -1 })
      .limit(5);

    if (!tickets.length) {
      return ctx.reply(
        `🎫 *My Support Tickets*\n\nNo tickets yet.\n\nUse /support to get help.`,
        { parse_mode: 'Markdown' }
      );
    }

    const statusIcon = { Open: '🟡', InProgress: '🔵', Resolved: '✅', Closed: '⚫' };
    const lines = tickets.map((t) => {
      const meta = TOPIC_META[t.topic] || { emoji: '❓' };
      return `${statusIcon[t.status] || '⚪'} \`${t.ticketId}\` — ${meta.emoji} ${t.topic} — *${t.status}*\n  _${formatDate(t.createdAt)}_`;
    });

    await ctx.reply(
      `🎫 *My Support Tickets (${tickets.length})*\n\n${lines.join('\n\n')}`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Admin: /tickets ────────────────────────────────────────────────────────
  bot.command('tickets', adminOnly(), async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1);
    const filter = args[0] === 'all' ? {} : { status: { $in: ['Open', 'InProgress'] } };

    const tickets = await SupportTicket.find(filter).sort({ createdAt: -1 }).limit(10);
    if (!tickets.length) return ctx.reply('✅ No open tickets.');

    const priorityBadge = { Normal: '🟡', High: '🟠', Urgent: '🔴' };
    for (const t of tickets) {
      const meta = TOPIC_META[t.topic] || { emoji: '❓', label: t.topic };
      const badge = priorityBadge[t.priority] || '🟡';
      const userTag = t.username ? `@${t.username}` : `ID: ${t.telegramId}`;

      await ctx.reply(
        `🎫 \`${t.ticketId}\` — ${badge} ${t.priority}\n` +
        `${meta.emoji} *${meta.label}*\n` +
        `👤 ${userTag} | ${t.status}\n` +
        `_${formatDate(t.createdAt)}_\n\n` +
        `*Message:* ${t.userMessage.slice(0, 200)}`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback(`💬 Reply`, `ticket_reply:${t.ticketId}`)],
            [
              Markup.button.callback('✅ Resolve', `ticket_resolve:${t.ticketId}`),
              Markup.button.callback('🔴 Urgent',  `ticket_urgent:${t.ticketId}`),
            ],
          ]),
        }
      );
    }
  });

  // ── Admin action: reply to ticket ──────────────────────────────────────────
  bot.action(/^ticket_reply:(.+)$/, adminOnly(), async (ctx) => {
    const ticketId = ctx.match[1];
    await ctx.answerCbQuery();

    const ticket = await SupportTicket.findOne({ ticketId });
    if (!ticket) return ctx.reply('❌ Ticket not found.');

    ctx.session.adminTicketReply = { ticketId, userTelegramId: ticket.telegramId };
    await ctx.reply(
      `💬 *Reply to Ticket \`${ticketId}\`*\n\n` +
      `Original: _${ticket.userMessage.slice(0, 100)}_\n\n` +
      `Type your reply:`,
      { parse_mode: 'Markdown', ...Markup.forceReply() }
    );
  });

  // ── Admin action: resolve ticket ───────────────────────────────────────────
  bot.action(/^ticket_resolve:(.+)$/, adminOnly(), async (ctx) => {
    const ticketId = ctx.match[1];
    await ctx.answerCbQuery('Resolving...');

    const ticket = await SupportTicket.findOneAndUpdate(
      { ticketId },
      { status: 'Resolved', resolvedBy: ctx.from.id },
      { new: true }
    );
    if (!ticket) return ctx.reply('❌ Ticket not found.');

    await auditLog(ctx.from.id, 'TICKET_RESOLVED', ticketId, 'SupportTicket');
    await ctx.reply(`✅ Ticket \`${ticketId}\` marked as Resolved.`, { parse_mode: 'Markdown' });

    try {
      await ctx.telegram.sendMessage(
        ticket.telegramId,
        `✅ *Your support ticket has been resolved!*\n\n` +
        `🎫 Ticket: \`${ticketId}\`\n\n` +
        `_If you need further help, use /support anytime._`,
        { parse_mode: 'Markdown' }
      );
    } catch {}
  });

  // ── Admin action: mark urgent ──────────────────────────────────────────────
  bot.action(/^ticket_urgent:(.+)$/, adminOnly(), async (ctx) => {
    const ticketId = ctx.match[1];
    await ctx.answerCbQuery('Marked Urgent');

    await SupportTicket.findOneAndUpdate({ ticketId }, { priority: 'Urgent', status: 'InProgress' });
    await ctx.reply(`🔴 Ticket \`${ticketId}\` marked *Urgent* and set to *InProgress*.`, {
      parse_mode: 'Markdown',
    });
  });

  // ── Admin: /closeticket ────────────────────────────────────────────────────
  bot.command('closeticket', adminOnly(), async (ctx) => {
    const ticketId = ctx.message.text.split(/\s+/)[1];
    if (!ticketId) return ctx.reply('Usage: /closeticket TKT-XXXX');

    const ticket = await SupportTicket.findOneAndUpdate(
      { ticketId: ticketId.toUpperCase() },
      { status: 'Closed', resolvedBy: ctx.from.id },
      { new: true }
    );
    if (!ticket) return ctx.reply('❌ Ticket not found.');

    await ctx.reply(`⚫ Ticket \`${ticket.ticketId}\` closed.`, { parse_mode: 'Markdown' });
  });

  // ── Text interceptor: admin ticket reply ──────────────────────────────────
  bot.on('text', async (ctx, next) => {
    const state = ctx.session?.adminTicketReply;
    if (!state || ctx.from.id !== config.bot.adminId) return next();

    const { ticketId, userTelegramId } = state;
    ctx.session.adminTicketReply = null;

    const replyText = ctx.message.text.trim();

    try {
      await SupportTicket.findOneAndUpdate(
        { ticketId },
        {
          $push: { replies: { from: 'admin', message: replyText } },
          status: 'InProgress',
        }
      );

      await ctx.telegram.sendMessage(
        userTelegramId,
        `💬 *Support Reply* — Ticket \`${ticketId}\`\n\n${replyText}\n\n` +
        `_To reply, use /support and create a new ticket or reply here._`,
        { parse_mode: 'Markdown' }
      );

      await ctx.reply(`✅ Reply sent for ticket \`${ticketId}\`.`, { parse_mode: 'Markdown' });
      await auditLog(ctx.from.id, 'TICKET_REPLIED', ticketId, 'SupportTicket');
    } catch (err) {
      await ctx.reply(`❌ Failed to send reply: ${err.message}`);
    }
  });

  // ── Text interceptor: legacy admin reply (from old flow) ──────────────────
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

  // ── Admin reply button from old ticket notifications ───────────────────────
  bot.action(/^reply_user:(\d+)$/, async (ctx) => {
    if (ctx.from.id !== config.bot.adminId) return ctx.answerCbQuery('Access denied', { show_alert: true });
    const userId = parseInt(ctx.match[1], 10);
    ctx.session.adminReplyToUser = userId;
    await ctx.answerCbQuery();
    await ctx.reply(`✍️ Type your reply to user ${userId}:`, { ...Markup.forceReply() });
  });
};
