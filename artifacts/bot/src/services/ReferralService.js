/**
 * ReferralService
 *
 * Referral lifecycle:
 *   1. User A shares their referral link (deep link with ref code)
 *   2. User B clicks link → /start ref_CODE → registerReferral() called
 *   3. User B makes their FIRST top-up → processFirstTopup() called after approval
 *   4. Both users receive bonuses:
 *      Referrer: 500 KS + 100 Mental Coins
 *      Referee:  200 KS bonus on top of their deposit
 *
 * Limits:
 *   - Each user can only be referred once
 *   - Referrer earns unlimited referrals
 *   - No self-referral
 */

const Referral  = require('../models/Referral');
const User      = require('../models/User');
const { creditKS, creditCoin } = require('./WalletService');
const { auditLog } = require('./logger');
const { config } = require('../../config/settings');

// ── Reward config ─────────────────────────────────────────────────────────────
const REFERRER_BONUS_KS    = 500;
const REFERRER_BONUS_COINS = 100;
const REFEREE_BONUS_KS     = 200;
const REFEREE_BONUS_COINS  = 50;

// ── Code generation ───────────────────────────────────────────────────────────
function buildCode(telegramId) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  // Deterministic prefix from telegramId + random suffix
  const suffix = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const prefix = String(telegramId).slice(-3);
  return `${prefix}${suffix}`;
}

async function getOrCreateCode(telegramId) {
  const user = await User.findByTelegramId(telegramId);
  if (!user) throw new Error('User not found');

  if (user.referralCode) return user.referralCode;

  // Generate unique code
  let code;
  let attempts = 0;
  do {
    code = buildCode(telegramId);
    attempts++;
    if (attempts > 20) throw new Error('Could not generate unique referral code');
  } while (await User.findOne({ referralCode: code }));

  user.referralCode = code;
  await user.save();
  return code;
}

function getReferralLink(code) {
  const botUsername = 'mentalgamingstorebot';
  return `https://t.me/${botUsername}?start=ref_${code}`;
}

// ── Register referral (called from /start deep link) ─────────────────────────
async function registerReferral(newUserId, refCode) {
  const referee = await User.findById(newUserId);
  if (!referee) return null;

  // Check if referee was already referred
  const alreadyReferred = await Referral.findOne({ refereeId: newUserId });
  if (alreadyReferred) return null;

  // Find referrer by code
  const referrer = await User.findOne({ referralCode: refCode });
  if (!referrer) return null;

  // No self-referral
  if (referrer._id.toString() === newUserId.toString()) return null;

  const referral = await Referral.create({
    referrerId:   referrer._id,
    refereeId:    newUserId,
    referralCode: refCode,
    status:       'Pending',
  });

  await auditLog(referee.telegramId, 'REFERRAL_REGISTERED', referral._id.toString(), 'Referral', {
    referrerId: referrer.telegramId,
    code: refCode,
  });

  return { referral, referrer };
}

