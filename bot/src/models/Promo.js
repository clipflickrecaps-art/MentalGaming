const mongoose = require('mongoose');

const promoSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    discountType: {
      type: String,
      enum: ['Flat', 'Percentage'],
      required: true,
      comment: 'Flat = fixed KS off | Percentage = % off',
    },
    value: {
      type: Number,
      required: true,
      min: 0,
      comment: 'Amount in KS (Flat) or percentage (Percentage)',
    },
    maxUses: {
      type: Number,
      default: null,
      comment: 'null = unlimited',
    },
    currentUses: {
      type: Number,
      default: 0,
    },
    expiryDate: {
      type: Date,
      default: null,
      comment: 'null = never expires',
    },
    minOrderAmount: {
      type: Number,
      default: 0,
      comment: 'Minimum order total to use this promo',
    },

    // Fullfix10 coupon restrictions
    applicableProductCodes: [{ type: String, trim: true }],
    applicableProductIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    applicableFolders: [{ type: String, trim: true }],
    applicableCategories: [{ type: String, trim: true }],
    paymentMethods: [{ type: String, trim: true }],
    maxDiscountAmount: { type: Number, default: null },
    perUserLimit: { type: Number, default: 1 },
    newUserOnly: { type: Boolean, default: false },
    allowedTiers: [{ type: String, trim: true }],
    stackable: { type: Boolean, default: false },
    source: { type: String, default: 'manual' },

    usedBy: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        usedAt: { type: Date, default: Date.now },
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: Number,
      default: null,
      comment: 'Admin Telegram ID',
    },
    description: {
      type: String,
      default: '',
    },
  },
  { timestamps: true, versionKey: false }
);

promoSchema.index({ isActive: 1, expiryDate: 1 });

promoSchema.methods.isValid = function () {
  if (!this.isActive) return false;
  if (this.expiryDate && new Date() > this.expiryDate) return false;
  if (this.maxUses !== null && this.currentUses >= this.maxUses) return false;
  return true;
};

promoSchema.methods.hasUserUsed = function (userId) {
  const used = this.usedBy.filter((u) => u.userId?.toString() === userId?.toString()).length;
  return used >= (this.perUserLimit || 1);
};

module.exports = mongoose.model('Promo', promoSchema);
