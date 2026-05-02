const axios = require('axios');
const { config } = require('../../config/settings');

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function geminiUrl(endpoint) {
  return `${GEMINI_BASE}/${GEMINI_MODEL}:${endpoint}?key=${config.ai.apiKey}`;
}

async function callGemini(systemPrompt, userPrompt, maxTokens = 200) {
  const { data } = await axios.post(
    geminiUrl('generateContent'),
    {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
  );

  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

async function generateProductDescription(productName, category, region) {
  if (!config.ai.apiKey) {
    return `${productName} — ${category} for ${region} region.`;
  }

  try {
    const result = await callGemini(
      'You are a copywriter for a gaming store. Write short, engaging product descriptions in 2 sentences max.',
      `Write a product description for: ${productName}, Category: ${category}, Region: ${region}`,
      100
    );
    return result || `${productName} — ${category} for ${region} region.`;
  } catch (err) {
    console.error('[AIService] Failed to generate description:', err.message);
    return `${productName} — ${category} for ${region} region.`;
  }
}

async function answerSupportQuery(userMessage, context = '') {
  if (!config.ai.apiKey) return null;

  try {
    const result = await callGemini(
      `You are a helpful customer support agent for Mental Gaming Store — a Telegram-based gaming store that sells game credits, gift cards, and top-ups. ${context} Keep answers short and friendly.`,
      userMessage,
      300
    );
    return result;
  } catch (err) {
    console.error('[AIService] Support query failed:', err.message);
    return null;
  }
}

module.exports = { generateProductDescription, answerSupportQuery };
