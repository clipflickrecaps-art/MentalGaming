/**
 * PromoService — Fullfix10
 * Flexible coupon validation with product/folder/category/payment/tier restrictions.
 */

const Promo = require('../models/Promo');
const User = require('../models/User');
const Product = require('../models/Product');
const { auditLog } = require('./logger');

const BUNDLE_DISCOUNT_PCT = 5;

function normalizeCode(code) { return String(code || '').toUpperCase().trim(); }
function asList(v) { return Array.isArray(v) ? v.filter(Boolean) : []; }
function lowerList(v) { return asList(v).map(x => String(x).toLowerCase()); }

async function getProductContext(orderContext = {}) {
  if (orderContext.product && typeof orderContext.product === 'object') return orderContext.product;
  if (orderContext.productId) {
    const p = await Product.findById(orderContext.productId).lean();
    if (p) return p;
  }
  if (orderContext.productCode) {
    const p = await Product.findOne({ productCode: orderContext.productCode }).lean();
    if (p) return p;
  }
  return {
    productCode: orderContext.productCode || null,
    mainFolder: orderContext.mainFolder || null,
    category: orderContext.category || null,
  };
}

async function validatePromo(code, telegramId, orderAmount, orderContext = {}) {
  const promo = await Promo.findOne({ code: normalizeCode(code) });
  if (!promo) return { valid: false, error: 'Invalid promo code.' };
  if (!promo.isValid()) return { valid: false, error: 'This promo code has expired or is no longer active.' };

  const user = await User.findByTelegramId(telegramId);
  if (!user) return { valid: false, error: 'User not found.' };

  if (promo.hasUserUsed(user._id)) {
    return { valid: false, error: 'You have already used this promo code.' };
  }

  if (orderAmount < (promo.minOrderAmount || 0)) {
    return { valid: false, error: `Minimum order amount for this promo is ${(promo.minOrderAmount || 0).toLocaleString()} KS.` };
  }

  if (promo.newUserOnly && (user.totalDeposited || 0) > 0) {
    return { valid: false, error: 'This coupon is for new users only.' };
  }

  if (asList(promo.allowedTiers).length && !lowerList(promo.allowedTiers).includes(String(user.membershipTier || '').toLowerCase())) {
    return { valid: false, error: `This coupon is only for: ${promo.allowedTiers.join(', ')}.` };
  }

  const product = await getProductContext(orderContext);
  const codeAllowed = lowerList(promo.applicableProductCodes);
  if (codeAllowed.length && !codeAllowed.includes(String(product.productCode || '').toLowerCase())) {
    return { valid: false, error: 'This coupon cannot be used for this product.' };
  }

  const idAllowed = asList(promo.applicableProductIds).map(x => x.toString());
  if (idAllowed.length && !idAllowed.includes(String(product._id || orderContext.productId || ''))) {
    return { valid: false, error: 'This coupon cannot be used for this product.' };
  }

  const folderAllowed = lowerList(promo.applicableFolders);
  if (folderAllowed.length && !folderAllowed.includes(String(product.mainFolder || '').toLowerCase())) {
    return { valid: false, error: 'This coupon cannot be used in this folder.' };
  }

  const categoryAllowed = lowerList(promo.applicableCategories);
  if (categoryAllowed.length && !categoryAllowed.includes(String(product.category || '').toLowerCase())) {
    return { valid: false, error: 'This coupon cannot be used in this category.' };
  }

  const paymentAllowed = lowerList(promo.paymentMethods);
  if (paymentAllowed.length && orderContext.paymentMethod && !paymentAllowed.includes(String(orderContext.paymentMethod).toLowerCase())) {
    return { valid: false, error: 'This coupon cannot be used with this payment method.' };
  }

  const discount = calcDiscount(promo, orderAmount);
  return { valid: true, promo, discount };
}

function calcDiscount(promo, orderAmount) {
  let amount = 0;
  if (promo.discountType === 'Flat') amount = Math.min(promo.value, orderAmount);
  else amount = Math.floor((promo.value / 100) * orderAmount);
  if (promo.maxDiscountAmount !== null && promo.maxDiscountAmount !== undefined) {
    amount = Math.min(amount, promo.maxDiscountAmount);
  }
  return Math.max(0, amount);
}

async function applyPromo(code, telegramId) {
  const promo = await Promo.findOne({ code: normalizeCode(code) });
  if (!promo) throw new Error('Promo not found');
  const user = await User.findByTelegramId(telegramId);
  if (!user) throw new Error('User not found');
  promo.usedBy.push({ userId: user._id });
  promo.currentUses += 1;
  await promo.save();
  await auditLog(user.telegramId, 'PROMO_USED', promo._id.toString(), 'Promo', { code: promo.code });
  return promo;
}

async function getBundleDiscount(productIds) {
  if (!productIds || productIds.length < 2) return 0;
  const products = await Product.find({ _id: { $in: productIds }, bundleGroup: { $ne: null } });
  const groups = {};
  for (const p of products) groups[p.bundleGroup] = (groups[p.bundleGroup] || 0) + 1;
  return Object.values(groups).some((count) => count >= 2) ? BUNDLE_DISCOUNT_PCT : 0;
}

async function createPromo(adminId, data) {
  const promo = await Promo.create({
    code: normalizeCode(data.code),
    discountType: data.discountType,
    value: data.value,
    maxUses: data.maxUses || null,
    expiryDate: data.expiryDate || null,
    minOrderAmount: data.minOrderAmount || 0,
    maxDiscountAmount: data.maxDiscountAmount ?? null,
    perUserLimit: data.perUserLimit || 1,
    applicableProductCodes: data.applicableProductCodes || [],
    applicableProductIds: data.applicableProductIds || [],
    applicableFolders: data.applicableFolders || [],
    applicableCategories: data.applicableCategories || [],
    paymentMethods: data.paymentMethods || [],
    newUserOnly: !!data.newUserOnly,
    allowedTiers: data.allowedTiers || [],
    stackable: !!data.stackable,
    source: data.source || 'manual',
    createdBy: adminId,
    description: data.description || '',
  });
  await auditLog(adminId, 'CREATE_PROMO', promo._id.toString(), 'Promo', { code: promo.code });
  return promo;
}

async function listPromos({ activeOnly = true } = {}) {
  return Promo.find(activeOnly ? { isActive: true } : {}).sort({ createdAt: -1 });
}

async function deactivatePromo(code, adminId) {
  const promo = await Promo.findOneAndUpdate({ code: normalizeCode(code) }, { isActive: false }, { new: true });
  if (!promo) throw new Error('Promo not found');
  await auditLog(adminId, 'DEACTIVATE_PROMO', promo._id.toString(), 'Promo', { code: promo.code });
  return promo;
}

module.exports = { validatePromo, calcDiscount, applyPromo, getBundleDiscount, createPromo, listPromos, deactivatePromo, BUNDLE_DISCOUNT_PCT };
