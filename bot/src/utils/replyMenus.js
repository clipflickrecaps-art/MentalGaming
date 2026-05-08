const { Markup } = require('telegraf');
const { t, lang } = require('./i18n');

function keyboard(rows) { return Markup.keyboard(rows).resize(); }

function isMM(ctx) { return lang(ctx) === 'mm'; }

function userMainRows(ctx) {
  if (isMM(ctx)) {
    return [
      ['🛒 စျေးဝယ်မယ်', '📦 ကျွန်ုပ် Order များ'],
      ['💰 ပိုက်ဆံအိတ်', '👤 ကိုယ်ရေးအချက်အလက်'],
      ['🗓 နေ့စဉ် Check-In', '🔥 Streak ကြည့်ရန်'],
      ['📅 Calendar', '🎰 Spin Wheel'],
      ['📢 Channels', '🎟 Promo Code'],
      ['📖 သိမ်းထားသော ID များ', '🔗 Referral'],
      ['💬 အကူအညီ', '📚 မေးလေ့ရှိသောမေးခွန်းများ'],
      ['⚙️ Setting'],
    ];
  }
  return [
    ['🛒 Shop', '📦 My Orders'],
    ['💰 Wallet', '👤 My Profile'],
    ['🗓 Check In', '🔥 My Streak'],
    ['📅 Calendar', '🎰 Spin Wheel'],
    ['📢 Channels', '🎟 Promo Code'],
    ['📖 Saved IDs', '🔗 Referral'],
    ['💬 Support', '📚 FAQ'],
    ['⚙️ Settings'],
  ];
}

function adminRows() {
  return [
    ['📊 Dashboard', '📦 Manage Orders'],
    ['🛍️ Manage Products', '👥 Manage Users'],
    ['🎰 Spin Rewards', '💳 Payments'],
    ['📢 Channel Settings', '🗓 Check-In'],
    ['🎟 Coupon Manager', '🗓 Auto Channel Posts'],
    ['📁 Categories', '🏠 Admin Menu'],
  ];
}

function userMainKeyboard(ctx) { return keyboard(userMainRows(ctx)); }
function adminKeyboard() { return keyboard(adminRows()); }
function backMainKeyboard(ctx) {
  return keyboard(isMM(ctx) ? [['🔙 နောက်သို့', '🏠 Main Menu']] : [['🔙 Back', '🏠 Main Menu']]);
}
function langKeyboard() { return keyboard([['🇲🇲 Myanmar', '🇬🇧 English']]); }

async function showUserMain(ctx, extra = '') {
  const user = ctx.user;
  const name = user?.first_name || ctx.from?.first_name || ctx.from?.username || 'Mental';
  const text = isMM(ctx)
    ? `🌙 *Mental Gaming Store*\n━━━━━━━━━━━━━━━━━━\n🌑 မင်္ဂလာပါ၊ *${name}!*\n💵 လက်ကျန်: *${Number(user?.balanceKS || 0).toLocaleString()} KS*\n💎 Coins: *${Number(user?.balanceCoin || 0).toLocaleString()} MC*\n⭐ အဆင့်: *${user?.membershipTier || 'Silver'}*\n\nအောက်က menu မှာ ရွေးပါ။`
    : `🌙 *Mental Gaming Store*\n━━━━━━━━━━━━━━━━━━\n🌑 Welcome, *${name}!*\n💵 Balance: *${Number(user?.balanceKS || 0).toLocaleString()} KS*\n💎 Coins: *${Number(user?.balanceCoin || 0).toLocaleString()} MC*\n⭐ Tier: *${user?.membershipTier || 'Silver'}*\n\nChoose an option below.`;
  return ctx.reply(`${extra ? `${extra}\n\n` : ''}${text}`, { parse_mode: 'Markdown', ...userMainKeyboard(ctx) });
}

async function showAdminMain(ctx) {
  const name = ctx.from?.first_name || ctx.from?.username || 'Admin';
  return ctx.reply(
    `🔧 *Admin Panel — Reply Keyboard Mode*\n👋 Welcome back, *${name}*!\n\nInline UI အဟောင်းမသုံးတော့ပါ။ Button အားလုံး Reply Keyboard ဖြစ်ပါတယ်။`,
    { parse_mode: 'Markdown', ...adminKeyboard() }
  );
}

module.exports = { keyboard, userMainRows, userMainKeyboard, adminRows, adminKeyboard, backMainKeyboard, langKeyboard, showUserMain, showAdminMain, isMM };
