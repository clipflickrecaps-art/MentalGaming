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
      comment: 'Amount paid in MMK (KS)',
    },
    status: {
      type: String,
      enum: ['Pending', 'Success', 'Cancelled', 'Refunded'],
      default: 'Pending',
      index: true,
    },
    transactionId: {
      type: String,
      default: null,
      comment: 'Payment gateway or manual transaction reference',
    },
    screenshotUrl: {
      type: String,
      default: null,
      comment: 'Payment proof screenshot URL (Telegram file_id or hosted URL)',
    },
    deliveredData: {
      type: String,
      default: null,
      comment: 'Game code, account credentials, or delivery info (encrypted recommended)',
    },
    notes: {
      type: String,
      default: '',
    },
    processedBy: {
      type: Number,
      default: null,
      comment: 'Admin Telegram ID who processed this order',
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

orderSchema.index({ userId: 1, status: 1 });
orderSchema.index({ timestamp: -1 });

orderSchema.statics.findByUser = function (userId, status = null) {
  const query = { userId };
  if (status) query.status = status;
  return this.find(query).populate('productId').sort({ timestamp: -1 });
};

module.exports = mongoose.model('Order', orderSchema);
