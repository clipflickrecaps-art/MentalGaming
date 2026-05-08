const { Markup } = require('telegraf');
const Channel = require('../models/Channel');
const ChannelRewardClaim = require('../models/ChannelRewardClaim');
const User = require('../models/User');
const Product = require('../models/Product');
const Promo = require('../models/Promo');
const { creditCoin, creditKS } = require('../services/WalletService');

const DEFAULT_CHANNELS = [
  { name: '⭐ Review Channel', channelId: '-1003857110880', type: 'review', showToUser: true, rewardType: 'none', displayOrder: 1 },
  { name: '📣 Announcement Channel', channelId: '-1003645289904', type: 'announcement', showToUser: true, rewardType: 'none', displayOrder: 2 },
  { name: '🎁 Promotion Channel', channelId: '-1000000000000', type: 'promotion', showToUser: false, rewardType: 'none', displayOrder: 3 },
];

function kb(rows) { return Markup.keyboard(rows).resize(); }
const CHANNEL_KB = [['✅ Check Channel Rewards'], ['🔙 Back to Main']];

async function seedDefaultChannels() {
  for (const ch of DEFAULT_CHANNELS) {
    await Channel.updateOne({ channelId: ch.channelId }, { $setOnInsert: ch }, { upsert: true });
  }
}

function rewardLabel(ch) {
  if (typeof ch.rewardLabel === 'function') return ch.rewardLabel();
  const type = ch.rewardType || (ch.joinRewardCoins > 0 ? 'coin' : 'none');
  if (type === 'coin') return `🎁 ${ch.rewardValue || ch.joinRewardCoins || 0} MC`;
  if (type === 'wallet') return `🎁 ${ch.rewardValue || 0} KS`;
  if (type === 'product') return `🎁 Product gift`;
  if (type === 'coupon') return `🎁 Coupon / discount`;
  return '🎁 No reward';
}
function channelFallbackLink(ch) {
  if (ch.link) return ch.link;
  // Telegram channel ID alone cannot produce a guaranteed public join link.
  // This t.me/c fallback opens some public/supergroup channels, but private channels still need an invite link set by admin.
  const id = String(ch.channelId || '').replace('-100', '');
  return id ? `https://t.me/c/${id}` : null;
}
function formatChannel(ch, idx) {
  const link = channelFallbackLink(ch);
  return `${idx + 1}. ${ch.name}\n   ${rewardLabel(ch)}${link ? `\n   🔗 ${link}` : '\n   🔗 Link not set yet'}`;
}

async function showChannels(ctx) {
  await seedDefaultChannels();
  const channels = await Channel.visible().lean();
  const lines = channels.length ? channels.map(formatChannel).join('\n\n') : 'No public channels are available right now.';
  return ctx.reply(
    `📢 *Mental Gaming Channels*\n\n${lines}\n\nReward ပါတဲ့ channel တွေ join ပြီး ✅ Check Channel Rewards နှိပ်ပါ။`,
    { parse_mode: 'Markdown', ...kb(CHANNEL_KB) }
  );
}

function code(prefix='MGS') { return `${prefix}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2,5).toUpperCase()}`; }

