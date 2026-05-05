const DICT = {
  en: {
    main_title: 'Mental Gaming Store', choose: 'Choose an option below:', welcome: 'Welcome',
    balance: 'Balance', coins: 'Coins', tier: 'Tier', shop: 'Shop', my_orders: 'My Orders', wallet: 'Wallet', profile: 'My Profile', checkin: 'Check In', streak: 'My Streak', calendar: 'Calendar', spin: 'Spin Wheel', promo: 'Promo Code', saved_ids: 'Saved IDs', referral: 'Referral', faq: 'FAQ', support: 'Support', settings: 'Settings',
    settings_title: 'Settings', theme: 'Display Theme', language: 'Language', updated: 'Settings Updated', first_lang: 'Please choose your language first:', about: 'Welcome to Mental Gaming Store! Buy game top-ups, gift cards, wallet top-up, daily rewards, spin rewards, support tickets and order tracking in one bot.'
  },
  mm: {
    main_title: 'Mental Gaming Store', choose: 'အောက်က menu မှာ ရွေးပါ။', welcome: 'မင်္ဂလာပါ',
    balance: 'လက်ကျန်', coins: 'Coins', tier: 'အဆင့်', shop: 'စျေးဝယ်မယ်', my_orders: 'ကျွန်ုပ် Order များ', wallet: 'ပိုက်ဆံအိတ်', profile: 'ကိုယ်ရေးအချက်အလက်', checkin: 'နေ့စဉ် Check-In', streak: 'Streak ကြည့်ရန်', calendar: 'Calendar', spin: 'Spin Wheel', promo: 'Promo Code', saved_ids: 'သိမ်းထားသော ID များ', referral: 'Referral', faq: 'မေးလေ့ရှိသောမေးခွန်းများ', support: 'အကူအညီ', settings: 'Setting',
    settings_title: 'Setting', theme: 'Theme', language: 'ဘာသာစကား', updated: 'Setting ပြောင်းပြီးပါပြီ', first_lang: 'ပထမဆုံး ဘာသာစကားရွေးပါ။', about: 'Mental Gaming Store မှ ကြိုဆိုပါတယ်။ Game top-up, gift card, wallet top-up, daily reward, spin reward, support ticket နဲ့ order tracking တွေကို bot တစ်ခုတည်းမှာ အသုံးပြုနိုင်ပါတယ်။'
  }
};
function lang(ctx){ return ctx.user?.language === 'mm' ? 'mm' : 'en'; }
function t(ctx, key){ const l=lang(ctx); return (DICT[l] && DICT[l][key]) || DICT.en[key] || key; }
function label(ctx, key, emoji=''){ return `${emoji ? emoji+' ' : ''}${t(ctx,key)}`; }
module.exports = { t, lang, label, DICT };
