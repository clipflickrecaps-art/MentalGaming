const { adminOnly, requireRole } = require('../middlewares/adminCheck');
const { fetchLiveRates, getAllRates } = require('../services/currencyService');
const { auditLog } = require('../services/logger');
const { listUsers } = require('../services/UserManagementService');
const { Markup } = require('telegraf');
const Nav = require('../services/NavigationService');
const Order = require('../models/Order');
const Product = require('../models/Product');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const Promo = require('../models/Promo');
const SupportTicket = require('../models/SupportTicket');
const SystemStatus = require('../models/SystemStatus');
const CacheService = require('../services/CacheService');
const AnalyticsService = require('../services/AnalyticsService');
const { price } = require('../utils/ui');
const { adminMenuKeyboard, mainMenuKeyboard } = require('../utils/keyboard');
const os = require('os');

// ── Admin main nav — inline panel with live stats ─────────────────────────────

Nav.register({
  id: 'admin_main',
  title: '🔧 Admin Panel',
  build: async (ctx, theme) => {
    const [pending, processing, activeProducts, totalUsers] = await Promise.all([
      Order.countDocuments({ status: 'Pending' }),
      Order.countDocuments({ status: 'Processing' }),
      Product.countDocuments({ isActive: true }),
      User.countDocuments({}),
    ]);

    const text =
      `🔧 *Admin Panel — Mental Gaming Store*\n\n` +
      `🟡 Pending Orders: *${pending}*\n` +
      `🔵 Processing: *${processing}*\n` +
      `🛍️ Active Products: *${activeProducts}*\n` +
      `👥 Total Users: *${totalUsers}*\n\n` +
      `_Tap a button below to continue._`;

    // Reply keyboard only — admin uses persistent buttons, not inline
    return { text, keyboard: adminMenuKeyboard() };
  },
});

// ── Module ────────────────────────────────────────────────────────────────────

