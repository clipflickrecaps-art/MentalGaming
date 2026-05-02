const mongoose = require('mongoose');

const replySchema = new mongoose.Schema({
  from: { type: String, enum: ['admin', 'user'], required: true },
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
});

const supportTicketSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      required: true,
      unique: true,
      comment: 'Short readable ID e.g. TKT-A3B9',
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    telegramId: {
      type: Number,
      required: true,
      index: true,
    },
    username: {
      type: String,
      default: null,
    },
    topic: {
      type: String,
      enum: ['order', 'payment', 'game', 'bug', 'general'],
      required: true,
    },
    userMessage: {
      type: String,
      required: true,
    },
    aiResponse: {
      type: String,
      default: null,
      comment: 'The AI answer shown to user before escalation',
    },
    status: {
      type: String,
      enum: ['Open', 'InProgress', 'Resolved', 'Closed'],
      default: 'Open',
      index: true,
    },
    replies: [replySchema],
    resolvedBy: {
      type: Number,
      default: null,
      comment: 'Admin Telegram ID who resolved',
    },
    priority: {
      type: String,
      enum: ['Normal', 'High', 'Urgent'],
      default: 'Normal',
    },
  },
  { timestamps: true, versionKey: false }
);

supportTicketSchema.index({ status: 1, createdAt: -1 });

supportTicketSchema.statics.generateId = async function () {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  let attempts = 0;
  do {
    const rand = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    id = `TKT-${rand}`;
    attempts++;
    if (attempts > 20) throw new Error('Could not generate unique ticket ID');
  } while (await this.findOne({ ticketId: id }));
  return id;
};

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
