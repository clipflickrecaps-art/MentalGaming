const { Markup } = require('telegraf');
const { adminOnly } = require('../middlewares/adminCheck');
const Product = require('../models/Product');
const PaymentMethod = require('../models/PaymentMethod');
const GameConfig = require('../models/GameConfig');
const SystemStatus = require('../models/SystemStatus');
const { auditLog } = require('../services/logger');

function cancelKeyboard(back='admin_main') {
  return Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'admin_cancel')],[Markup.button.callback('🔙 Back', `nav:go:${back}`)]]);
}
function parseLine(line) { return line.split('|').map(x => x.trim()); }
function safeId(s) { return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40); }

async function showCategoryPanel(ctx) {
  const cats = (await Product.distinct('category')).sort();
  const rows = cats.map(c => [Markup.button.callback(`📁 ${c}`, `cat_view:${encodeURIComponent(c)}`)]);
  rows.push([Markup.button.callback('➕ Add Category', 'cat_add'), Markup.button.callback('📦 Bulk Add', 'prod_bulk_add')]);
  rows.push([Markup.button.callback('🔙 Products', 'admin_products_action')]);
  return ctx.reply(`📁 *Category Manager*\n\n${cats.length ? cats.map(c=>'• '+c).join('\n') : 'No categories yet.'}`, {parse_mode:'Markdown', ...Markup.inlineKeyboard(rows)});
}

async function showPaymentPanel(ctx) {
  const methods = await PaymentMethod.find().sort({ displayOrder: 1, name: 1 });
  const rows = methods.map(m => [Markup.button.callback(`${m.isActive?'🟢':'🔴'} ${m.emoji || '💳'} ${m.name}`, `pay_view:${m._id}`)]);
  rows.push([Markup.button.callback('➕ Add Payment Method', 'pay_add')]);
  rows.push([Markup.button.callback('🔙 Admin Panel', 'nav:go:admin_main')]);
  const lines = methods.length ? methods.map((m,i)=>`${i+1}. ${m.emoji||'💳'} *${m.name}* — \`${m.accountNumber}\` — ${m.isActive?'🟢':'🔴'}`).join('\n') : 'No payment methods yet.';
  return ctx.reply(`💳 *Payment Methods*\n\n${lines}`, {parse_mode:'Markdown', ...Markup.inlineKeyboard(rows)});
}

async function showSpinPanel(ctx) {
  const cfg = await GameConfig.get();
  const prizes = cfg.spinPrizes?.length ? cfg.spinPrizes : [
    { label: '🎉 Thank You!', type:'none', value:0, weight:cfg.spinWeightThanks },
    { label: '🪙 50 Mental Coins', type:'coin', value:50, weight:cfg.spinWeightCoins50 },
    { label: '🪙 200 Coins', type:'coin', value:200, weight:cfg.spinWeightCoins200 },
    { label: '🪙 500 Coins', type:'coin', value:500, weight:cfg.spinWeightCoins500 },
    { label: '💰 1,000 KS', type:'ks', value:1000, weight:cfg.spinWeightKS1000 },
    { label: '💰 5,000 KS', type:'ks', value:5000, weight:cfg.spinWeightKS5000 },
    { label: '🎰 Free Spin!', type:'spin', value:1, weight:cfg.spinWeightFreeSpin },
  ];
  const lines = prizes.map((p,i)=>`${i+1}. ${p.label} — ${p.type}:${p.value} — weight ${p.weight}`).join('\n');
  return ctx.reply(`🎰 *Spin Rewards*\n\nCost: *${cfg.spinCostCoins} MC*\n${lines}\n\nFormat for custom prizes:\n\`Label | type | value | weight\`\nType = none / coin / ks / spin`, {parse_mode:'Markdown', ...Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Set Custom Prize List', 'spin_custom_set')],
    [Markup.button.callback('💸 Set Spin Cost', 'spin_cost_set'), Markup.button.callback('♻️ Reset Default', 'spin_reset_default')],
    [Markup.button.callback('🔙 Admin Panel', 'nav:go:admin_main')]
  ])});
}

