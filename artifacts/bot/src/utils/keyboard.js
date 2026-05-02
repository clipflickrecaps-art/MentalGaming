const { Markup } = require('telegraf');

function mainMenuKeyboard() {
  return Markup.keyboard([
    ['🛒 Shop', '📦 My Orders'],
    ['💰 Wallet', '👤 My Profile'],
    ['💬 Support', '⚙️ Settings'],
  ]).resize();
}

function adminMenuKeyboard() {
  return Markup.keyboard([
    ['📊 Dashboard', '📦 Manage Orders'],
    ['🛍️ Manage Products', '👥 Manage Users'],
    ['💱 Update Rates', '📋 Audit Logs'],
    ['🔙 Back to Main'],
  ]).resize();
}

function confirmKeyboard(confirmText = '✅ Confirm', cancelText = '❌ Cancel') {
  return Markup.inlineKeyboard([
    Markup.button.callback(confirmText, 'confirm'),
    Markup.button.callback(cancelText, 'cancel'),
  ]);
}

function paginationKeyboard(currentPage, totalPages, prefix) {
  const buttons = [];
  if (currentPage > 1) buttons.push(Markup.button.callback('◀️ Prev', `${prefix}_prev_${currentPage}`));
  buttons.push(Markup.button.callback(`${currentPage}/${totalPages}`, 'noop'));
  if (currentPage < totalPages) buttons.push(Markup.button.callback('Next ▶️', `${prefix}_next_${currentPage}`));
  return Markup.inlineKeyboard(buttons);
}

module.exports = { mainMenuKeyboard, adminMenuKeyboard, confirmKeyboard, paginationKeyboard };
