const User = require('../models/User');
const { config } = require('../../config/settings');
const { t } = require('../utils/i18n');
const { langKeyboard, showUserMain, showAdminMain } = require('../utils/replyMenus');
const { registerReferral } = require('../services/ReferralService');
const SystemStatus = require('../models/SystemStatus');

async function setJoinSourceOnce(telegramId, source, ref) {
  await User.updateOne(
    { telegramId: Number(telegramId), joinSource: 'unknown' },
    { $set: { joinSource: source, joinRef: ref || null } }
  ).catch(() => {});
}

async function handleStart(ctx) {
  const payload = ctx.startPayload;
  const isAdmin = Number(ctx.from.id) === Number(config.bot.adminId);

  let user = await User.findOrCreate(ctx.from.id, ctx.from.username, ctx.from.first_name);
  if (!user) return ctx.reply('❌ Could not load your account. Please try again.');
  ctx.user = user;

  // Attribution only; never navigate to old inline folders.
  if (payload?.startsWith('ref_')) {
    const refCode = payload.slice(4);
    await setJoinSourceOnce(ctx.from.id, 'referral', refCode);
    try {
      const status = await SystemStatus.get();
      if (status.referralEnabled) await registerReferral(user._id, refCode, ctx.telegram);
    } catch (_) {}
  } else if (payload?.startsWith('channel_')) {
    await setJoinSourceOnce(ctx.from.id, 'channel', payload.slice(8));
  } else if (payload?.startsWith('product_')) {
    await setJoinSourceOnce(ctx.from.id, 'share', payload.slice(8));
  } else {
    await setJoinSourceOnce(ctx.from.id, 'direct', null);
  }

  // First user start: language first. Admin always opens admin panel.
  if (!isAdmin && !user.languageSelected) {
    return ctx.reply(
      `🌐 *Language / ဘာသာစကား*\n\n${t(ctx, 'first_lang')}\n\nReply keyboard ကနေရွေးပါ။`,
      { parse_mode: 'Markdown', ...langKeyboard() }
    );
  }

  if (isAdmin) return showAdminMain(ctx);
  return showUserMain(ctx);
}

module.exports = function registerStart(bot) {
  bot.start(handleStart);

  bot.command('menu', handleStart);
  bot.hears(['🏠 Main Menu', '🔙 Back to Main', '🔙 နောက်သို့', 'Main Menu'], handleStart);

  bot.hears(['🇲🇲 Myanmar', '🇬🇧 English'], async (ctx) => {
    const lang = ctx.message.text.includes('Myanmar') ? 'mm' : 'en';
    const user = await User.findOrCreate(ctx.from.id, ctx.from.username, ctx.from.first_name);
    if (!user) return ctx.reply('❌ Could not load your account. Please try again.');
    user.language = lang;
    user.languageSelected = true;
    await user.save();
    ctx.user = user;
    await ctx.reply(lang === 'mm' ? '✅ ဘာသာစကားရွေးပြီးပါပြီ။' : '✅ Language selected.');
    return showUserMain(ctx, lang === 'mm'
      ? '🎮 Mental Gaming Store မှ ကြိုဆိုပါတယ်။ Game top-up, gift card, wallet top-up, daily reward, spin reward, support ticket နဲ့ order tracking တွေကို bot တစ်ခုတည်းမှာ အသုံးပြုနိုင်ပါတယ်။'
      : '🎮 Welcome to Mental Gaming Store! Game top-ups, gift cards, wallet top-ups, daily rewards, spin rewards, support tickets and order tracking are available in one bot.');
  });
};
