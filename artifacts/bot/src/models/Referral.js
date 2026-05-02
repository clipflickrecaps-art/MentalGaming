const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema(
  {
    referrerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    refereeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
      comment: 'Each user can only be referred once',
    },
    referralCode: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['Pending', 'Completed'],
      default: 'Pending',
      comment: 'Pending = joined but not topped up yet | Completed = bonus paid',
    },
    bonusPaid: {
      type: Boolean,
      default: false,
    },
    referrerBonus: {
      ks:    { type: Number, default: 0 },
      coins: { type: Number, default: 0 },
    },
    refereeBonus: {
      ks:    { type: Number, default: 0 },
      coins: { type: Number, default: 0 },
    },
    completedAt: {
      type: Date,
      default: null,
    },
    topupAmount: {
      type: Number,
      default: null,
      comment: 'First top-up amount that triggered the bonus',
    },
  },
  { timestamps: true, versionKey: false }
);

referralSchema.index({ referrerId: 1, status: 1 });
referralSchema.index({ referralCode: 1 });

module.exports = mongoose.model('Referral', referralSchema);
