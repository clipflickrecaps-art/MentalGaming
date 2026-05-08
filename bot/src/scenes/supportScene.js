/** Fullfix10 SupportScene — reply keyboard only. */
const { Scenes, Markup } = require('telegraf');
const { answerSupportQuery, analyzeSentiment } = require('../services/aiService');
const { config } = require('../../config/settings');
const SupportTicket = require('../models/SupportTicket');
const User = require('../models/User');

const TOPIC_META = {
  order:   { label: '📦 Order Issue',      emoji: '📦', priority: 'High'   },
  payment: { label: '💳 Payment / Wallet', emoji: '💳', priority: 'High'   },
  game:    { label: '🎮 Game Help',        emoji: '🎮', priority: 'Normal' },
  bug:     { label: '🐛 Bug Report',       emoji: '🐛', priority: 'Urgent' },
  general: { label: '❓ General Query',    emoji: '❓', priority: 'Normal' },
};
const TOPIC_BUTTONS = {
  '📦 Order Issue': 'order', '💳 Payment / Wallet': 'payment', '🎮 Game Help': 'game', '🐛 Bug Report': 'bug', '❓ General Query': 'general'
};
function kb(rows) { return Markup.keyboard(rows).resize(); }
const MAIN_MENU = [['🛒 Shop','📦 My Orders'], ['💰 Wallet','👤 My Profile'], ['🎰 Spin Wheel','💬 Support'], ['⚙️ Settings']];
const TOPIC_KB = [['📦 Order Issue','💳 Payment / Wallet'], ['🎮 Game Help','🐛 Bug Report'], ['❓ General Query'], ['❌ Cancel']];
const AFTER_AI_KB = [['✅ Solved', '👨 Human Support'], ['🔙 Back to Main']];
const SCREENSHOT_KB = [['📎 Send Screenshot'], ['⏭ Skip Screenshot'], ['🔙 Back to Main']];

async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function showThinking(ctx){ const msg=await ctx.reply('🤖 AI is thinking...'); return {chatId:ctx.chat.id,messageId:msg.message_id}; }
function clear(ctx){ ctx.session.supportTopic=null; ctx.session.supportUserMessage=null; ctx.session.supportAiResponse=null; ctx.session.supportSentiment=null; ctx.session.supportShouldEscalate=null; }
async function backMain(ctx){ clear(ctx); await ctx.reply('🏠 Main Menu', kb(MAIN_MENU)); return ctx.scene.leave(); }

async function notifyAdminNewTicket(ctx, ticket, user) {
  const topicMeta = TOPIC_META[ticket.topic] || TOPIC_META.general;
  const userTag = user.username ? `@${user.username}` : `ID: ${ticket.telegramId}`;
  const text = `📩 New Support Ticket\n\n🎫 ${ticket.ticketId}\n${topicMeta.emoji} ${topicMeta.label}\n👤 ${userTag}\n⚠️ Priority: ${ticket.priority}\n\n${ticket.userMessage}\n\nAI: ${ticket.aiResponse ? ticket.aiResponse.slice(0,300) : '-'}`;
  try { await ctx.telegram.sendMessage(config.bot.adminId, text); } catch(e) { console.error('[SupportScene] Admin notify failed:', e.message); }
}

