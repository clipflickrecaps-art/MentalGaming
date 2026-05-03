/**
 * ReferralService — Commission-based 1-level referral system.
 *
 * Commission lifecycle:
 *   1. User A shares their referral link (deep link with ref code)
 *   2. User B clicks link → /start ref_CODE → registerReferral() called
 *      → FraudDetector runs; HIGH/MEDIUM flags freeze the referral
 *   3. Admin approves User B's top-up → processTopupCommission() called
 *      → If mode='first': pays once then status→Completed
 *      → If mode='every': pays on every approved top-up
 *   4. Commission = Math.floor(topupAmount × commissionRate / 100)
 *      awarded to referrer (KS / Coin / Both, per config)
 *   5. Referee gets welcome bonus on their FIRST top-up only
 *
 * All rates are read live from SystemStatus (hot-changeable by admin).
 */

const Referral          = require('../models/Referral');
const User              = require('../models/User');
const SystemStatus      = require('../models/SystemStatus');
const { creditKS, creditCoin } = require('./WalletService');
const { auditLog }      = require('./logger');
const { checkReferralFraud, checkTopupFraud } = require('./FraudDetector');

// ── Code generation ───────────────────────────────────────────────────────────

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function buildCode(telegramId) {
  const suffix = Array.from({ length: 4 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
  const prefix = String(telegramId).slice(-3);
  return `${prefix}${suffix}`;
}

async function getOrCreateCode(telegramId) {
  const user = await User.findByTelegramId(telegramId);
  if (!user) throw new Error('User not found');
  if (user.referralCode) return user.referralCode;

  let code;
  let attempts = 0;
  do {
    code = buildCode(telegramId);
    if (++attempts > 20) throw new Error('Could not generate unique referral code');
  } while (await User.findOne({ referralCode: code }));

  user.referralCode = code;
  await user.save();
  return code;
}

function getReferralLink(code) {
  return `https://t.me/mentalgamingstorebot?start=ref_${code}`;
}

// ── Masked username helper ────────────────────────────────────────────────────

function maskName(username, firstName) {
  const name = username || firstName || 'User';
  if (name.length <= 2) return name + '***';
  return name.slice(0, 2) + '*'.repeat(Math.min(3, name.length - 2));
}

// ── Register referral (called from /start deep link) ─────────────────────────

async function registerReferral(newUserId, refCode, telegram = null) {
  const referee = await User.findById(newUserId);
  if (!referee) return null;

  // Already referred?
  const existing = await Referral.findOne({ refereeId: newUserId });
  if (existing) return null;

  // Find referrer by code
  const referrer = await User.findOne({ referralCode: refCode });
  if (!referrer) return null;

  // No self-referral
  if (referrer._id.toString() === newUserId.toString()) return null;

  // Read live commission config
  const status = await SystemStatus.get();
  if (!status.referralEnabled) return null;

  const referral = await Referral.create({
    referrerId:     referrer._id,
    refereeId:      newUserId,
    referralCode:   refCode,
    status:         'Pending',
    commissionMode: status.referralCommissionMode || 'first',
    commissionRate: status.referralCommissionRate || 2,
  });

  // ── Run fraud detection ────────────────────────────────────────────────────
  const { shouldBlock, flags } = await checkReferralFraud({
    newUserId,
    referrerId: referrer._id,
    refCode,
    telegram,
    referral,
  });

  if (shouldBlock) {
    referral.status           = 'Frozen';
    referral.isFraudSuspected = true;
    referral.fraudReason      = flags.map((f) => f.type).join(', ');
    await referral.save();

    await auditLog(referee.telegramId, 'REFERRAL_FRAUD_FROZEN', referral._id.toString(), 'System', {
      referrerId: referrer.telegramId,
      flags: flags.map((f) => f.type),
    });

    return null; // silently deny — no bonus notice to suspicious user
  }

  await auditLog(referee.telegramId, 'REFERRAL_REGISTERED', referral._id.toString(), 'System', {
    referrerId: referrer.telegramId,
    code: refCode,
  });

  return { referral, referrer };
}

// ── Process top-up commission (replaces processFirstTopup) ────────────────────
//
// Called by topup.js after admin approves a top-up.
// Works for both 'first' and 'every' modes.

async function processTopupCommission(userId, topupAmount, telegram) {
  // Find active or pending referral where this user is the referee
  const referral = await Referral.findOne({
    refereeId: userId,
    status:    { $in: ['Pending', 'Active'] },
    isFraudSuspected: false,
  });
  if (!referral) return null;

  const referee  = await User.findById(userId);
  const referrer = await User.findById(referral.referrerId);
  if (!referee || !referrer) return null;

  const status = await SystemStatus.get();
  if (!status.referralEnabled) return null;

  // Minimum top-up threshold
  if (topupAmount < (status.referralMinTopup || 1000)) return null;

  // In 'first' mode: check if we've already paid a commission
  if (referral.commissionMode === 'first' && referral.bonusPaid) return null;

  // Rapid topup fraud check (LOW severity — logged but doesn't block)
  await checkTopupFraud(referral, telegram);

  // ── Calculate commission ─────────────────────────────────────────────────
  const rate           = referral.commissionRate || status.referralCommissionRate || 2;
  const commissionKS   = Math.floor(topupAmount * rate / 100);
  const commissionType = status.referralCommissionType || 'KS';

  // ── Award referrer commission ─────────────────────────────────────────────
  if (commissionKS > 0) {
    if (commissionType === 'KS' || commissionType === 'Both') {
      await creditKS(referrer._id, commissionKS, {
        type: 'Bonus',
        note: `Referral commission ${rate}% of ${topupAmount.toLocaleString()} KS — @${referee.username || referee.telegramId}`,
      });
    }
    if (commissionType === 'Coin' || commissionType === 'Both') {
      await creditCoin(referrer._id, commissionKS, {
        type: 'Bonus',
        note: `Referral coin commission`,
      });
    }
  }

  // ── Welcome bonus for referee (first top-up only) ─────────────────────────
  const isFirstTopup = !referral.bonusPaid;
  let welcomeKS    = 0;
  let welcomeCoins = 0;

  if (isFirstTopup) {
    welcomeKS    = status.referralWelcomeBonusKS    || 200;
    welcomeCoins = status.referralWelcomeBonusCoins || 50;

    if (welcomeKS > 0) {
      await creditKS(referee._id, welcomeKS, {
        type: 'Bonus',
        note: 'Welcome bonus — joined via referral',
      });
    }
    if (welcomeCoins > 0) {
      await creditCoin(referee._id, welcomeCoins, {
        type: 'Bonus',
        note: 'Welcome coin bonus — joined via referral',
      });
    }
  }

  // ── Update referral record ────────────────────────────────────────────────
  referral.totalCommissionKS    = (referral.totalCommissionKS    || 0) + commissionKS;
  referral.totalCommissionCoins = (referral.totalCommissionCoins || 0) + (commissionType === 'Coin' ? commissionKS : 0);
  referral.bonusPaid            = true;
  referral.completedAt          = referral.completedAt || new Date();
  referral.topupAmount          = referral.topupAmount  || topupAmount;

  if (referral.commissionMode === 'first') {
    referral.status = 'Completed';
  } else {
    referral.status = 'Active'; // keeps earning on future top-ups
  }

  referral.commissionHistory.push({
    topupAmount,
    commissionRate: rate,
    commissionKS,
    commissionCoins: commissionType === 'Coin' ? commissionKS : 0,
    paidAt: new Date(),
  });

  await referral.save();

  await auditLog(referee.telegramId, 'REFERRAL_COMMISSION_PAID', referral._id.toString(), 'System', {
    referrerId: referrer.telegramId,
    topupAmount,
    commissionKS,
    rate,
  });

  // ── Notify referrer ────────────────────────────────────────────────────────
  if (telegram) {
    const refereeTag = referee.username ? `@${referee.username}` : `your friend`;
    try {
      await telegram.sendMessage(
        referrer.telegramId,
        `🎉 *Referral Commission Earned!*\n\n` +
        `${refereeTag} just topped up!\n\n` +
        `💰 Commission (${rate}%): *+${commissionKS.toLocaleString()} ${commissionType === 'Coin' ? 'MC' : 'KS'}*\n` +
        (referral.commissionMode === 'every'
          ? `_You keep earning every time they top up. /referral_`
          : `_Share your link to earn more! /referral_`),
        { parse_mode: 'Markdown' }
      );
    } catch {}

    // Welcome message for referee on first top-up
    if (isFirstTopup && welcomeKS > 0) {
      const referrerTag = referrer.username ? `@${referrer.username}` : 'a friend';
      try {
        await telegram.sendMessage(
          referee.telegramId,
          `🎁 *Welcome Bonus Unlocked!*\n\n` +
          `You were referred by ${referrerTag}.\n\n` +
          `💰 *+${welcomeKS.toLocaleString()} KS* added to your wallet!\n` +
          `🪙 *+${welcomeCoins} Mental Coins* added!\n\n` +
          `_Enjoy shopping at Mental Gaming Store! 🎮_`,
          { parse_mode: 'Markdown' }
        );
      } catch {}
    }
  }

  return { referral, commissionKS, rate, isFirstTopup };
}

// ── Legacy alias kept so old callers don't break during transition ─────────────
const processFirstTopup = processTopupCommission;

// ── Get referral stats for a user ─────────────────────────────────────────────

async function getStats(telegramId) {
  const user = await User.findByTelegramId(telegramId);
  if (!user) throw new Error('User not found');

  const code = user.referralCode || await getOrCreateCode(telegramId);
  const status = await SystemStatus.get();

  const [total, completed, pending, active, frozen] = await Promise.all([
    Referral.countDocuments({ referrerId: user._id }),
    Referral.countDocuments({ referrerId: user._id, status: 'Completed' }),
    Referral.countDocuments({ referrerId: user._id, status: 'Pending' }),
    Referral.countDocuments({ referrerId: user._id, status: 'Active' }),
    Referral.countDocuments({ referrerId: user._id, isFraudSuspected: true }),
  ]);

  // Sum total commissions earned
  const agg = await Referral.aggregate([
    { $match: { referrerId: user._id, bonusPaid: true } },
    { $group: { _id: null, totalKS: { $sum: '$totalCommissionKS' }, totalCoins: { $sum: '$totalCommissionCoins' } } },
  ]);
  const earned = agg[0] || { totalKS: 0, totalCoins: 0 };

  // Recent referrals (masked)
  const recentReferrals = await Referral
    .find({ referrerId: user._id })
    .populate('refereeId', 'username first_name telegramId')
    .sort({ createdAt: -1 })
    .limit(8);

  return {
    code,
    link:        getReferralLink(code),
    total,
    completed,
    pending,
    active,
    frozen,
    totalKSEarned:    earned.totalKS,
    totalCoinsEarned: earned.totalCoins,
    commissionRate:   status.referralCommissionRate || 2,
    commissionMode:   status.referralCommissionMode || 'first',
    commissionType:   status.referralCommissionType || 'KS',
    referralEnabled:  status.referralEnabled,
    welcomeBonus: {
      ks:    status.referralWelcomeBonusKS    || 200,
      coins: status.referralWelcomeBonusCoins || 50,
    },
    recentReferrals: recentReferrals.map((r) => ({
      status:     r.status,
      earned:     r.totalCommissionKS,
      isFraud:    r.isFraudSuspected,
      maskedName: r.refereeId
        ? maskName(r.refereeId.username, r.refereeId.first_name)
        : 'Unknown',
      createdAt:  r.createdAt,
    })),
  };
}

// ── Get leaderboard (top referrers) ──────────────────────────────────────────

async function getLeaderboard(limit = 10) {
  return Referral.aggregate([
    { $match: { status: { $in: ['Completed', 'Active'] } } },
    {
      $group: {
        _id:      '$referrerId',
        count:    { $sum: 1 },
        totalKS:  { $sum: '$totalCommissionKS' },
      },
    },
    { $sort: { count: -1, totalKS: -1 } },
    { $limit: limit },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    {
      $project: {
        count: 1,
        totalKS: 1,
        'user.username':      1,
        'user.telegramId':    1,
        'user.membershipTier': 1,
      },
    },
  ]);
}

// ── Admin: manual commission adjustment ───────────────────────────────────────

/**
 * Manually credit or debit referral commission for a user.
 * @param {number}  adminTid   — admin telegram ID
 * @param {number}  userTid    — target user telegram ID
 * @param {number}  amount     — positive = credit, negative = debit (KS)
 * @param {string}  note       — reason
 */
async function adminAdjustCommission(adminTid, userTid, amount, note = '') {
  const user = await User.findByTelegramId(userTid);
  if (!user) throw new Error('User not found');

  if (amount > 0) {
    await creditKS(user._id, amount, { type: 'AdminCredit', note: note || 'Manual referral adjustment' });
  } else {
    // Debit requires importing debitKS — use AdminDebit type credit with negative amount
    const Transaction = require('../models/Transaction');
    const tx = await Transaction.create({
      userId:        user._id,
      type:          'AdminDebit',
      wallet:        'KS',
      amount:        amount,  // negative
      balanceBefore: user.balanceKS,
      balanceAfter:  Math.max(0, user.balanceKS + amount),
      note:          note || 'Manual referral debit',
    });
    user.balanceKS = Math.max(0, user.balanceKS + amount);
    await user.save();
  }

  await auditLog(adminTid, 'REFERRAL_MANUAL_ADJUST', userTid.toString(), 'System', { amount, note });
}

module.exports = {
  getOrCreateCode,
  getReferralLink,
  registerReferral,
  processTopupCommission,
  processFirstTopup,    // legacy alias
  getStats,
  getLeaderboard,
  adminAdjustCommission,
  maskName,
};