async function giveReward(ctx, user, ch) {
  const type = ch.rewardType || (ch.joinRewardCoins > 0 ? 'coin' : 'none');
  if (type === 'none') return { ok: true, text: `${ch.name}: joined ✅ (no reward configured)` };
  if (type === 'coin') {
    const amount = Number(ch.rewardValue || ch.joinRewardCoins || 0);
    if (amount > 0) await creditCoin(user._id, amount, { type: 'Bonus', note: `Channel join reward — ${ch.name}` });
    return { ok: true, text: `${ch.name}: +${amount} MC claimed 🎉`, claim: { rewardCoins: amount, rewardValue: amount } };
  }
  if (type === 'wallet') {
    const amount = Number(ch.rewardValue || 0);
    if (amount > 0) await creditKS(user._id, amount, { type: 'AdminCredit', note: `Channel join reward — ${ch.name}` });
    return { ok: true, text: `${ch.name}: +${amount} KS claimed 🎉`, claim: { rewardValue: amount } };
  }
  if (type === 'product') {
    const product = await Product.findOne({ productCode: ch.rewardProductCode, isActive: true }).lean();
    if (!product) return { ok: false, text: `${ch.name}: product reward is not configured correctly.` };
    const couponCode = code('GIFT');
    await Promo.create({
      code: couponCode,
      discountType: 'Flat',
      value: product.finalPrice || 0,
      maxUses: 1,
      perUserLimit: 1,
      applicableProductCodes: [product.productCode],
      expiryDate: new Date(Date.now() + 14 * 86400000),
      source: 'channel_product_reward',
      description: `Free product gift from ${ch.name}: ${product.name}`,
    });
    return { ok: true, text: `${ch.name}: Product gift coupon ${couponCode} 🎁\n   Product: ${product.name}`, claim: { rewardCouponCode: couponCode, rewardProductCode: product.productCode } };
  }
  if (type === 'coupon') {
    const couponCode = ch.rewardCouponCode || code('JOIN');
    if (!ch.rewardCouponCode) {
      const meta = ch.rewardMeta || {};
      await Promo.create({
        code: couponCode,
        discountType: meta.discountType || 'Percentage',
        value: Number(ch.rewardValue || meta.value || 5),
        maxUses: 1,
        perUserLimit: 1,
        expiryDate: new Date(Date.now() + Number(meta.validDays || 14) * 86400000),
        minOrderAmount: Number(meta.minOrderAmount || 0),
        maxDiscountAmount: meta.maxDiscountAmount ?? null,
        applicableProductCodes: meta.productCodes || [],
        applicableFolders: meta.folders || [],
        applicableCategories: meta.categories || [],
        paymentMethods: meta.paymentMethods || [],
        allowedTiers: meta.allowedTiers || [],
        newUserOnly: !!meta.newUserOnly,
        source: 'channel_join_reward',
        description: `Channel join discount from ${ch.name}`,
      });
    }
    return { ok: true, text: `${ch.name}: Coupon ${couponCode} claimed 🎟`, claim: { rewardCouponCode: couponCode } };
  }
  return { ok: false, text: `${ch.name}: unsupported reward type.` };
}

async function checkRewards(ctx) {
  await seedDefaultChannels();
  const user = await User.findOrCreate(ctx.from.id, ctx.from.username, ctx.from.first_name);
  if (!user) return ctx.reply('❌ Could not load your account. Please press /start again.', kb(CHANNEL_KB));

  const channels = await Channel.visible();
  if (!channels.length) return ctx.reply('📢 No visible channels right now.', kb(CHANNEL_KB));

  const results = [];
  for (const ch of channels) {
    const existing = await ChannelRewardClaim.findOne({ userId: user._id, channelId: ch._id });
    if (existing) { results.push(`• ${ch.name}: already claimed ✅`); continue; }
    try {
      const member = await ctx.telegram.getChatMember(ch.channelId, ctx.from.id);
      const ok = ['member', 'administrator', 'creator'].includes(member.status);
      if (!ok) { results.push(`• ${ch.name}: not joined yet`); continue; }
      const reward = await giveReward(ctx, user, ch);
      if (reward.ok) {
        await ChannelRewardClaim.create({
          userId: user._id,
          channelId: ch._id,
          telegramChannelId: ch.channelId,
          rewardType: ch.rewardType || 'none',
          rewardValue: reward.claim?.rewardValue || ch.rewardValue || 0,
          rewardProductCode: reward.claim?.rewardProductCode || ch.rewardProductCode || null,
          rewardCouponCode: reward.claim?.rewardCouponCode || ch.rewardCouponCode || null,
          rewardCoins: reward.claim?.rewardCoins || 0,
        });
      }
      results.push(`• ${reward.text}`);
    } catch (err) {
      results.push(`• ${ch.name}: cannot verify. Bot must be admin/member in this channel or channel ID/link needs checking.`);
    }
  }
  return ctx.reply(`✅ *Channel Reward Check*\n\n${results.join('\n')}`, { parse_mode: 'Markdown', ...kb(CHANNEL_KB) });
}

module.exports = function registerChannels(bot) {
  bot.command('channels', showChannels);
  bot.hears(['📢 Channels', '📢 Channel', 'Channels'], showChannels);
  bot.hears('✅ Check Channel Rewards', checkRewards);
};
