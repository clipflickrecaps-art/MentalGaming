require('dotenv').config();

const config = {
  bot: {
    token: process.env.BOT_TOKEN,
    adminId: Number(process.env.ADMIN_ID),
  },
  db: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/mental_gaming_store',
  },
  ai: {
    apiKey: process.env.AI_API_KEY,
  },
  membership: {
    tiers: ['Silver', 'Gold', 'Platinum'],
  },
  currency: {
    base: 'MMK',
    supported: ['BRL', 'PHP', 'USD'],
  },
  antiSpam: {
    maxRequestsPerMinute: 10,
    warningThreshold: 3,
  },
};

function validate() {
  const required = ['BOT_TOKEN', 'MONGODB_URI', 'ADMIN_ID'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

module.exports = { config, validate };
