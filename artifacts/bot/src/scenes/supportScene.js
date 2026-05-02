/**
 * SupportScene — AI-powered customer support wizard
 *
 * Step 0 → Topic selection
 * Step 1 → User types question → AI generates instant answer (with "typing" animation)
 * Step 2 → Show AI answer → [✅ Solved!] [❌ Need human help]
 *   ✅ → Thank user + mark resolved
 *   ❌ → Create SupportTicket → Notify admin with full context → Ticket ID to user
 *
 * Auto-escalation:
 *   - AI signals [ESCALATE] → skip to human automatically
 *   - High frustration detected → priority = Urgent
 */

const { Scenes, Markup } = require('telegraf');
const { answerSupportQuery, analyzeSentiment } = require('../services/aiService');
const { config } = require('../../config/settings');
const { price, formatDate } = require('../utils/ui');
const SupportTicket = require('../models/SupportTicket');
const User = require('../models/User');
const Order = require('../models/Order');

const TOPIC_META = {
  order:   { label: '📦 Order Issue',      emoji: '📦', priority: 'High'   },
  payment: { label: '💳 Payment / Wallet', emoji: '💳', priority: 'High'   },
  game:    { label: '🎮 Game Help',        emoji: '🎮', priority: 'Normal' },
  bug:     { label: '🐛 Bug Report',       emoji: '🐛', priority: 'Urgent' },
  general: { label: '❓ General Query',    emoji: '❓', priority: 'Normal' },
};

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Typing animation (3 dots) ─────────────────────────────────────────────────
async function showThinking(ctx) {
  const msg = await ctx.reply('🤖 _AI is thinking..._', { parse_mode: 'Markdown' });
  const frames = ['🤖 .  ', '🤖 .. ', '🤖 ...'];
  for (let i = 0; i < 3; i++) {
    await sleep(600);
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, frames[i]).catch(() => {});
  }
  return { chatId: ctx.chat.id, messageId: msg.message_id };
}

// ── Admin ticket notification ─────────────────────────────────────────────────
async function notifyAdminNewTicket(ctx, ticket, user) {
  const topicMeta  = TOPIC_META[ticket.topic] || TOPIC_META.general;
  const userTag    = user.username ? `@${user.username}` : `ID: ${ticket.telegramId}`;
  const priorityBadge = { Normal: '🟡', High: '🟠', Urgent: '🔴' }[ticket.priority] || '🟡';

  const text =
    `📩 *New Support Ticket*\n\n` +
    `🎫 Ticket: \`${ticket.ticketId}\`\n` +
    `${priorityBadge} Priority: *${ticket.priority}*\n` +
    `${topicMeta.emoji} Topic: *${topicMeta.label}*\n` +
    `👤 User: ${userTag}\n` +
    `⭐ Tier: ${user.membershipTier}\n` +
    `🕐 Time: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Rangoon' })} MMT\n\n` +
    `*User Message:*\n${ticket.userMessage}\n\n` +
    (ticket.aiResponse
      ? `*AI Attempted Response:*\n_${ticket.aiResponse.slice(0, 200)}${ticket.aiResponse.length > 200 ? '...' : ''}_\n\n`
      : '') +
    `_User said AI answer was not helpful — needs human support._`;

  try {
    await ctx.telegram.sendMessage(config.bot.adminId, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(`💬 Reply to ${userTag}`, `ticket_reply:${ticket.ticketId}`)],
        [Markup.button.callback('✅ Mark Resolved',       `ticket_resolve:${ticket.ticketId}`)],
        [Markup.button.callback('🔴 Mark Urgent',         `ticket_urgent:${ticket.ticketId}`)],
      ]),
    });
  } catch (err) {
    console.error('[SupportScene] Admin notify failed:', err.message);
  }
}

const supportScene = new Scenes.WizardScene(
  'support_scene',

  // ── Step 0: Topic selection ──────────────────────────────────────────────
  async (ctx) => {
    await ctx.reply(
      `💬 *Customer Support*\n\n` +
      `🤖 Our AI assistant will try to help you instantly.\n` +
      `If it can't solve your issue, we'll connect you with a human.\n\n` +
      `*What do you need help with?*`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📦 Order Issue',       'sup_topic:order')],
          [Markup.button.callback('💳 Payment / Wallet',  'sup_topic:payment')],
          [Markup.button.callback('🎮 Game Help',         'sup_topic:game')],
          [Markup.button.callback('🐛 Bug Report',        'sup_topic:bug')],
          [Markup.button.callback('❓ General Query',     'sup_topic:general')],
          [Markup.button.callback('❌ Cancel',            'sup_cancel')],
        ]),
      }
    );
    return ctx.wizard.next();
  },

  // ── Step 1: Await question text ──────────────────────────────────────────
  async (ctx) => {
    if (!ctx.message?.text) return;

    const topic   = ctx.session.supportTopic || 'general';
    const message = ctx.message.text.trim();
    ctx.session.supportUserMessage = message;

    const thinkRef = await showThinking(ctx);

    // Run AI + sentiment in parallel
    const [aiResult, sentiment] = await Promise.all([
      answerSupportQuery(message, { telegramId: ctx.from.id, topic }),
      analyzeSentiment(message),
    ]);

    ctx.session.supportAiResponse   = aiResult.answer;
    ctx.session.supportShouldEscalate = aiResult.shouldEscalate;
    ctx.session.supportSentiment    = sentiment;

    const topicMeta = TOPIC_META[topic] || TOPIC_META.general;

    // If AI has no answer or signals escalation → skip straight to human
    if (aiResult.shouldEscalate || !aiResult.answer) {
      await ctx.telegram.editMessageText(
        thinkRef.chatId,
        thinkRef.messageId,
        undefined,
        `🤖 _Let me connect you with our support team..._`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});

      await sleep(800);
      return escalateToHuman(ctx, topic, message, null, sentiment);
    }

    // Show AI answer
    const sentimentNote = ['frustrated', 'angry'].includes(sentiment)
      ? `\n\n_I can see you're frustrated — if this doesn't help, I'll connect you with a human right away._`
      : '';

    await ctx.telegram.editMessageText(
      thinkRef.chatId,
      thinkRef.messageId,
      undefined,
      `🤖 *AI Assistant*\n\n${aiResult.answer}${sentimentNote}`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});

    await ctx.reply(
      `Was this helpful?`,
      {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Yes, solved!',         'sup_solved')],
          [Markup.button.callback('❌ No, need human help',  'sup_escalate')],
        ]),
      }
    );

    return ctx.wizard.next();
  },

  // ── Step 2: Placeholder — handled by actions ──────────────────────────────
  async (ctx) => ctx.scene.leave()
);