async function showCheckInPanel(ctx) {
  const cfg = await GameConfig.get();
  const fallback = [
    {coins:10,ks:0,label:'Day 1'}, {coins:15,ks:0,label:'Day 2'}, {coins:25,ks:0,label:'Day 3'},
    {coins:40,ks:0,label:'Day 4'}, {coins:60,ks:0,label:'Day 5'}, {coins:90,ks:0,label:'Day 6'}, {coins:150,ks:100,label:'Day 7 🎉'}
  ];
  const rewards = cfg.checkInRewards?.length ? cfg.checkInRewards : fallback;
  const lines = rewards.map((r,i)=>`${i+1}. ${r.label || 'Day '+(i+1)} — ${r.coins||0} MC + ${r.ks||0} KS`).join('\n');
  return ctx.reply(`🗓 *Check-In Rewards*\n\n${lines}\n\nFormat:\n\`Day label | coins | ks\`\nNeed 7 lines.`, {parse_mode:'Markdown', ...Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Edit Rewards', 'checkin_rewards_set')],
    [Markup.button.callback('♻️ Reset Default', 'checkin_rewards_reset')],
    [Markup.button.callback('🔙 Admin Panel', 'nav:go:admin_main')]
  ])});
}

async function showChannelsPanel(ctx) {
  const st = await SystemStatus.get();
  return ctx.reply(`📢 *Channel Settings*\n\nAnnouncement: \`${st.announcementChannelId || 'not set'}\`\nFeedback/Review: \`${st.feedbackChannelId || 'not set'}\`\nBackup: \`${st.backupChannelId || 'not set'}\`\n\nSend channel as @username or -100xxxxxxxxxx`, {parse_mode:'Markdown', ...Markup.inlineKeyboard([
    [Markup.button.callback('📣 Set Announcement', 'chan_set:announcementChannelId')],
    [Markup.button.callback('⭐ Set Feedback', 'chan_set:feedbackChannelId')],
    [Markup.button.callback('🗄 Set Backup', 'chan_set:backupChannelId')],
    [Markup.button.callback('🔙 Admin Panel', 'nav:go:admin_main')]
  ])});
}

