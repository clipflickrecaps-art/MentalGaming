const mongoose = require('mongoose');

const channelAutoPostSchema = new mongoose.Schema(
  {
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true, index: true },
    postType: {
      type: String,
      enum: ['about_bot', 'how_to_buy', 'features', 'daily_promo', 'top_products', 'reviews', 'custom'],
      default: 'about_bot',
    },
    customText: { type: String, default: '' },
    hour: { type: Number, min: 0, max: 23, default: 9 },
    minute: { type: Number, min: 0, max: 59, default: 0 },
    frequency: { type: String, enum: ['daily', 'weekly'], default: 'daily' },
    isActive: { type: Boolean, default: true },
    lastPostedAt: { type: Date, default: null },
    createdBy: { type: Number, default: null },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model('ChannelAutoPost', channelAutoPostSchema);