// ── Action: topic selected ────────────────────────────────────────────────────
supportScene.action(/^sup_topic:(.+)$/, async (ctx) => {
  const topic = ctx.match[1];
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

  ctx.session.supportTopic = topic;
  const topicMeta = TOPIC_META[topic] || TOPIC_META.general;

  const hint = {
    order:   'Include your Order ID if you have one (e.g. from /orders).',
    payment: 'Include the amount, payment method, and date.',
    game:    'Tell us which game and what you need help with.',
    bug:     'Describe what happened step by step.',
    general: 'Ask anything about our store or services.',
  }[topic] || '';

  await ctx.reply(
    `${topicMeta.emoji} *${topicMeta.label}*\n\n` +
    `Please describe your issue:\n_${hint}_`,
    { parse_mode: 'Markdown' }
  );

  ctx.wizard.selectStep(1);
});

// ── Action: user says solved ──────────────────────────────────────────────────
supportScene.action('sup_solved', async (ctx) => {
  await ctx.answerCbQuery('Great!');
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

  await ctx.reply(
    `✅ *Glad we could help!*\n\n` +
    `If you have more questions, use /support anytime.\n\n` +
    `_Thank you for choosing Mental Gaming Store! 🎮_`,
    { parse_mode: 'Markdown' }
  );

  ctx.session.supportTopic = null;
  ctx.session.supportUserMessage = null;
  ctx.session.supportAiResponse = null;
  return ctx.scene.leave();
});

// ── Action: escalate to human ─────────────────────────────────────────────────
supportScene.action('sup_escalate', async (ctx) => {
  await ctx.answerCbQuery('Connecting you with our team...');
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

  const topic   = ctx.session.supportTopic || 'general';
  const message = ctx.session.supportUserMessage || '(not provided)';
  const aiResp  = ctx.session.supportAiResponse;
  const sentiment = ctx.session.supportSentiment || 'neutral';

  await escalateToHuman(ctx, topic, message, aiResp, sentiment);
});

// ── Action: cancel ────────────────────────────────────────────────────────────
supportScene.action('sup_cancel', async (ctx) => {
  await ctx.answerCbQuery('Cancelled');
  await ctx.editMessageText('❌ Support session cancelled. Use /support anytime.');
  ctx.session.supportTopic = null;
  return ctx.scene.leave();
});

// ── Escalation handler ────────────────────────────────────────────────────────
async function escalateToHuman(ctx, topic, userMessage, aiResponse, sentiment) {
  const user = await User.findByTelegramId(ctx.from.id);
  if (!user) { await ctx.reply('❌ Session error. Please try /support again.'); return ctx.scene.leave(); }

  const topicMeta = TOPIC_META[topic] || TOPIC_META.general;
  let priority = topicMeta.priority;
  if (['angry', 'frustrated'].includes(sentiment) && priority !== 'Urgent') priority = 'High';
  if (topic === 'bug') priority = 'Urgent';

  const ticketId = await SupportTicket.generateId();

  const ticket = await SupportTicket.create({
    ticketId,
    userId: user._id,
    telegramId: ctx.from.id,
    username: ctx.from.username || null,
    topic,
    userMessage,
    aiResponse,
    status: 'Open',
    priority,
    replies: [],
  });

  await notifyAdminNewTicket(ctx, ticket, user);

  ctx.session.supportTopic = null;
  ctx.session.supportUserMessage = null;
  ctx.session.supportAiResponse = null;
  ctx.session.supportSentiment = null;

  const priorityBadge = { Normal: '🟡', High: '🟠', Urgent: '🔴' }[priority] || '🟡';

  await ctx.reply(
    `✅ *Support Ticket Created!*\n\n` +
    `🎫 Ticket ID: \`${ticketId}\`\n` +
    `${topicMeta.emoji} Topic: *${topicMeta.label}*\n` +
    `${priorityBadge} Priority: *${priority}*\n\n` +
    `Our team will get back to you shortly.\n` +
    `⏰ *Support hours: 9AM – 11PM MMT*\n\n` +
    `_Save your Ticket ID to follow up._`,
    { parse_mode: 'Markdown' }
  );

  return ctx.scene.leave();
}

module.exports = supportScene;
