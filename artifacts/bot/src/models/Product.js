const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      comment: 'e.g. "Game Credits", "Gift Cards", "Top-Up"',
    },
    region: {
      type: String,
      required: true,
      trim: true,
      comment: 'e.g. "Global", "SEA", "Brazil", "Philippines"',
    },
    baseCurrency: {
      type: String,
      enum: ['BRL', 'PHP', 'USD', 'MMK'],
      required: true,
    },
    baseCost: {
      type: Number,
      required: true,
      min: 0,
    },
    profitMargin: {
      type: Number,
      default: 10,
      min: 0,
      comment: 'Percentage (%) profit margin',
    },
    finalPrice: {
      type: Number,
      required: true,
      min: 0,
      comment: 'Final price in MMK (KS)',
    },
    stockCount: {
      type: Number,
      default: -1,
      comment: '-1 means unlimited stock',
    },
    pricingMode: {
      type: String,
      enum: ['Auto', 'Manual'],
      default: 'Auto',
    },
    isApiEnabled: {
      type: Boolean,
      default: false,
      comment: 'Whether this product uses live API pricing',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    imageUrl: {
      type: String,
      default: null,
    },
    description: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ region: 1 });

productSchema.methods.isInStock = function () {
  return this.stockCount === -1 || this.stockCount > 0;
};

productSchema.methods.computeFinalPrice = function (exchangeRate) {
  if (this.pricingMode === 'Manual') return this.finalPrice;
  const converted = this.baseCost * exchangeRate;
  return Math.ceil(converted * (1 + this.profitMargin / 100));
};

module.exports = mongoose.model('Product', productSchema);
