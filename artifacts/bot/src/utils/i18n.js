/**
 * Minimal i18n — English / Myanmar
 * Usage:
 *   const { t, getLang } = require('./i18n');
 *   t(ctx, 'menu.shop')            // resolves lang from ctx.user.language
 *   t('mm', 'menu.shop')           // explicit lang string
 *   t(ctx, 'welcome.greeting', { name: 'Alice' })
 */

const STRINGS = {
  // ── Main menu buttons ────────────────────────────────────────────────────
  'menu.shop':       { en: '🛒 Shop',           mm: '🛒 ဈေးဝယ်' },
  'menu.orders':     { en: '📦 My Orders',      mm: '📦 အော်ဒါများ' },
  'menu.wallet':     { en: '💰 Wallet',         mm: '💰 ပိုက်ဆံအိတ်' },
  'menu.profile':    { en: '👤 My Profile',     mm: '👤 ပရိုဖိုင်' },
  'menu.checkin':    { en: '🗓 Check In',       mm: '🗓 နေ့စဉ်ဝင်' },
  'menu.spin':       { en: '🎰 Spin Wheel',     mm: '🎰 ဘီးလှည့်' },
  'menu.promo':      { en: '🎟 Promo',          mm: '🎟 ပရိုမို' },
  'menu.referral':   { en: '👥 Referral',       mm: '👥 မိတ်ဆက်' },
  'menu.gameids':    { en: '📖 My Game IDs',    mm: '📖 ဂိမ်း ID များ' },
  'menu.faq':        { en: '❓ FAQ',            mm: '❓ မေးခွန်းများ' },
  'menu.support':    { en: '💬 Support',        mm: '💬 အကူအညီ' },
  'menu.settings':   { en: '⚙️ Settings',       mm: '⚙️ ဆက်တင်' },

  // ── Welcome / common ─────────────────────────────────────────────────────
  'welcome.title':       { en: '👋 Welcome to *Mental Gaming Store*!', mm: '👋 *Mental Gaming Store* မှ ကြိုဆိုပါတယ်!' },
  'welcome.subtitle':    { en: 'Myanmar\'s trusted game top-up & gift card store.',
                           mm: 'မြန်မာ့ ယုံကြည်စိတ်ချရတဲ့ ဂိမ်း top-up နဲ့ gift card ဆိုင်။' },
  'welcome.balance':     { en: 'Your wallet balance',  mm: 'သင့်ပိုက်ဆံအိတ်လက်ကျန်' },
  'welcome.tap_below':   { en: 'Tap a button below to get started.',
                           mm: 'အောက်က ခလုတ်ကို နှိပ်ပြီး စတင်ပါ။' },

  // ── Settings screen ──────────────────────────────────────────────────────
  'settings.title':      { en: '⚙️ Settings',                 mm: '⚙️ ဆက်တင်များ' },
  'settings.theme':      { en: 'Display Theme',              mm: 'အပြင်အဆင် ပုံစံ' },
  'settings.language':   { en: 'Language',                   mm: 'ဘာသာစကား' },
  'settings.auto_hint':  { en: 'Auto mode: 6PM–6AM MMT = Dark, 6AM–6PM = Light',
                           mm: 'Auto mode: ည ၆နာရီ–မနက် ၆နာရီ = အမှောင်၊ ၆နာရီ–ည ၆နာရီ = အလင်း' },
  'settings.updated':    { en: '✅ Settings updated',         mm: '✅ ဆက်တင် ပြောင်းပြီးပါပြီ' },
  'settings.applies':    { en: 'Changes apply immediately.',  mm: 'ချက်ချင်း အကျိုးသက်ရောက်ပါမည်။' },
  'settings.menu_updated':{en: 'Main menu updated to your new language.',
                           mm: 'Main menu ကို သင်ရွေးထားသော ဘာသာစကားသို့ ပြောင်းပြီးပါပြီ။' },

  // ── Common ───────────────────────────────────────────────────────────────
  'common.back_main':    { en: '🏠 Back to main menu.', mm: '🏠 ပင်မ menu သို့ ပြန်သွားသည်။' },
};

const LABELS = {
  lang_en: { en: '🇬🇧 English', mm: '🇬🇧 English' },
  lang_mm: { en: '🇲🇲 Myanmar', mm: '🇲🇲 မြန်မာ' },
};

function getLang(ctxOrLang) {
  if (typeof ctxOrLang === 'string') return ctxOrLang === 'mm' ? 'mm' : 'en';
  const l = ctxOrLang?.user?.language;
  return l === 'mm' ? 'mm' : 'en';
}

function t(ctxOrLang, key, vars = {}) {
  const lang = getLang(ctxOrLang);
  const entry = STRINGS[key] || LABELS[key];
  let text = entry ? (entry[lang] || entry.en || key) : key;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return text;
}

/**
 * Returns both EN+MM labels for a menu key — used in bot.hears arrays so
 * handlers fire regardless of which language the user has selected.
 */
function bothLabels(key) {
  const entry = STRINGS[key];
  if (!entry) return [key];
  return [entry.en, entry.mm];
}

module.exports = { t, getLang, bothLabels, STRINGS };