const supportScene = new Scenes.WizardScene('support_scene',
  async (ctx) => {
    await ctx.reply('💬 Customer Support\n\nAI assistant အရင်ဖြေပေးမယ်။ မဖြေရှင်းနိုင်ရင် human support ticket ဖွင့်ပေးမယ်။\n\nဘာကူညီရမလဲ?', kb(TOPIC_KB));
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = ctx.message?.text?.trim();
    if (!text) return;
    if (text === '❌ Cancel' || text === '🔙 Back to Main') return backMain(ctx);
    const topic = TOPIC_BUTTONS[text];
    if (!topic) return ctx.reply('အောက်က topic button တစ်ခုရွေးပါ။', kb(TOPIC_KB));
    ctx.session.supportTopic = topic;
    const hint = { order:'Order ID ပါရင်ထည့်ရေးပါ။', payment:'amount + payment method + date ထည့်ရေးပါ။', game:'game name နဲ့လိုတာရေးပါ။', bug:'ဖြစ်သွားတဲ့ step တွေရေးပါ။', general:'မေးချင်တာရေးပါ။' }[topic];
    await ctx.reply(`${TOPIC_META[topic].emoji} ${TOPIC_META[topic].label}\n\n${hint}\n\nမေးခွန်းရေးပါ။`, kb([['🔙 Back to Main']]));
    return ctx.wizard.next();
  },
  async (ctx) => {
    const message = ctx.message?.text?.trim();
    if (!message) return;
    if (message === '🔙 Back to Main') return backMain(ctx);
    const topic = ctx.session.supportTopic || 'general';
    ctx.session.supportUserMessage = message;
    const think = await showThinking(ctx);
    const [aiResult, sentiment] = await Promise.all([
      answerSupportQuery(message, { telegramId: ctx.from.id, topic }).catch(e=>({answer:null, shouldEscalate:true, error:e.message})),
      analyzeSentiment(message).catch(()=> 'neutral'),
    ]);
    ctx.session.supportAiResponse = aiResult.answer;
    ctx.session.supportSentiment = sentiment;
    if (!aiResult.answer || aiResult.shouldEscalate) {
      await ctx.telegram.deleteMessage(think.chatId, think.messageId).catch(()=>{});
      return askForScreenshot(ctx);
    }
    await ctx.telegram.deleteMessage(think.chatId, think.messageId).catch(()=>{});
    await ctx.reply(`🤖 AI Answer\n\n${aiResult.answer}\n\nဒီအဖြေက အဆင်ပြေလား?`, kb(AFTER_AI_KB));
    return ctx.wizard.next();
  },
  async (ctx) => {
    const text = ctx.message?.text?.trim();
    if (text === '✅ Solved') { clear(ctx); await ctx.reply('✅ အဆင်ပြေသွားလို့ ဝမ်းသာပါတယ်။', kb(MAIN_MENU)); return ctx.scene.leave(); }
    if (text === '👨 Human Support') return askForScreenshot(ctx);
    if (text === '🔙 Back to Main') return backMain(ctx);
    return ctx.reply('Button တစ်ခုရွေးပါ။', kb(AFTER_AI_KB));
  }
);

async function askForScreenshot(ctx) {
  ctx.session.pendingTicketData = {
    topic: ctx.session.supportTopic || 'general',
    userMessage: ctx.session.supportUserMessage || '(not provided)',
    aiResponse: ctx.session.supportAiResponse || null,
    sentiment: ctx.session.supportSentiment || 'neutral',
  };
  clear(ctx);
  await ctx.reply('📎 Screenshot ပို့ချင်ရင် photo အနေနဲ့ပို့ပါ။ မလိုရင် ⏭ Skip Screenshot နှိပ်ပါ။', kb(SCREENSHOT_KB));
  ctx.session.awaitingTicketScreenshot = true;
  return ctx.scene.leave();
}

async function createTicketFromSession(ctx, screenshots = []) {
  const data = ctx.session.pendingTicketData;
  if (!data) { await ctx.reply('❌ Session expired. Please use /support again.', kb(MAIN_MENU)); return; }
  ctx.session.pendingTicketData = null;
  ctx.session.awaitingTicketScreenshot = false;
  return escalateToHuman(ctx, data.topic, data.userMessage, data.aiResponse, data.sentiment, screenshots);
}

async function escalateToHuman(ctx, topic, userMessage, aiResponse, sentiment, screenshots = []) {
  const user = await User.findByTelegramId(ctx.from.id);
  if (!user) { await ctx.reply('❌ Session error. Please try /support again.', kb(MAIN_MENU)); return; }
  const topicMeta = TOPIC_META[topic] || TOPIC_META.general;
  let priority = topicMeta.priority;
  if (['angry','frustrated'].includes(sentiment) && priority !== 'Urgent') priority = 'High';
  if (topic === 'bug') priority = 'Urgent';
  const ticketId = await SupportTicket.generateId();
  const ticket = await SupportTicket.create({ ticketId, userId:user._id, telegramId:ctx.from.id, username:ctx.from.username||null, subject:userMessage.split(/[.!?\n]/)[0].slice(0,80)||null, topic, userMessage, aiResponse, screenshots, status:'Open', priority, replies:[] });
  await notifyAdminNewTicket(ctx, ticket, user);
  await ctx.reply(`✅ Support Ticket Created\n\n🎫 Ticket ID: ${ticketId}\n${topicMeta.emoji} Topic: ${topicMeta.label}\n⚠️ Priority: ${priority}\n\nSupport team ပြန်ဆက်သွယ်ပါမယ်။`, kb(MAIN_MENU));
}

supportScene.createTicketFromSession = createTicketFromSession;
module.exports = supportScene;
