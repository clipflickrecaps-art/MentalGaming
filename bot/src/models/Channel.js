const mongoose = require('mongoose');

const channelSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    channelId: { type: String, required: true, trim: true },
    link: { type: String, default: null, trim: true },
    type: { type: String, enum: ['announcement', 'review', 'promotion', 'promo', 'support', 'backup', 'other'], default: 'other' },
    showToUser: { type: Boolean, default: true },

    // Fullfix10 flexible join reward system.
    // none | coin | wallet | product | coupon
    rewardType: { type: String, enum: ['none', 'coin', 'wallet', 'product', 'coupon'], default: 'none' },
    rewardValue: { type: Number, default: 0, min: 0 },
    rewardProductCode: { type: String, default: null, trim: true },
    rewardCouponCode: { type: String, default: null, trim: true, uppercase: true },
    rewardMeta: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Legacy field kept for backward compatibility with fullfix9 data.
    joinRewardCoins: { type: Number, default: 0, min: 0 },

    autoPostEnabled: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    displayOrder: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
);

channelSchema.index({ channelId: 1 }, { unique: true });
channelSchema.statics.visible = function () {
  return this.find({ isActive: true, showToUser: true }).sort({ displayOrder: 1, name: 1 });
};

channelSchema.methods.rewardLabel = function () {
  const type = this.rewardType || (this.joinRewardCoins > 0 ? 'coin' : 'none');
  if (type === 'coin') return `🎁 ${this.rewardValue || this.joinRewardCoins || 0} MC`;
  if (type === 'wallet') return `🎁 ${this.rewardValue || 0} KS`;
  if (type === 'product') return `🎁 Product: ${this.rewardProductCode || 'not set'}`;
  if (type === 'coupon') return `🎁 Coupon: ${this.rewardCouponCode || 'auto coupon'}`;
  return '🎁 No reward';
};

module.exports = mongoose.model('Channel', channelSchema);