// ── Process first top-up bonus (called after approveTopup) ───────────────────
async function processFirstTopup(userId, topupAmount, telegram) {
  // Find pending referral for this user
  const referral = await Referral.findOne({ refereeId: userId, status: 'Pending', bonusPaid: false });
  if (!referral) return null;

  const referee  = await User.findById(userId);
  const referrer = await User.findById(referral.referrerId);
  if (!referee || !referrer) return null;

  // Check this is their first completed topup
  const Transaction = require('../models/Transaction');
  const pastTopups = await Transaction.countDocuments({
    userId,
    type: 'Topup',
    status: 'Completed',
  });
  if (pastTopups > 1) return null; // Already had a previous top-up

  // Mark bonus as paid
  referral.status       = 'Completed';
  referral.bonusPaid    = true;
  referral.completedAt  = new Date();
  referral.topupAmount  = topupAmount;
  referral.referrerBonus = { ks: REFERRER_BONUS_KS, coins: REFERRER_BONUS_COINS };
  referral.refereeBonus  = { ks: REFEREE_BONUS_KS,  coins: REFEREE_BONUS_COINS };
  await referral.save();

  // Credit referrer
  await creditKS(referrer._id, REFERRER_BONUS_KS, {
    type: 'Bonus',
    note: `Referral bonus — @${referee.username || referee.telegramId} joined & topped up`,
  });
  await creditCoin(referrer._id, REFERRER_BONUS_COINS, {
    type: 'Bonus',
    note: `Referral coin bonus`,
  });

  // Credit referee
  await creditKS(referee._id, REFEREE_BONUS_KS, {
    type: 'Bonus',
    note: `Welcome bonus from referral`,
  });
  await creditCoin(referee._id, REFEREE_BONUS_COINS, {
    type: 'Bonus',
    note: `Welcome coin bonus from referral`,
  });

  await auditLog(referee.telegramId, 'REFERRAL_COMPLETED', referral._id.toString(), 'Referral', {
    referrerId: referrer.telegramId,
    bonusKS: REFERRER_BONUS_KS,
  });

  // Notify both users
  if (telegram) {
    const refereeTag = referee.username ? `@${referee.username}` : `user ${referee.telegramId}`;
    const referrerTag = referrer.username ? `@${referrer.username}` : 'your friend';

    try {
      await telegram.sendMessage(
        referrer.telegramId,
        `🎉 *Referral Bonus Unlocked!*\n\n` +
        `${refereeTag} just made their first top-up!\n\n` +
        `💰 You received: *+${REFERRER_BONUS_KS.toLocaleString()} KS*\n` +
        `🪙 Bonus coins: *+${REFERRER_BONUS_COINS} Mental Coins*\n\n` +
        `_Keep sharing your link to earn more! /referral_`,
        { parse_mode: 'Markdown' }
      );
    } catch {}

    try {
      await telegram.sendMessage(
        referee.telegramId,
        `🎁 *Welcome Bonus!*\n\n` +
        `You were referred by ${referrerTag}.\n\n` +
        `💰 Bonus: *+${REFEREE_BONUS_KS.toLocaleString()} KS* added to your wallet!\n` +
        `🪙 *+${REFEREE_BONUS_COINS} Mental Coins* added!\n\n` +
        `_Enjoy shopping at Mental Gaming Store! 🎮_`,
        { parse_mode: 'Markdown' }
      );
    } catch {}
  }

  return { referral, referrerBonus: REFERRER_BONUS_KS, refereeBonus: REFEREE_BONUS_KS };
}

// ── Get referral stats for a user ─────────────────────────────────────────────
async function getStats(telegramId) {
  const user = await User.findByTelegramId(telegramId);
  if (!user) throw new Error('User not found');

  const code = user.referralCode || await getOrCreateCode(telegramId);

  const [total, completed, pending] = await Promise.all([
    Referral.countDocuments({ referrerId: user._id }),
    Referral.countDocuments({ referrerId: user._id, status: 'Completed' }),
    Referral.countDocuments({ referrerId: user._id, status: 'Pending' }),
  ]);

  const totalKSEarned = completed * REFERRER_BONUS_KS;
  const totalCoinsEarned = completed * REFERRER_BONUS_COINS;

  const recentReferrals = await Referral.find({ referrerId: user._id })
    .populate('refereeId', 'username telegramId')
    .sort({ createdAt: -1 })
    .limit(5);

  return {
    code,
    link: getReferralLink(code),
    total,
    completed,
    pending,
    totalKSEarned,
    totalCoinsEarned,
    recentReferrals,
    bonuses: {
      referrer: { ks: REFERRER_BONUS_KS, coins: REFERRER_BONUS_COINS },
      referee:  { ks: REFEREE_BONUS_KS,  coins: REFEREE_BONUS_COINS },
    },
  };
}

// ── Admin: list top referrers ─────────────────────────────────────────────────
async function getLeaderboard(limit = 10) {
  const results = await Referral.aggregate([
    { $match: { status: 'Completed' } },
    { $group: { _id: '$referrerId', count: { $sum: 1 }, totalKS: { $sum: REFERRER_BONUS_KS } } },
    { $sort: { count: -1 } },
    { $limit: limit },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $project: { count: 1, totalKS: 1, 'user.username': 1, 'user.telegramId': 1, 'user.membershipTier': 1 } },
  ]);
  return results;
}

module.exports = {
  getOrCreateCode,
  getReferralLink,
  registerReferral,
  processFirstTopup,
  getStats,
  getLeaderboard,
  REFERRER_BONUS_KS,
  REFERRER_BONUS_COINS,
  REFEREE_BONUS_KS,
  REFEREE_BONUS_COINS,
};
