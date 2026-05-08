const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
      comment: 'Final amount paid in KS (after promo)',
    },
    originalAmount: {
      type: Number,
      default: null,
      comment: 'Pre-discount amount',
    },
    promoCode: {
      type: String,
      default: null,
    },
    promoDiscount: {
      type: Number,
      default: 0,
      comment: 'KS discount applied from promo code',
    },
    tierDiscount: {
      type: Number,
      default: 0,
      comment: 'KS discount from membership tier (Gold 2%, Platinum 5%)',
    },
    tierDiscountPct: {
      type: Number,
      default: 0,
      comment: 'Tier discount percentage applied',
    },
    status: {
      type: String,
      enum: ['Pending', 'Processing', 'Success', 'Cancelled', 'Refunded'],
      default: 'Pending',
      index: true,
    },
    productType: {
      type: String,
      enum: ['DirectTopup', 'DigitalCode'],
      default: 'DirectTopup',
    },

    // ── Customer delivery info (for DirectTopup/manual products) ─────────
    gameId: { type: String, default: null },
    zoneId: { type: String, default: null },
    gameName: { type: String, default: null },
    requiredInfo: {
      type: [{
        key:   { type: String, trim: true },
        label: { type: String, trim: true },
        value: { type: String, trim: true },
      }],
      default: [],
    },

    transactionId: { type: String, default: null },
    deliveredData: { type: String, default: null },
    notes: { type: String, default: '' },
    cancelReason: { type: String, default: null },
    processedBy: { type: Number, default: null },
    refundTransactionId: { type: String, default: null },
    timestamp: { type: Date, default: Date.now },

    // ── Live Order Tracking ───────────────────────────────────────────────────
    trackingMsgId: {
      type:    Number,
      default: null,
      comment: 'Telegram message ID of the tracking card sent to user — used to chain reply threads',
    },
    statusHistory: {
      type: [{
        status:    { type: String },
        at:        { type: Date, default: Date.now },
        byAdminId: { type: Number, default: null },
        note:      { type: String, default: null },
      }],
      default: [],
      comment: 'Ordered list of status transitions — rendered as timeline in tracking messages',
    },
  },
  { timestamps: true, versionKey: false }
);

orderSchema.index({ userId: 1, status: 1 });
orderSchema.index({ timestamp: -1 });

orderSchema.statics.findByUser = function (userId, status = null) {
  const query = { userId };
  if (status) query.status = status;
  return this.find(query).populate('productId').sort({ timestamp: -1 });
};

module.exports = mongoose.model('Order', orderSchema);
