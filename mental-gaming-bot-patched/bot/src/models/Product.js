const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    productCode: { type: String, default: null, trim: true, index: true },
    mainFolder:  { type: String, default: 'General', trim: true, index: true },
    name:     { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    region:   { type: String, required: true, trim: true },

    productType: {
      type:    String,
      enum:    ['DirectTopup', 'DigitalCode'],
      default: 'DirectTopup',
      comment: 'DirectTopup = admin delivers manually | DigitalCode = code pulled from DB',
    },

    baseCurrency: { type: String, enum: ['BRL', 'PHP', 'USD', 'MMK'], required: true },
    baseCost:     { type: Number, required: true, min: 0 },
    quantity:     { type: Number, default: 1 },

    profitMode:    { type: String, enum: ['percentage', 'fixedUnit'], default: 'percentage' },
    profitMargin:  { type: Number, default: 10, min: 0 },
    baseUnit:      { type: Number, default: null },
    baseProfitKS:  { type: Number, default: null },

    suggestedPrice: { type: Number, default: null },
    finalPrice:     { type: Number, required: true, min: 0 },

    stockCount:            { type: Number, default: -1, comment: '-1 = unlimited' },
    stockWarningThreshold: { type: Number, default: 5 },

    pricingMode: { type: String, enum: ['Auto', 'Manual'], default: 'Auto' },
    isApiEnabled: { type: Boolean, default: false },
    isActive:     { type: Boolean, default: true },
    imageUrl:     { type: String, default: null },
    description:  { type: String, default: '' },

    // ── Required customer info for manual delivery ─────────────────────────
    // Admin can configure these per product. During checkout the bot asks the
    // user for every required field and stores the answers on the order.
    requiredFields: {
      type: [{
        key:      { type: String, required: true, trim: true },
        label:    { type: String, required: true, trim: true },
        required: { type: Boolean, default: true },
        hint:     { type: String, default: '' },
      }],
      default: [],
    },

    // ── Flash Sale ───────────────────────────────────────────────────────────
    flashSalePrice:    { type: Number,  default: null },
    flashSaleStart:    { type: Date,    default: null },
    flashSaleEnd:      { type: Date,    default: null },
    flashSaleNotified: { type: Boolean, default: false },

    // ── Bundle ───────────────────────────────────────────────────────────────
    bundleGroup: {
      type:    String,
      default: null,
      comment: 'Products sharing same bundleGroup get 5% off when 2+ are bought',
    },

    // ── External API / Auto-Delivery ─────────────────────────────────────────
    // deliveryMode: 'Manual' = staff fulfils manually  |  'Auto' = sent via provider API
    deliveryMode: {
      type:    String,
      enum:    ['Manual', 'Auto'],
      default: 'Manual',
      index:   true,
    },
    apiProvider: {
      type:    String,
      default: null,
      comment: 'Provider slug: smileone | unipin | codashop',
    },
    apiProductSku: {
      type:    String,
      default: null,
      comment: "Provider's internal product ID / SKU",
    },
  },
  { timestamps: true, versionKey: false }
);

productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ mainFolder: 1, category: 1, isActive: 1 });
productSchema.index({ productCode: 1 });
productSchema.index({ region: 1 });
productSchema.index({ baseCurrency: 1, pricingMode: 1 });
productSchema.index({ flashSaleEnd: 1 });

productSchema.methods.isInStock = function () {
  return this.stockCount === -1 || this.stockCount > 0;
};

productSchema.methods.isLowStock = function () {
  return this.stockCount !== -1 && this.stockCount > 0 && this.stockCount <= this.stockWarningThreshold;
};

productSchema.methods.getEffectivePrice = function () {
  const now = new Date();
  if (
    this.flashSalePrice &&
    this.flashSaleStart &&
    this.flashSaleEnd &&
    now >= this.flashSaleStart &&
    now <= this.flashSaleEnd
  ) {
    const msLeft = this.flashSaleEnd - now;
    return { price: this.flashSalePrice, isFlashSale: true, msLeft };
  }
  return { price: this.finalPrice, isFlashSale: false, msLeft: 0 };
};

module.exports = mongoose.model('Product', productSchema);