module.exports = function registerAdmin(bot) {

  // ── /admin command ─────────────────────────────────────────────────────────
  bot.command('admin', adminOnly(), async (ctx) => {
    await Nav.navigate(ctx, 'admin_main', false);
  });

  // ── Reply-keyboard handlers for admin menu buttons ─────────────────────────

  // 📦 Manage Orders → show 10 most recent pending orders w/ action buttons
  bot.hears('📦 Manage Orders', adminOnly(), async (ctx) => {
    const orders = await Order.find({ status: { $in: ['Pending', 'Processing'] } })
      .populate('userId', 'username telegramId')
      .populate('productId', 'name')
      .sort({ timestamp: -1 })
      .limit(10);

    if (!orders.length) {
      return ctx.reply('✅ No pending or processing orders right now.');
    }

    const lines = orders.map((o, i) => {
      const user    = o.userId?.username ? `@${o.userId.username}` : `ID:${o.userId?.telegramId}`;
      const product = o.productId?.name || 'Unknown';
      const icon    = o.status === 'Pending' ? '🟡' : '🔵';
      return `${i + 1}. ${icon} ${user} — *${product}* — \`${price(o.amount)}\``;
    });
    await ctx.reply(
      `📦 *Active Orders (${orders.length})*\n\n${lines.join('\n')}\n\n_Use /pendingorders to see full cards with action buttons._`,
      { parse_mode: 'Markdown' }
    );
  });

  // 🛍️ Manage Products → quick stats + command list
  bot.hears('🛍️ Manage Products', adminOnly(), async (ctx) => {
    const [total, active] = await Promise.all([
      Product.countDocuments({}),
      Product.countDocuments({ isActive: true }),
    ]);
    await ctx.reply(
      `🛍️ *Manage Products*\n\n` +
      `📊 Total: *${total}* | Active: *${active}*\n\n` +
      `*Commands:*\n` +
      `• /addproduct — add new product\n` +
      `• /listproducts — list all products\n` +
      `• /editproduct — edit existing\n` +
      `• /deleteproduct — remove product\n` +
      `• /toggleproduct — activate/deactivate\n` +
      `• /flashsale — create flash sale\n` +
      `• /addcodes — add digital codes`,
      { parse_mode: 'Markdown' }
    );
  });

  // 👥 Manage Users → first page of users
  bot.hears('👥 Manage Users', adminOnly(), async (ctx) => {
    const { users, total, totalPages } = await listUsers({ page: 1, limit: 10 });
    if (!users.length) return ctx.reply('No users yet.');

    const lines = users.map((u, i) =>
      `${i + 1}. \`${u.telegramId}\` ${u.username ? `@${u.username}` : '—'} — ${u.membershipTier} ${u.isBlocked ? '🚫' : '🟢'}`
    );
    await ctx.reply(
      `👥 *Users (${total} total)*\n\n${lines.join('\n')}\n\n` +
      `_Search: /users <name|id>_\n` +
      `_Actions: /ban /unban /warn /restrict /adjustbal /userinfo_`,
      {
        parse_mode: 'Markdown',
        ...(totalPages > 1 ? Markup.inlineKeyboard([
          [Markup.button.callback(`Page 1/${totalPages} ›`, 'users_page:2')],
        ]) : {}),
      }
    );
  });

  // 💱 Manage Rates → show current rates + open rate manager
  bot.hears('💱 Manage Rates', adminOnly(), async (ctx) => {
    const rates = await getAllRates();
    if (!rates.length) {
      return ctx.reply('No exchange rates yet. Use /managerates to set up.', {
        ...Markup.inlineKeyboard([[Markup.button.callback('✏️ Open Rate Manager', 'open_rate_manager')]]),
      });
    }
    const lines = rates.map((r) =>
      `• *${r.currencyCode}*: \`${parseFloat(r.rateToMMK.toFixed(4))}\` MMK  _(${r.source})_`
    );
    await ctx.reply(`💱 *Current Exchange Rates*\n\n${lines.join('\n')}`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Update Rates', 'open_rate_manager')],
        [Markup.button.callback('🔄 Fetch Live', 'admin_fetch_rates')],
      ]),
    });
  });

  // 📢 Broadcast → enter broadcast scene
  bot.hears('📢 Broadcast', adminOnly(), (ctx) => ctx.scene.enter('broadcast_scene'));

  // 📋 Audit Logs → last 15 entries
  bot.hears('📋 Audit Logs', adminOnly(), async (ctx) => {
    const entries = await AuditLog.find({}).sort({ timestamp: -1 }).limit(15);
    if (!entries.length) return ctx.reply('📋 No audit log entries yet.');

    const lines = entries.map((e) => {
      const ts  = new Date(e.timestamp).toLocaleString('en-GB', { timeZone: 'Asia/Rangoon' });
      const det = Object.keys(e.details || {}).length
        ? ` — ${JSON.stringify(e.details).slice(0, 60)}`
        : '';
      return `\`${ts}\` *${e.action}*\n  by \`${e.adminId}\` on ${e.targetType}${e.targetId ? ` \`${String(e.targetId).slice(-8)}\`` : ''}${det}`;
    });

    await ctx.reply(
      `📋 *Audit Log (last ${entries.length})*\n\n${lines.join('\n\n')}`,
      { parse_mode: 'Markdown' }
    );
  });

  // 🎟 Promotions → list all promo codes + create button
  bot.hears('🎟 Promotions', adminOnly(), async (ctx) => {
    const promos = await Promo.find({}).sort({ createdAt: -1 }).limit(20);
    if (!promos.length) {
      return ctx.reply('🎟 No promo codes yet.\n\nUse /createpromo to create one.', {
        ...Markup.inlineKeyboard([[Markup.button.callback('➕ Create New', 'promo_create_start')]]),
      });
    }
    const lines = promos.map((p) => {
      const disc   = p.discountType === 'Flat' ? `${price(p.value)} off` : `${p.value}% off`;
      const uses   = p.maxUses ? `${p.currentUses}/${p.maxUses}` : `${p.currentUses}/∞`;
      const status = p.isActive ? '🟢' : '🔴';
      return `${status} \`${p.code}\` — ${disc} — Uses: ${uses}`;
    });
    await ctx.reply(
      `🎟 *Promo Codes (${promos.length})*\n\n${lines.join('\n')}\n\n` +
      `_Commands:_\n• /createpromo — guided creation\n• /deletepromo CODE — deactivate`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('➕ Create New', 'promo_create_start')]]),
      }
    );
  });

  // 🎫 Support Tickets → open + in-progress tickets
  bot.hears('🎫 Support Tickets', adminOnly(), async (ctx) => {
    const tickets = await SupportTicket.find({
      status: { $in: ['Open', 'InProgress'] },
      isArchived: { $ne: true },
    }).sort({ createdAt: -1 }).limit(10);

    if (!tickets.length) {
      return ctx.reply('✅ No open tickets right now.\n\n_Use /tickets all to see resolved ones._', { parse_mode: 'Markdown' });
    }

    const priorityBadge = { Normal: '🟡', High: '🟠', Urgent: '🔴' };
    const lines = tickets.map((t) => {
      const userTag  = t.username ? `@${t.username}` : `ID:${t.telegramId}`;
      const badge    = priorityBadge[t.priority] || '🟡';
      const assigned = t.assignedAdmin ? ` 🔵${t.assignedAdmin}` : '';
      return `${badge} \`${t.ticketId}\` — ${t.topic} — ${userTag}${assigned} _(${t.status})_`;
    });

    await ctx.reply(
      `🎫 *Open Tickets (${tickets.length})*\n\n${lines.join('\n')}\n\n` +
      `_Use /tickets to see full cards with Reply/Resolve/Assign buttons._`,
      { parse_mode: 'Markdown' }
    );
  });

  // 📈 Analytics → today's report quick view
  bot.hears('📈 Analytics', requireRole('MANAGER'), async (ctx) => {
    const wait = await ctx.reply('⏳ _Loading today\'s analytics..._', { parse_mode: 'Markdown' });
    try {
      const report = await AnalyticsService.getFullReport('today');
      const r = report.revenue;
      const text =
        `📈 *Quick Analytics — Today*\n\n` +
        `💰 Gross: *${(r.grossRevenue || 0).toLocaleString()} KS*\n` +
        `💵 Net: *${(r.netRevenue || 0).toLocaleString()} KS*\n` +
        `📊 Est. Profit: *${(r.netProfit || 0).toLocaleString()} KS* (${r.estimatedMarginPct}%)\n` +
        `✅ Completed: *${r.orderCount}* | ❌ Cancelled: *${report.cancellation.cancelled}*\n` +
        `👥 New Users: *+${report.users.newUsers}*\n\n` +
        `_Use /analytics today|week|month for full report._`;
      await ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('📅 Today',  'analytics:today'),
            Markup.button.callback('📆 Week',   'analytics:week'),
            Markup.button.callback('🗓 Month',  'analytics:month'),
          ],
          [
            Markup.button.callback('🤖 AI Report', 'analyticsai_run:today'),
            Markup.button.callback('📥 Export',    'analytics_export_menu'),
          ],
        ]),
      });
    } catch (err) {
      console.error('[Admin] Analytics quick view failed:', err);
      await ctx.telegram
        .editMessageText(wait.chat.id, wait.message_id, undefined, `❌ ${err.message}`)
        .catch(() => ctx.reply(`❌ ${err.message}`));
    }
  });

  // 🤖 AI Insights → menu for AI-powered admin reports
  bot.hears('🤖 AI Insights', requireRole('MANAGER'), async (ctx) => {
    await ctx.reply(
      `🤖 *AI Insights — Gemini 2.0 Flash*\n\n` +
      `Pick a report:\n\n` +
      `📊 *Business Report* — Monthly revenue/profit summary\n` +
      `🔮 *7-Day Forecast* — Sales prediction\n` +
      `💬 *Sentiment Report* — Customer review analysis\n` +
      `❤️ *System Health* — Gateway + system status`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📊 Business Report (Month)', 'analyticsai_run:month')],
          [Markup.button.callback('🔮 7-Day Forecast',          'ai_forecast_run')],
          [Markup.button.callback('💬 Sentiment Report',        'ai_sentiment_run')],
          [Markup.button.callback('❤️ System Health',           'ai_syshealth_run')],
        ]),
      }
    );
  });

  // 🔧 System → /sysinfo equivalent
  bot.hears('🔧 System', requireRole('MANAGER'), async (ctx) => {
    const wait = await ctx.reply('⏳ _Gathering system info..._', { parse_mode: 'Markdown' });
    try {
      const mem = process.memoryUsage();
      const memUsedMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
      const memTotalMB = (mem.heapTotal / 1024 / 1024).toFixed(1);
      const uptimeMin  = Math.floor(process.uptime() / 60);
      const uptimeHr   = Math.floor(uptimeMin / 60);
      const cacheStats = CacheService.getStats();
      const [pending, processing, openTickets, sys] = await Promise.all([
        Order.countDocuments({ status: 'Pending' }),
        Order.countDocuments({ status: 'Processing' }),
        SupportTicket.countDocuments({ status: { $in: ['Open', 'InProgress'] }, isArchived: { $ne: true } }),
        SystemStatus.findOne({}),
      ]);
      const gatewayLines = (sys?.gateways || []).map((g) => {
        const icon = g.status === 'Online' ? '🟢' : g.status === 'Busy' ? '🟡' : '🔴';
        return `  ${icon} *${g.method}*: ${g.status}`;
      }).join('\n') || '  _No gateway config_';

      const text =
        `🔧 *System Status*\n\n` +
        `💾 Memory: *${memUsedMB} / ${memTotalMB} MB*\n` +
        `⏱ Uptime: *${uptimeHr}h ${uptimeMin % 60}m*\n` +
        `🖥 Node: ${process.version} | Platform: ${os.platform()}\n\n` +
        `🗃 *Cache* — ${cacheStats.keys} keys, ${cacheStats.hits} hits, ${cacheStats.misses} misses\n\n` +
        `📦 *Queue* — Pending: ${pending} | Processing: ${processing}\n` +
        `🎫 Open Tickets: ${openTickets}\n` +
        `🛡 Maintenance: ${sys?.maintenanceMode ? '🔴 ON' : '🟢 OFF'}\n\n` +
        `💳 *Gateways:*\n${gatewayLines}\n\n` +
        `_Commands: /sysinfo /runbackup /runcron /flushcache /checkhealth_`;

      await ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('🔄 Refresh',     'sysinfo_refresh'),
            Markup.button.callback('🗃 Flush Cache',  'sysinfo_flush_cache'),
          ],
          [
            Markup.button.callback('🗄 Run Backup',   'sysinfo_backup'),
            Markup.button.callback('🔧 Run Cron',     'sysinfo_cron'),
          ],
        ]),
      });
    } catch (err) {
      console.error('[Admin] System view failed:', err);
      await ctx.telegram.editMessageText(wait.chat.id, wait.message_id, undefined, `❌ ${err.message}`).catch(() => {});
    }
  });

  // 🤖 AI Insights wiring — forecast / sentiment / syshealth proxies
  bot.action('ai_forecast_run', requireRole('MANAGER'), async (ctx) => {
    await ctx.answerCbQuery('Generating forecast…');
    const wait = await ctx.reply('🔮 _Analyzing 90 days of data… (~20s)_', { parse_mode: 'Markdown' });
    try {
      const AIInsightsService = require('../services/AIInsightsService');
      const historicalTrend = await AnalyticsService.getHistoricalTrend(90);
      if (historicalTrend.length < 7) {
        await ctx.telegram.editMessageText(wait.chat.id, wait.message_id, undefined,
          `⚠️ Not enough data for forecasting. Need ≥ 7 days of order history.`).catch(() => {});
        return;
      }
      const forecast = await AIInsightsService.generateSalesForecast(historicalTrend);
      await ctx.telegram.deleteMessage(wait.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(
        `🔮 *7-Day Sales Forecast*\n_Based on ${historicalTrend.length} days of history_\n\n${forecast}`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error('[Admin] Forecast failed:', err);
      await ctx.telegram.editMessageText(wait.chat.id, wait.message_id, undefined, `❌ ${err.message}`)
        .catch(() => ctx.reply(`❌ ${err.message}`));
    }
  });

  bot.action('ai_sentiment_run', requireRole('MANAGER'), async (ctx) => {
    await ctx.answerCbQuery('Loading sentiment report…');
    await ctx.reply('💬 _Use /sentimentreport for the full sentiment analysis._', { parse_mode: 'Markdown' });
  });

  bot.action('ai_syshealth_run', requireRole('MANAGER'), async (ctx) => {
    await ctx.answerCbQuery('Loading system health…');
    await ctx.reply('❤️ _Use /systemhealth for full gateway + system status._', { parse_mode: 'Markdown' });
  });

  // 📖 Admin Guide → comprehensive usage guide
  bot.hears('📖 Admin Guide', adminOnly(), async (ctx) => {
    const part1 =
      `📖 *Admin Panel Guide — Mental Gaming Store*\n` +
      `_3-tier RBAC: Owner / Manager / Staff_\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +

      `📊 *Dashboard* _(Manager+)_\n` +
      `Live stats — pending orders, active products, total users + gateway status panel.\n\n` +

      `📦 *Manage Orders* _(Staff+)_\n` +
      `• Pending list ပြ — Game ID, Customer, Amount\n` +
      `• 🔄 Processing → customer notify auto\n` +
      `• ✅ Complete → delivery receipt ပို့\n` +
      `• ❌ Cancel & Refund → wallet refund + reason\n` +
      `• Stale order alerts (default 30min)\n\n` +

      `🛍️ *Manage Products* _(Manager+)_\n` +
      `• /addproduct /editproduct /deleteproduct /toggleproduct\n` +
      `• Stock management (unlimited or count)\n` +
      `• /addcodes — digital gift card codes\n` +
      `• /flashsale — schedule flash sales\n\n` +

      `👥 *Manage Users* _(Owner)_\n` +
      `• /users <name|id> — search\n` +
      `• /userinfo /ban /unban /warn /unwarn\n` +
      `• /restrict (order/topup/spin) /unrestrict\n` +
      `• /adjustbal — manual credit/debit + audit\n` +
      `• /penalize — fraud penalty\n\n` +

      `💱 *Manage Rates* _(Manager+)_\n` +
      `• /rates — view current\n` +
      `• /fetchrates — live USD/CNY/THB fetch\n` +
      `• /managerates — bulk approve + per-product edit\n\n` +

      `📢 *Broadcast* _(Owner)_\n` +
      `• All / Tier-specific / Active (last 30d)\n` +
      `• Text + image, schedule + audit log\n\n` +

      `🎟 *Promotions* _(Owner)_\n` +
      `• /createpromo — Flat/Percent discount, min order, max uses, expiry\n` +
      `• /listpromos /deletepromo`;

    const part2 =
      `🎫 *Support Tickets* _(Staff+)_\n` +
      `• /tickets — Open + InProgress queue\n` +
      `• /tickets all — include resolved/archived\n` +
      `• Reply / Resolve / Assign / Archive / Urgent\n` +
      `• 📜 Template library — quick reply\n` +
      `• Negative sentiment auto-flag\n\n` +

      `📈 *Analytics* _(Manager+)_\n` +
      `• /analytics [today|yesterday|week|month] — revenue/profit dashboard\n` +
      `• /analyticsai — 🤖 Gemini business report\n` +
      `• /forecast — 7-day AI sales forecast\n` +
      `• /sentimentreport — customer review sentiment\n` +
      `• /exportdetail — CSV export (orders/transactions/users)\n\n` +

      `🎰 *Spin & Referral* _(Owner)_\n` +
      `• /setreftiers 1:2 6:3 16:5 — commission tiers\n` +
      `• /reftiers — view current tiers\n` +
      `• /togglereferral — pause/resume\n` +
      `• /reffraud — fraud review\n\n` +

      `📋 *Audit Logs* _(Manager+)_\n` +
      `• Every admin action logged: who/what/when\n` +
      `• Order status changes, balance adjustments, broadcasts\n\n` +

      `🔧 *System* _(Owner)_\n` +
      `• /sysinfo — memory, CPU, DB, cache, pending\n` +
      `• /runbackup — manual AES-256 encrypted DB backup\n` +
      `• /runcron — manual cron (archive/purge/audit)\n` +
      `• /flushcache — clear in-memory cache\n` +
      `• /systemhealth — gateway + system status\n` +
      `• /checkhealth — 50-op load test\n` +
      `• /setgateway <method> <Online|Busy|Offline>\n` +
      `• /setbackupchan — backup destination channel\n` +
      `• /setstalesupport <min> — stale order threshold\n\n` +

      `🤖 *Auto-Systems* (24/7 background)\n` +
      `• CronService — Daily 3AM MMT (archive, promo deactivate, screenshots)\n` +
      `• BackupService — Daily 6AM MMT, AES-256 → channel\n` +
      `• FlashSaleWatcher — auto start/stop sales\n` +
      `• FeedbackWatcher — collect reviews after delivery\n` +
      `• SentimentService — AI batch analysis + negative alerts\n` +
      `• AntiSpam — rate limiting per user\n` +
      `• Error Handler — crash → owner DM (5min cooldown)\n\n` +

      `🏗 *Architecture*\n` +
      `Telegraf 4.16 + Mongoose 8.x (MongoDB Atlas)\n` +
      `Gemini 2.0 Flash — AI support + analytics + sentiment\n` +
      `Cache — currency 15min, products 5min\n` +
      `3-role RBAC + full audit trail\n\n` +
      `_Tap any reply-keyboard button below to start._`;

    await ctx.reply(part1, { parse_mode: 'Markdown' });
    await ctx.reply(part2, { parse_mode: 'Markdown' });
  });

  // 🔙 Back to Main → switch reply keyboard back to user main menu
  bot.hears('🔙 Back to Main', async (ctx) => {
    await ctx.reply('🏠 Back to main menu.', mainMenuKeyboard());
  });

  // ── Admin inline nav action handlers ──────────────────────────────────────

  bot.action('admin_dashboard_action', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery('Loading...');
    const [totalUsers, pending, processing, success, todayOrders] = await Promise.all([
      User.countDocuments({}),
      Order.countDocuments({ status: 'Pending' }),
      Order.countDocuments({ status: 'Processing' }),
      Order.countDocuments({ status: 'Success' }),
      Order.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
    ]);
    await ctx.reply(
      `📊 *Quick Dashboard*\n\n` +
      `👥 Total Users: *${totalUsers}*\n` +
      `🟡 Pending Orders: *${pending}*\n` +
      `🔵 Processing: *${processing}*\n` +
      `✅ Completed: *${success}*\n` +
      `📅 Today's Orders: *${todayOrders}*\n\n` +
      `_For full stats, use /dashboard_`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Refresh', 'dashboard_refresh')],
          [Markup.button.callback('🔙 Back', 'nav:go:admin_main')],
        ]),
      }
    );
  });

  bot.action('admin_orders_action', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const pending    = await Order.countDocuments({ status: 'Pending' });
    const processing = await Order.countDocuments({ status: 'Processing' });
    await ctx.reply(
      `📦 *Order Management*\n\n🟡 Pending: *${pending}*\n🔵 Processing: *${processing}*`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🟡 View Pending',  'admin_pending_orders')],
          [Markup.button.callback('📋 All Orders',    'admin_all_orders')],
          [Markup.button.callback('🔙 Back',          'nav:go:admin_main')],
        ]),
      }
    );
  });

  bot.action('admin_products_action', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const [total, active] = await Promise.all([
      Product.countDocuments({}),
      Product.countDocuments({ isActive: true }),
    ]);
    await ctx.reply(
      `🛍️ *Product Management*\n\n✅ Active: *${active}*\n🔴 Inactive: *${total - active}*\n📦 Total: *${total}*`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📋 List Products', 'pm_list_products')],
          [Markup.button.callback('➕ Add Product',   'admin_product_add')],
          [Markup.button.callback('💱 Update Rates',  'open_rate_manager')],
          [Markup.button.callback('🔙 Back',          'nav:go:admin_main')],
        ]),
      }
    );
  });

  bot.action('admin_users_action', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(`👥 *User Management*\n\nChoose an action:`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📋 All Users',    'users_page:1')],
        [Markup.button.callback('🚫 Banned',       'users_banned'), Markup.button.callback('⚠️ Warned', 'users_warned')],
        [Markup.button.callback('📊 Stats',        'users_stats')],
        [Markup.button.callback('🔙 Back',         'nav:go:admin_main')],
      ]),
    });
  });

  bot.action('admin_promos_action', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const promos = await Promo.find().sort({ createdAt: -1 }).limit(20);
    if (!promos.length) {
      return ctx.reply(
        `🎟 *Promo Codes*\n\nNo promo codes yet.\n\nTo create one, use the \`/createpromo\` command.\nExample: \`/createpromo SAVE10 Percentage 10 100\``,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'nav:go:admin_main')]]),
        }
      );
    }
    const lines = promos.map((p) => {
      const disc = p.discountType === 'Flat' ? `${p.value.toLocaleString()} KS` : `${p.value}%`;
      const uses = p.maxUses ? `${p.currentUses}/${p.maxUses}` : `${p.currentUses}/∞`;
      return `${p.isActive ? '🟢' : '🔴'} \`${p.code}\` — ${disc} off — ${uses} uses`;
    });
    const deleteButtons = promos
      .filter((p) => p.isActive)
      .slice(0, 5)
      .map((p) => [Markup.button.callback(`🗑 ${p.code}`, `admin_promo_del:${p.code}`)]);
    await ctx.reply(
      `🎟 *Promo Codes (${promos.length})*\n\n${lines.join('\n')}\n\n_Create new: /createpromo_`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          ...deleteButtons,
          [Markup.button.callback('🔙 Back', 'nav:go:admin_main')],
        ]),
      }
    );
  });

  bot.action(/^admin_promo_del:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery('Deactivating...');
    const code = ctx.match[1].toUpperCase();
    const result = await Promo.findOneAndUpdate({ code }, { isActive: false }, { new: true });
    if (!result) return ctx.reply(`❌ Promo \`${code}\` not found.`, { parse_mode: 'Markdown' });
    await auditLog(ctx.from.id, 'PROMO_DEACTIVATED', null, 'Promo', { code });
    await ctx.reply(`✅ Promo \`${code}\` deactivated.`, { parse_mode: 'Markdown' });
  });

  bot.action('admin_rates_action', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('rate_manager');
  });

  bot.action('admin_broadcast_action', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('broadcast_scene');
  });

  bot.action('admin_audit_action', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(10);
    if (!logs.length) return ctx.reply('📋 No audit log entries yet.', {
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'nav:go:admin_main')]]),
    });
    const lines = logs.map((l, i) => {
      const ts = new Date(l.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Rangoon' });
      const target = l.targetId ? ` → \`${l.targetId}\`` : '';
      return `${i + 1}\\. \`${l.action}\`${target}\n   _${ts} MMT_`;
    });
    await ctx.reply(`📋 *Recent Audit Logs*\n\n${lines.join('\n\n')}`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', 'audit_refresh'), Markup.button.callback('🔙 Back', 'nav:go:admin_main')],
      ]),
    });
  });

  bot.action('admin_user_view', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery('Switching to user view...');
    await Nav.navigate(ctx, 'main', true);
  });

  // ── Product list with manage buttons ──────────────────────────────────────

  bot.action('pm_list_products', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const products = await Product.find().sort({ isActive: -1, category: 1 }).limit(15);
    if (!products.length) {
      return ctx.reply('🛍️ No products found. Use "Add Product" to create one.', {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ Add Product', 'admin_product_add')],
          [Markup.button.callback('🔙 Back', 'admin_products_action')],
        ]),
      });
    }
    const rows = products.map((p) => [
      Markup.button.callback(
        `${p.isActive ? '✅' : '🔴'} ${p.name} — ${p.finalPrice?.toLocaleString() || '?'} KS`,
        `ap_view:${p._id}`
      ),
    ]);
    rows.push([
      Markup.button.callback('➕ Add Product', 'admin_product_add'),
      Markup.button.callback('🔙 Back', 'admin_products_action'),
    ]);
    await ctx.reply(`🛍️ *Products (${products.length})*\n\nTap a product to manage:`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(rows),
    });
  });

  bot.action(/^ap_view:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const p = await Product.findById(ctx.match[1]);
    if (!p) return ctx.reply('❌ Product not found.');
    await ctx.reply(
      `📦 *${p.name}*\n\n` +
      `📁 Category: ${p.category}\n` +
      `🌍 Region: ${p.region}\n` +
      `💰 Price: ${price(p.finalPrice)}\n` +
      `📦 Stock: ${p.stockCount === -1 ? '∞ Unlimited' : p.stockCount}\n` +
      `Status: ${p.isActive ? '✅ Active' : '🔴 Inactive'}\n` +
      (p.description ? `📝 ${p.description}` : ''),
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(p.isActive ? '🔴 Deactivate' : '✅ Activate', `ap_toggle:${p._id}`)],
          [Markup.button.callback('🗑 Delete', `ap_delete_ask:${p._id}`)],
          [Markup.button.callback('🔙 Products List', 'pm_list_products')],
        ]),
      }
    );
  });

  // ── User management actions ────────────────────────────────────────────────
  bot.action('users_banned', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const { users, total } = await listUsers({ filter: { isBlocked: true }, limit: 10 });
    if (!total) return ctx.reply('✅ No banned users.');
    const lines = users.map((u) => `• \`${u.telegramId}\` ${u.username ? `@${u.username}` : '—'}`);
    await ctx.reply(`🚫 *Banned Users (${total})*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  });

  bot.action('users_warned', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const { users, total } = await listUsers({ filter: { warningsCount: { $gt: 0 } }, limit: 10 });
    if (!total) return ctx.reply('✅ No users with warnings.');
    const lines = users.map((u) => `• \`${u.telegramId}\` ${u.username ? `@${u.username}` : '—'} — ⚠️ ${u.warningsCount}/3`);
    await ctx.reply(`⚠️ *Warned Users (${total})*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  });

  bot.action('users_stats', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const [total, banned, warned, gold, platinum] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isBlocked: true }),
      User.countDocuments({ warningsCount: { $gt: 0 } }),
      User.countDocuments({ membershipTier: 'Gold' }),
      User.countDocuments({ membershipTier: 'Platinum' }),
    ]);
    await ctx.reply(
      `📊 *User Statistics*\n\n` +
      `👥 Total: *${total}*\n` +
      `🟢 Active: *${total - banned}*\n` +
      `🚫 Banned: *${banned}*\n` +
      `⚠️ Warned: *${warned}*\n` +
      `──────────────\n` +
      `🥈 Silver: *${total - gold - platinum}*\n` +
      `🥇 Gold: *${gold}*\n` +
      `💎 Platinum: *${platinum}*`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Rate management ────────────────────────────────────────────────────────
  bot.command('managerates', adminOnly(), (ctx) => ctx.scene.enter('rate_manager'));

  bot.command('rates', adminOnly(), async (ctx) => {
    const rates = await getAllRates();
    if (!rates.length) return ctx.reply('No exchange rates yet. Use /managerates.');
    const lines = rates.map((r) => `• *${r.currencyCode}*: \`${parseFloat(r.rateToMMK.toFixed(4))}\` MMK  _(${r.source})_`);
    await ctx.reply(`💱 *Current Exchange Rates*\n\n${lines.join('\n')}`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('✏️ Update', 'open_rate_manager')]]),
    });
  });

  bot.action('open_rate_manager', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter('rate_manager');
  });

  bot.command('fetchrates', adminOnly(), async (ctx) => {
    const msg = await ctx.reply('⏳ Fetching live exchange rates...');
    try {
      const updates = await fetchLiveRates();
      const lines = updates.map((u) => `• *${u.code}*: \`${u.rateToMMK}\` MMK`).join('\n');
      await auditLog(ctx.from.id, 'FETCH_LIVE_RATES', null, 'Currency', { updates });
      await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
      await ctx.reply(`✅ *Live Rates Fetched*\n\n${lines}\n\n_Use /managerates → Approve All to apply._`, { parse_mode: 'Markdown' });
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  // ── Orders ─────────────────────────────────────────────────────────────────
  bot.action('admin_pending_orders', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const orders = await Order.find({ status: 'Pending' })
      .populate('userId', 'username telegramId')
      .populate('productId', 'name')
      .sort({ timestamp: -1 })
      .limit(10);
    if (!orders.length) return ctx.reply('✅ No pending orders!', {
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'admin_orders_action')]]),
    });
    const lines = orders.map((o, i) => {
      const user    = o.userId?.username ? `@${o.userId.username}` : `ID:${o.userId?.telegramId}`;
      const product = o.productId?.name || 'Unknown';
      return `${i + 1}\\. 🟡 ${user} — *${product}* — \`${price(o.amount)}\``;
    });
    await ctx.reply(`🟡 *Pending Orders (${orders.length})*\n\n${lines.join('\n')}`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'admin_orders_action')]]),
    });
  });

  bot.action('admin_all_orders', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const orders = await Order.find()
      .populate('userId', 'username telegramId')
      .populate('productId', 'name')
      .sort({ timestamp: -1 })
      .limit(10);
    if (!orders.length) return ctx.reply('📦 No orders found.');
    const lines = orders.map((o, i) => {
      const user    = o.userId?.username ? `@${o.userId.username}` : `ID:${o.userId?.telegramId}`;
      const product = o.productId?.name || 'Unknown';
      const icon    = o.status === 'Success' ? '✅' : o.status === 'Pending' ? '🟡' : o.status === 'Cancelled' ? '❌' : '🔵';
      return `${i + 1}\\. ${icon} ${user} — *${product}* — \`${price(o.amount)}\``;
    });
    await ctx.reply(`📦 *Recent Orders (${orders.length})*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
  });

  // ── Broadcast ──────────────────────────────────────────────────────────────
  bot.command('broadcast', adminOnly(), (ctx) => ctx.scene.enter('broadcast_scene'));

  // ── Audit log refresh ──────────────────────────────────────────────────────
  bot.action('audit_refresh', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery('Refreshing...');
    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(10);
    if (!logs.length) return ctx.editMessageText('📋 No audit log entries yet.').catch(() => ctx.reply('📋 No entries yet.'));
    const lines = logs.map((l, i) => {
      const ts = new Date(l.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Rangoon' });
      const target = l.targetId ? ` → \`${l.targetId}\`` : '';
      return `${i + 1}\\. \`${l.action}\`${target}\n   _${ts} MMT_`;
    });
    await ctx.editMessageText(`📋 *Recent Audit Logs*\n\n${lines.join('\n\n')}`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('🔄 Refresh', 'audit_refresh'), Markup.button.callback('🔙 Back', 'nav:go:admin_main')]]),
    }).catch(() => {});
  });

  // ── Manual price setter (from rate manager scene) ──────────────────────────
  bot.on('message', async (ctx, next) => {
    if (ctx.session?.rm_manual_product && ctx.message?.text) {
      const p = parseInt(ctx.message.text.trim(), 10);
      if (isNaN(p) || p <= 0) return ctx.reply('❌ Enter a positive integer.');
      const { setManualPrice } = require('../services/PriceCalculator');
      try {
        const product = await setManualPrice(ctx.session.rm_manual_product, p);
        await auditLog(ctx.from.id, 'SET_MANUAL_PRICE', product._id.toString(), 'Product', { price: p });
        ctx.session.rm_manual_product = null;
        return ctx.reply(
          `✅ *${product.name}* → \`${p.toLocaleString()} KS\` _(Manual mode)_`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        return ctx.reply(`❌ ${err.message}`);
      }
    }
    return next();
  });
};
