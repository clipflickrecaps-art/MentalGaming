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
    },
    region: {
      type: String,
      required: true,
      trim: true,
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
      comment: 'Cost in baseCurrency (e.g. 4.99 BRL)',
    },
    quantity: {
      type: Number,
      default: 1,
      comment: 'Item quantity (e.g. 86 Diamonds, 1000 Credits)',
    },

    profitMode: {
      type: String,
      enum: ['percentage', 'fixedUnit'],
      default: 'percentage',
      comment: 'How profit is calculated for this product',
    },
    profitMargin: {
      type: Number,
      default: 10,
      min: 0,
      comment: 'Used when profitMode=percentage. e.g. 10 = 10%',
    },
    baseUnit: {
      type: Number,
      default: null,
      comment: 'Used when profitMode=fixedUnit. Reference quantity (e.g. 86 Diamonds)',
    },
    baseProfitKS: {
      type: Number,
      default: null,
      comment: 'Used when profitMode=fixedUnit. Profit in KS for baseUnit (e.g. 500 KS)',
    },

    suggestedPrice: {
      type: Number,
      default: null,
      comment: 'Auto-calculated price pending admin approval',
    },
    finalPrice: {
      type: Number,
      required: true,
      min: 0,
      comment: 'Live price in MMK (KS) — only updated on admin approval',
    },

    stockCount: {
      type: Number,
      default: -1,
      comment: '-1 means unlimited',
    },
    pricingMode: {
      type: String,
      enum: ['Auto', 'Manual'],
      default: 'Auto',
      comment: 'Auto = calculator driven | Manual = admin hardcoded price',
    },
    isApiEnabled: {
      type: Boolean,
      default: false,
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
productSchema.index({ baseCurrency: 1, pricingMode: 1 });

productSchema.methods.isInStock = function () {
  return this.stockCount === -1 || this.stockCount > 0;
};

module.exports = mongoose.model('Product', productSchema);
