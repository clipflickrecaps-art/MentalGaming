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
  'common.back_main':    { en: '🏠 Back to main menu.',  mm: '🏠 ပင်မ menu သို့ ပြန်သွားသည်။' },
  'common.back':         { en: '🔙 Back',                mm: '🔙 နောက်သို့' },
  'common.cancel':       { en: '❌ Cancel',              mm: '❌ ပယ်ဖျက်' },
  'common.confirm':      { en: '✅ Confirm',             mm: '✅ အတည်ပြု' },
  'common.loading':      { en: '⌛ Loading...',          mm: '⌛ ဆွဲတင်နေသည်...' },
  'common.user_not_found':{en: '❌ User not found. Please /start first.',
                           mm: '❌ အသုံးပြုသူ မတွေ့ပါ။ /start ဖြင့် စတင်ပါ။' },
  'common.start_first':  { en: '❌ Please type /start and try again.',
                           mm: '❌ /start ဖြင့် ပြန်စတင်ပါ။' },
  'common.commands':     { en: 'Commands',  mm: 'အမိန့်များ' },
  'common.actions':      { en: 'Actions',   mm: 'လုပ်ဆောင်ချက်များ' },
  'common.days':         { en: 'days',      mm: 'ရက်' },
  'common.day':          { en: 'day',       mm: 'ရက်' },

  // ── Wallet ───────────────────────────────────────────────────────────────
  'wallet.title':            { en: '💰 My Wallet',           mm: '💰 ကျွန်ုပ်၏ ပိုက်ဆံအိတ်' },
  'wallet.ks_balance':       { en: 'KS Balance',             mm: 'KS လက်ကျန်' },
  'wallet.coins':            { en: 'Mental Coins',           mm: 'Mental Coin များ' },
  'wallet.tier':             { en: 'Tier',                   mm: 'အဆင့်' },
  'wallet.bonus_rate':       { en: 'Coin Bonus Rate',        mm: 'Coin Bonus နှုန်း' },
  'wallet.on_topups':        { en: 'on top-ups',             mm: 'topup တိုင်းတွင်' },
  'wallet.total_deposited':  { en: 'Total Deposited',        mm: 'စုစုပေါင်း ထည့်ထား' },
  'wallet.to_next_tier':     { en: 'To {tier}',              mm: '{tier} သို့' },
  'wallet.more':             { en: 'more',                   mm: 'ထပ်လို' },
  'wallet.max_tier':         { en: '🏆 Maximum tier reached!', mm: '🏆 အမြင့်ဆုံးအဆင့်သို့ ရောက်ပြီ!' },
  'wallet.cmd_topup':        { en: '/topup — Top Up Wallet',                 mm: '/topup — ပိုက်ဆံအိတ် ဖြည့်တင်း' },
  'wallet.cmd_history':      { en: '/history — Transaction History',         mm: '/history — ငွေသွင်း/ထုတ် မှတ်တမ်း' },
  'wallet.cmd_coinhistory':  { en: '/coinhistory — Mental Coin History',     mm: '/coinhistory — Coin မှတ်တမ်း' },
  'wallet.ks_history_title': { en: '📜 *KS Transaction History*',            mm: '📜 *KS ငွေသွင်း/ထုတ် မှတ်တမ်း*' },
  'wallet.coin_history_title':{en: '🪙 *Mental Coin History*',               mm: '🪙 *Mental Coin မှတ်တမ်း*' },
  'wallet.no_ks_history':    { en: '📜 No KS transactions yet. Use /topup to top up your wallet.',
                               mm: '📜 ငွေသွင်း/ထုတ် မှတ်တမ်း မရှိသေးပါ။ /topup ဖြင့် စတင်ပါ။' },
  'wallet.no_coin_history':  { en: '🪙 No coin transactions yet.',
                               mm: '🪙 Coin မှတ်တမ်း မရှိသေးပါ။' },
  'wallet.back_to_wallet':   { en: '🔙 Back to Wallet',  mm: '🔙 ပိုက်ဆံအိတ်သို့ ပြန်' },
  'wallet.load_failed':      { en: '❌ Could not load wallet. Please type /start and try again.',
                               mm: '❌ ပိုက်ဆံအိတ် မဆွဲတင်နိုင်ပါ။ /start ဖြင့် ပြန်စတင်ပါ။' },

  // ── Profile ──────────────────────────────────────────────────────────────
  'profile.title':           { en: '👤 My Profile',          mm: '👤 ကျွန်ုပ်၏ ပရိုဖိုင်' },
  'profile.no_username':     { en: 'No username',            mm: 'username မရှိ' },
  'profile.id':              { en: 'ID',                     mm: 'ID' },
  'profile.discount_label':  { en: 'Tier Discount',          mm: 'အဆင့်အလိုက် လျှော့စျေး' },
  'profile.discount_off':    { en: 'off all products',       mm: 'ပစ္စည်းအားလုံးအတွက်' },
  'profile.discount_none':   { en: 'None (Silver)',          mm: 'မရှိ (Silver)' },
  'profile.streak':          { en: 'Check-In Streak',        mm: 'နေ့စဉ်ဝင်ရက်' },
  'profile.total_checkins':  { en: 'Total Check-Ins',        mm: 'စုစုပေါင်း ဝင်ရက်' },
  'profile.tier_progress':   { en: '📈 *Tier Progress:*',    mm: '📈 *အဆင့်တိုးတက်မှု:*' },
  'profile.max_tier':        { en: '🏆 *MAX TIER — Platinum!*', mm: '🏆 *အမြင့်ဆုံးအဆင့် — Platinum!*' },
  'profile.warnings':        { en: 'Warnings',               mm: 'သတိပေးချက်များ' },
  'profile.restrictions':    { en: 'Restrictions',           mm: 'ကန့်သတ်ချက်များ' },
  'profile.lifted':          { en: 'Lifted',                 mm: 'ပြန်ဖြုတ်မည်' },
  'profile.joined':          { en: 'Joined',                 mm: 'အသင်းဝင်ခဲ့ရက်' },
  'profile.cmd_progress':    { en: '/progress — Tier Progress',     mm: '/progress — အဆင့်တိုးတက်မှု' },
  'profile.cmd_settings':    { en: '/settings — Theme & Language',  mm: '/settings — အပြင်အဆင် နှင့် ဘာသာစကား' },
  'profile.load_failed':     { en: '❌ Could not load profile. Please type /start and try again.',
                               mm: '❌ ပရိုဖိုင် မဆွဲတင်နိုင်ပါ။ /start ဖြင့် ပြန်စတင်ပါ။' },

  // ── Shop ─────────────────────────────────────────────────────────────────
  'shop.title':              { en: '🛒 Game Store',          mm: '🛒 ဂိမ်းဆိုင်' },
  'shop.browse':             { en: 'Browse by game or category.',  mm: 'ဂိမ်း သို့မဟုတ် အမျိုးအစားအလိုက် ကြည့်ပါ။' },
  'shop.prices_ks':          { en: 'All prices shown in KS.',       mm: 'စျေးနှုန်း အားလုံးကို KS ဖြင့် ဖော်ပြထားသည်။' },
  'shop.select_package':     { en: 'Select a package',              mm: 'package ရွေးပါ' },
  'shop.packages_available': { en: 'package(s) available',          mm: 'package ရရှိနိုင်' },
  'shop.tap_to_order':       { en: 'Tap to order',                  mm: 'အော်ဒါတင်ရန် နှိပ်ပါ' },
  'shop.no_products':        { en: 'No products available.',        mm: 'ပစ္စည်း မရှိသေးပါ။' },
  'shop.category':           { en: 'Category',                      mm: 'အမျိုးအစား' },
  'shop.region':             { en: 'Region',                        mm: 'ဒေသ' },
  'shop.price':              { en: 'Price',                         mm: 'ဈေးနှုန်း' },
  'shop.stock':              { en: 'Stock',                         mm: 'လက်ကျန်' },
  'shop.stock_unlimited':    { en: '∞ Unlimited',                   mm: '∞ ကန့်သတ်မရှိ' },
  'shop.stock_left':         { en: 'left',                          mm: 'ကျန်' },
  'shop.order_now':          { en: '🛒 Order Now',                  mm: '🛒 အော်ဒါတင်မည်' },
  'shop.product_not_found':  { en: '❌ Product not found.',         mm: '❌ ပစ္စည်း မတွေ့ပါ။' },

  // ── Orders ───────────────────────────────────────────────────────────────
  'orders.title':            { en: '📦 My Orders',           mm: '📦 ကျွန်ုပ်၏ အော်ဒါများ' },
  'orders.none':             { en: '📭 You have no orders yet. Visit the 🛒 Shop to place your first order!',
                               mm: '📭 အော်ဒါ မရှိသေးပါ။ 🛒 ဈေးဝယ်တွင် စတင်ပါ။' },

  // ── Support ──────────────────────────────────────────────────────────────
  'support.title':           { en: '💬 *Customer Support*',  mm: '💬 *ဖောက်သည် အကူအညီ*' },
  'support.choose':          { en: 'How can we help you?',   mm: 'ဘယ်လို ကူညီပေးရမလဲ?' },
  'support.ai_chat':         { en: '🤖 Ask AI Assistant',    mm: '🤖 AI ကို မေးမြန်း' },
  'support.create_ticket':   { en: '🎫 Create Support Ticket', mm: '🎫 အကူအညီ ticket ဖန်တီး' },
  'support.my_tickets':      { en: '📋 My Tickets',          mm: '📋 ကျွန်ုပ်၏ tickets' },

  // ── Check-in ─────────────────────────────────────────────────────────────
  'checkin.title':           { en: '🗓 *Daily Check-In*',    mm: '🗓 *နေ့စဉ်ဝင်*' },
  'checkin.streak':          { en: 'Current Streak',         mm: 'လက်ရှိ ဝင်ရက်' },
  'checkin.reward':          { en: "Today's Reward",         mm: 'ဒီနေ့ ဆုကြေး' },
  'checkin.already':         { en: '✅ You already checked in today. Come back tomorrow!',
                               mm: '✅ ဒီနေ့ ဝင်ပြီးပါပြီ။ မနက်ဖြန် ပြန်လာပါ။' },

  // ── Promo ────────────────────────────────────────────────────────────────
  'promo.title':             { en: '🎟 *Promo Codes*',       mm: '🎟 *ပရိုမို ကုဒ်များ*' },
  'promo.instructions':      { en: 'To check a promo code, type:\n`/promo YOUR_CODE`\n\nPromo codes are applied during checkout in the 🛒 Shop.',
                               mm: 'ပရိုမို ကုဒ် စစ်ဆေးရန်:\n`/promo YOUR_CODE`\n\nပရိုမို ကုဒ်များကို 🛒 ဈေးဝယ်တွင် checkout လုပ်စဉ် အသုံးပြုနိုင်ပါသည်။' },

  // ── FAQ ──────────────────────────────────────────────────────────────────
  'faq.title':               { en: '❓ *Frequently Asked Questions*', mm: '❓ *မေးခွန်းများ*' },
  'faq.choose':              { en: 'Choose a category:',     mm: 'အမျိုးအစား ရွေးပါ:' },

  // ── Support extras ───────────────────────────────────────────────────────
  'support.ai_24_7':         { en: '🤖 AI Assistant available *24/7*',         mm: '🤖 AI အကူအညီ *၂၄/၇*' },
  'support.human_hours':     { en: '👨 Human support: *9AM – 11PM* MMT',       mm: '👨 လူသား အကူအညီ: မနက် ၉ – ည ၁၁ နာရီ (မြန်မာစံတော်ချိန်)' },
  'support.instant':         { en: '⚡ AI responds instantly',                 mm: '⚡ AI က ချက်ချင်း ဖြေပါသည်' },
  'support.start_chat':      { en: '*Type /support to start a chat with our AI assistant.*',
                               mm: '*AI assistant နှင့် စကားပြောရန် /support ရိုက်ပါ။*' },
  'support.start_desc':      { en: 'It can help with orders, payments, game IDs, and more — and will escalate to a human if needed.',
                               mm: 'အော်ဒါ၊ ငွေပေးချေမှု၊ game ID စသည်တို့ကို ဖြေရှင်းပေးနိုင်ပြီး လိုအပ်ပါက လူသား staff သို့ ဆက်လွှဲပါမည်။' },

  // ── Orders extras ────────────────────────────────────────────────────────
  'orders.title_count':      { en: '📦 *My Orders ({count})*',  mm: '📦 *အော်ဒါများ ({count})*' },
  'orders.all':              { en: 'All',        mm: 'အားလုံး' },
  'orders.pending':          { en: 'Pending',    mm: 'ဆိုင်းငံ့' },
  'orders.completed':        { en: 'Completed',  mm: 'ပြီးပြီ' },
  'orders.cancelled':        { en: 'Cancelled',  mm: 'ပယ်ဖျက်' },
  'orders.page_of':          { en: 'Page {p}/{t}',  mm: 'စာမျက်နှာ {p}/{t}' },

  // ── Checkin extras ───────────────────────────────────────────────────────
  'checkin.already_today':   { en: '✅ *Already Checked In Today!*',     mm: '✅ *ဒီနေ့ ဝင်ပြီးပါပြီ!*' },
  'checkin.current_streak':  { en: 'Current Streak',                     mm: 'လက်ရှိ ဝင်ရက်' },
  'checkin.next_in':         { en: 'Next check-in in',                   mm: 'နောက်တစ်ကြိမ် ဝင်ရန်' },
  'checkin.tomorrow_reward': { en: "Tomorrow's reward",                  mm: 'မနက်ဖြန် ဆုကြေး' },
  'checkin.calendar':        { en: '📅 Calendar',                        mm: '📅 ပြက္ခဒိန်' },
  'checkin.my_streak':       { en: '📊 My Streak',                       mm: '📊 ကျွန်ုပ်၏ ဝင်ရက်' },
  'checkin.complete':        { en: '✅ *Check-In Complete!*',            mm: '✅ *ဝင်ပြီးပါပြီ!*' },
  'checkin.streak_label':    { en: 'Streak',                             mm: 'ဝင်ရက်' },
  'checkin.broken':          { en: '⚠️ _Your streak was reset. Start fresh from Day 1!_',
                               mm: '⚠️ _သင်၏ ဝင်ရက် ပြန်စပြီ။ Day 1 မှ ပြန်စတင်ပါ။_' },
  'checkin.milestone':       { en: '🎊 *MILESTONE UNLOCKED!*',           mm: '🎊 *မှတ်တိုင် ရရှိပြီ!*' },
  'checkin.bonus':           { en: 'bonus',                              mm: 'ဆုကြေး' },
  'checkin.earned':          { en: 'earned',                             mm: 'ရရှိ' },
  'checkin.coin_balance':    { en: 'Coins Balance',                      mm: 'Coin လက်ကျန်' },
  'checkin.tomorrow':        { en: 'Tomorrow',                           mm: 'မနက်ဖြန်' },

  // ── Address Book ─────────────────────────────────────────────────────────
  'gameids.title':           { en: '📖 *My Saved Game IDs*',  mm: '📖 *သိမ်းထားသော Game ID များ*' },
  'gameids.empty':           { en: '_No saved IDs yet. Use /saveid to add one._',
                               mm: '_မရှိသေးပါ။ /saveid ဖြင့် ထည့်ပါ။_' },
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
