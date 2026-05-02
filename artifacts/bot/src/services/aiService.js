const axios = require('axios');
const { config } = require('../../config/settings');

async function generateProductDescription(productName, category, region) {
  if (!config.ai.apiKey) {
    return `${productName} — ${category} for ${region} region.`;
  }

  try {
    const { data } = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a copywriter for a gaming store. Write short, engaging product descriptions in 2 sentences max.',
          },
          {
            role: 'user',
            content: `Write a product description for: ${productName}, Category: ${category}, Region: ${region}`,
          },
        ],
        max_tokens: 100,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${config.ai.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    return data.choices[0]?.message?.content?.trim() || `${productName} — Available for ${region}`;
  } catch (err) {
    console.error('[AIService] Failed to generate description:', err.message);
    return `${productName} — ${category} for ${region} region.`;
  }
}

async function answerSupportQuery(userMessage, context = '') {
  if (!config.ai.apiKey) return null;

  try {
    const { data } = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a helpful customer support agent for Mental Gaming Store — a Telegram-based gaming store. ${context}`,
          },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 300,
        temperature: 0.5,
      },
      {
        headers: {
          Authorization: `Bearer ${config.ai.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    return data.choices[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[AIService] Support query failed:', err.message);
    return null;
  }
}

module.exports = { generateProductDescription, answerSupportQuery };
