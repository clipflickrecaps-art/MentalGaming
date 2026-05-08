const mongoose = require('mongoose');

const channelRewardClaimSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true, index: true },
    telegramChannelId: { type: String, required: true },
    rewardType: { type: String, enum: ['none', 'coin', 'wallet', 'product', 'coupon'], default: 'none' },
    rewardValue: { type: Number, default: 0 },
    rewardProductCode: { type: String, default: null },
    rewardCouponCode: { type: String, default: null },
    rewardCoins: { type: Number, default: 0 }, // legacy
    claimedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

channelRewardClaimSchema.index({ userId: 1, channelId: 1 }, { unique: true });
module.exports = mongoose.model('ChannelRewardClaim', channelRewardClaimSchema);