module.exports = function registerAdminFullFix(bot) {
  bot.action('admin_cancel', adminOnly(), async (ctx)=>{ ctx.session.adminFlow=null; await ctx.answerCbQuery('Cancelled'); await ctx.reply('❌ Cancelled.', { ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Admin Panel','nav:go:admin_main')]]) }); });

  bot.action('cat_manager', adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); return showCategoryPanel(ctx); });
  bot.action('prod_bulk_add', adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); ctx.session.adminFlow={type:'bulk_products'}; return ctx.reply('📦 *Bulk Add Products*\n\nSend one product per line:\n`Category | Name | Region | Currency | BaseCost | FinalPrice | Stock`\n\nExample:\n`ML Diamonds | 86 Diamonds | Myanmar | MMK | 2500 | 3000 | -1`', {parse_mode:'Markdown', ...cancelKeyboard('admin_main')}); });
  bot.action('cat_add', adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); ctx.session.adminFlow={type:'cat_add'}; return ctx.reply('➕ Send new category name.', cancelKeyboard('admin_main')); });
  bot.action(/^cat_view:(.+)$/, adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); const cat=decodeURIComponent(ctx.match[1]); const count=await Product.countDocuments({category:cat}); return ctx.reply(`📁 *${cat}*\nProducts: *${count}*`, {parse_mode:'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('✏️ Rename',`cat_rename:${encodeURIComponent(cat)}`), Markup.button.callback('🗑 Delete',`cat_delete:${encodeURIComponent(cat)}`)],[Markup.button.callback('🔙 Categories','cat_manager')]])}); });
  bot.action(/^cat_rename:(.+)$/, adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); ctx.session.adminFlow={type:'cat_rename', old:decodeURIComponent(ctx.match[1])}; return ctx.reply('✏️ Send new category name.', cancelKeyboard('admin_main')); });
  bot.action(/^cat_delete:(.+)$/, adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); const cat=decodeURIComponent(ctx.match[1]); await Product.updateMany({category:cat}, {$set:{isActive:false, category:`${cat} (Deleted)`}}); await auditLog(ctx.from.id,'CATEGORY_DELETED',cat,'ProductCategory'); return ctx.reply(`🗑 Category disabled: ${cat}`, { ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Categories','cat_manager')]]) }); });

  bot.action('admin_payments_full', adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); return showPaymentPanel(ctx); });
  bot.action('pay_add', adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); ctx.session.adminFlow={type:'pay_add'}; return ctx.reply('➕ *Add Payment Method*\n\nSend:\n`Name | SHORTCODE | Account Name | Account Number | Emoji | Instructions`\n\nExample:\n`KBZ Pay | KPAY | Mental Gaming | 09xxxx | 💙 | Transfer exact amount and upload screenshot`', {parse_mode:'Markdown', ...cancelKeyboard('admin_main')}); });
  bot.action(/^pay_view:(.+)$/, adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); const m=await PaymentMethod.findById(ctx.match[1]); if(!m) return ctx.reply('Not found'); return ctx.reply(`💳 *${m.name}*\n\nCode: ${m.shortCode}\nName: ${m.accountName}\nNo: \`${m.accountNumber}\`\n${m.instructions || ''}`, {parse_mode:'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback(m.isActive?'🔴 Disable':'🟢 Enable',`pay_toggle:${m._id}`), Markup.button.callback('🗑 Delete',`pay_del:${m._id}`)],[Markup.button.callback('🔙 Payments','admin_payments_full')]])}); });
  bot.action(/^pay_toggle:(.+)$/, adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); const m=await PaymentMethod.findById(ctx.match[1]); if(m){m.isActive=!m.isActive; await m.save();} return showPaymentPanel(ctx); });
  bot.action(/^pay_del:(.+)$/, adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); await PaymentMethod.findByIdAndDelete(ctx.match[1]); return showPaymentPanel(ctx); });

  bot.action('admin_spin_full', adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); return showSpinPanel(ctx); });
  bot.action('spin_custom_set', adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); ctx.session.adminFlow={type:'spin_prizes'}; return ctx.reply('🎰 Send custom spin prizes. One per line:\n`Label | type | value | weight`\nExample:\n`🪙 100 Coins | coin | 100 | 20`', {parse_mode:'Markdown', ...cancelKeyboard('admin_main')}); });
  bot.action('spin_cost_set', adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); ctx.session.adminFlow={type:'spin_cost'}; return ctx.reply('💸 Send new spin cost in Mental Coins.', cancelKeyboard('admin_main')); });
  bot.action('spin_reset_default', adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); await GameConfig.set({spinPrizes:[]}); return ctx.reply('♻️ Spin rewards reset to default.', { ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Spin Rewards','admin_spin_full')]])}); });

  bot.action('admin_checkin_full', adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); return showCheckInPanel(ctx); });
  bot.action('checkin_rewards_set', adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); ctx.session.adminFlow={type:'checkin_rewards'}; return ctx.reply('🗓 Send 7 reward lines:\n`Day label | coins | ks`\nExample:\n`Day 1 | 20 | 0`', {parse_mode:'Markdown', ...cancelKeyboard('admin_main')}); });
  bot.action('checkin_rewards_reset', adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); await GameConfig.set({checkInRewards:[]}); return ctx.reply('♻️ Check-in rewards reset to default.', { ...Markup.inlineKeyboard([[Markup.button.callback('🔙 Check-In','admin_checkin_full')]])}); });

  bot.action('admin_channels_full', adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); return showChannelsPanel(ctx); });
  bot.action(/^chan_set:(.+)$/, adminOnly(), async (ctx)=>{ await ctx.answerCbQuery(); ctx.session.adminFlow={type:'channel_set', field:ctx.match[1]}; return ctx.reply('📢 Send channel @username or numeric ID.', cancelKeyboard('admin_main')); });

  bot.on('text', async (ctx, next) => {
    const flow = ctx.session?.adminFlow;
    if (!flow) return next();
    const { config } = require('../../config/settings');
    if (Number(ctx.from?.id) !== Number(config.bot.adminId)) return next();
    const text = ctx.message.text.trim();
    if (!text || text === '/cancel') { ctx.session.adminFlow=null; return ctx.reply('❌ Cancelled.'); }
    try {
      if (flow.type === 'cat_add') {
        await Product.create({ name:`${text} Sample`, category:text, region:'Myanmar', baseCurrency:'MMK', baseCost:0, finalPrice:1, stockCount:0, isActive:false, description:'Placeholder product. Edit or add real products.' });
        ctx.session.adminFlow=null; await auditLog(ctx.from.id,'CATEGORY_ADDED',text,'ProductCategory'); return ctx.reply(`✅ Category added: ${text}`);
      }
      if (flow.type === 'cat_rename') {
        const res = await Product.updateMany({category:flow.old}, {$set:{category:text}}); ctx.session.adminFlow=null; await auditLog(ctx.from.id,'CATEGORY_RENAMED',flow.old,'ProductCategory',{to:text}); return ctx.reply(`✅ Renamed ${flow.old} → ${text}\nUpdated: ${res.modifiedCount}`);
      }
      if (flow.type === 'bulk_products') {
        const docs=[]; for (const line of text.split('\n').filter(Boolean)) { const [category,name,region,currency,cost,finalPrice,stock]=parseLine(line); if(!category||!name) continue; docs.push({category,name,region:region||'Myanmar',baseCurrency:(currency||'MMK').toUpperCase(),baseCost:Number(cost||0),finalPrice:Number(finalPrice||cost||1),stockCount:Number(stock ?? -1),quantity:1,isActive:true}); }
        if(!docs.length) return ctx.reply('❌ No valid lines found.'); await Product.insertMany(docs); ctx.session.adminFlow=null; return ctx.reply(`✅ Added ${docs.length} products.`);
      }
      if (flow.type === 'pay_add') {
        const [name,shortCode,accountName,accountNumber,emoji,instructions]=parseLine(text); if(!name||!shortCode||!accountName||!accountNumber) return ctx.reply('❌ Missing fields. Use exact format.'); await PaymentMethod.create({name,shortCode,accountName,accountNumber,emoji:emoji||'💳',instructions:instructions||undefined}); ctx.session.adminFlow=null; return ctx.reply(`✅ Payment method added: ${name}`);
      }
      if (flow.type === 'spin_prizes') {
        const prizes=text.split('\n').filter(Boolean).map((line,i)=>{ const [label,type,value,weight]=parseLine(line); return {id:safeId(label)||`custom_${i}`,label,type:type||'none',value:Number(value||0),weight:Number(weight||1)}; }).filter(p=>p.label&&['none','coin','ks','spin'].includes(p.type)); if(!prizes.length) return ctx.reply('❌ No valid prizes.'); await GameConfig.set({spinPrizes:prizes}); ctx.session.adminFlow=null; return ctx.reply(`✅ Saved ${prizes.length} custom spin prizes.`);
      }
      if (flow.type === 'spin_cost') { const n=Number(text); if(!n||n<0) return ctx.reply('❌ Send a valid number.'); await GameConfig.set({spinCostCoins:n}); ctx.session.adminFlow=null; return ctx.reply(`✅ Spin cost set to ${n} MC.`); }
      if (flow.type === 'checkin_rewards') { const rewards=text.split('\n').filter(Boolean).map((line,i)=>{ const [label,coins,ks]=parseLine(line); return {label:label||`Day ${i+1}`,coins:Number(coins||0),ks:Number(ks||0)}; }); if(rewards.length!==7) return ctx.reply('❌ Need exactly 7 lines.'); await GameConfig.set({checkInRewards:rewards}); ctx.session.adminFlow=null; return ctx.reply('✅ Check-in rewards updated.'); }
      if (flow.type === 'channel_set') { await SystemStatus.set({[flow.field]: text}, ctx.from.id); ctx.session.adminFlow=null; return ctx.reply(`✅ Channel saved: ${flow.field} = ${text}`); }
    } catch(e) { return ctx.reply(`❌ ${e.message}`); }
  });
};
