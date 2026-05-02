const axios = require('axios');
const Currency = require('../models/Currency');
const { refreshAllAutoPricedProducts } = require('../controllers/pricingController');

const SUPPORTED_CURRENCIES = ['BRL', 'PHP', 'USD'];
const EXCHANGE_API_BASE = 'https://open.er-api.com/v6/latest/MMK';

async function fetchLiveRates() {
  try {
    const { data } = await axios.get(EXCHANGE_API_BASE, { timeout: 8000 });

    if (data.result !== 'success') {
      throw new Error('Exchange API returned failure status');
    }

    const rates = data.rates;
    const updates = [];

    for (const code of SUPPORTED_CURRENCIES) {
      if (!rates[code]) continue;
      const rateToMMK = 1 / rates[code];
      await Currency.upsertRate(code, rateToMMK, 'api');
      updates.push({ code, rateToMMK: rateToMMK.toFixed(2) });
    }

    console.log('[CurrencyService] Rates updated:', updates);
    await refreshAllAutoPricedProducts();
    return updates;
  } catch (err) {
    console.error('[CurrencyService] Failed to fetch live rates:', err.message);
    throw err;
  }
}

async function manualSetRate(currencyCode, rateToMMK) {
  const doc = await Currency.upsertRate(currencyCode, rateToMMK, 'manual');
  await refreshAllAutoPricedProducts();
  return doc;
}

module.exports = { fetchLiveRates, manualSetRate };
