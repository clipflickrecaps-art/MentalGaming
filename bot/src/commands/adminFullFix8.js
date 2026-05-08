const { Markup } = require('telegraf');
const { adminOnly } = require('../middlewares/adminCheck');
const Product = require('../models/Product');
const GameConfig = require('../models/GameConfig');
const User = require('../models/User');
const PaymentMethod = require('../models/PaymentMethod');
const Channel = require('../models/Channel');
const ChannelRewardClaim = require('../models/ChannelRewardClaim');
const ChannelAutoPost = require('../models/ChannelAutoPost');
const Promo = require('../models/Promo');
const Order = require('../models/Order');
const AuditLog = require('../models/AuditLog');
const SystemStatus = require('../models/SystemStatus');
const { auditLog } = require('../services/logger');

const ADMIN_MAIN = [
  ['📊 Dashboard', '📦 Manage Orders'],
  ['🛍️ Manage Products', '👥 Manage Users'],
  ['🎰 Spin Rewards', '💳 Payments'],
  ['📢 Channel Settings', '🗓 Check-In'],
  ['🎟 Coupon Manager', '🗓 Auto Channel Posts'],
  ['📁 Categories', '🏠 Admin Menu']
];
const ADMIN_PRODUCTS = [
  ['➕ Add Product', '📦 Bulk Add Products'],
  ['📁 Manage Folders', '📂 Manage Categories'],
  ['🧮 Price Calculator', '📋 Product List'],
  ['🧾 Required Fields'],
  ['🔙 Back', '🏠 Admin Menu']
];
const PAYMENT_KB = [
  ['➕ Add Payment Method', '📋 Payment Methods'],
  ['✏️ Toggle Payment', '🗑 Delete Payment'],
  ['🔙 Back', '🏠 Admin Menu']
];
const CHANNEL_KB = [
  ['➕ Add Channel', '📋 Channel List'],
  ['✏️ Edit Channel', '👁 Toggle User Show'],
  ['🎁 Set Join Reward', '🗑 Delete Channel'],
  ['🗓 Auto Channel Posts', '🎟 Coupon Manager'],
  ['🔙 Back', '🏠 Admin Menu']
];
const BACK_CANCEL = [['🔙 Back', '❌ Cancel']];

const DEFAULT_CHANNELS = [
  { name: '⭐ Review Channel', channelId: '-1003857110880', type: 'review', showToUser: true, rewardType: 'none', joinRewardCoins: 0, displayOrder: 1 },
  { name: '📣 Announcement Channel', channelId: '-1003645289904', type: 'announcement', showToUser: true, rewardType: 'none', joinRewardCoins: 0, displayOrder: 2 },
  { name: '🎁 Promotion Channel', channelId: '-1000000000000', type: 'promotion', showToUser: false, rewardType: 'none', joinRewardCoins: 0, displayOrder: 3 },
];

function kb(rows){ return Markup.keyboard(rows).resize(); }
function safeId(s){ return String(s||'').trim().replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,48) || `P_${Date.now()}`; }
function money(n){ return Number(n||0).toLocaleString(); }
function prettyOrderInfoLabel(label = '', key = '') {
  const raw = `${label} ${key}`.toLowerCase();
  if (raw.includes('server') || raw.includes('zone')) return '🌐 Server ID';
  if (raw.includes('player') && raw.includes('name')) return '👤 Player Name';
  if (raw.includes('uid')) return '🆔 UID';
  if (raw.includes('email')) return '📧 Email';
  if (raw.includes('phone')) return '📱 Phone';
  if (raw.includes('game') || raw.includes('player') || raw.includes('id')) return '🆔 Game ID';
  return `📝 ${label || key || 'Info'}`;
}
function orderInfoBlock(order) {
  const lines = [];
  const seen = new Set();
  const add = (label, value, key = '') => {
    const cleanValue = String(value || '').trim();
    if (!cleanValue) return;
    const cleanLabel = prettyOrderInfoLabel(label, key);
    const sig = `${cleanLabel}:${cleanValue}`.toLowerCase();
    if (seen.has(sig)) return;
    seen.add(sig);
    lines.push(`${cleanLabel}: ${cleanValue}`);
  };
  if (Array.isArray(order.requiredInfo)) for (const x of order.requiredInfo) add(x?.label, x?.value, x?.key);
  add('Game ID', order.gameId, 'gameId');
  add('Server ID', order.zoneId, 'zoneId');
  return lines.join('\n');
}
function formatReward(c){
  const type = c.rewardType || (c.joinRewardCoins > 0 ? 'coin' : 'none');
  if (type === 'coin') return `🎁 ${c.rewardValue || c.joinRewardCoins || 0} MC`;
  if (type === 'wallet') return `🎁 ${c.rewardValue || 0} KS`;
  if (type === 'product') return `🎁 Product ${c.rewardProductCode || '-'}`;
  if (type === 'coupon') return `🎁 Coupon ${c.rewardCouponCode || c.rewardValue || ''}`;
  return '🎁 No reward';
}
function parseLine(line){ return String(line||'').split('|').map(x=>x.trim()); }
function getText(ctx){ return ctx.message?.text?.trim() || ''; }
function isCancel(t){ return ['❌ Cancel','/cancel','cancel'].includes(t); }
function isBack(t){ return ['🔙 Back','Back','back'].includes(t); }
function isAdminMenu(t){ return ['🏠 Admin Menu','/admin','🔧 Admin Panel'].includes(t); }

async function seedDefaultChannels() {
  for (const ch of DEFAULT_CHANNELS) await Channel.updateOne({ channelId: ch.channelId }, { $setOnInsert: ch }, { upsert: true });
}

async function showAdmin(ctx){
  ctx.session.adminFlow9 = null;
  return ctx.reply('🔧 *Admin Panel — Reply Keyboard Mode*\n\nInline UI အဟောင်းမသုံးတော့ပါ။ Button အားလုံး Reply Keyboard ဖြစ်ပါတယ်။', {parse_mode:'Markdown', ...kb(ADMIN_MAIN)});
}

async function showDashboard(ctx){
  const today = new Date(); today.setHours(0,0,0,0);
  const [pending, processing, users, activeProducts, ordersToday, payments, channels] = await Promise.all([
    Order.countDocuments({status:'Pending'}),
    Order.countDocuments({status:'Processing'}),
    User.countDocuments({}),
    Product.countDocuments({isActive:true}),
    Order.countDocuments({timestamp:{$gte:today}}),
    PaymentMethod.find().sort({displayOrder:1,name:1}).lean(),
    Channel.find({isActive:true}).sort({displayOrder:1,name:1}).lean(),
  ]);
  const payLines = payments.length
    ? payments.map((p,i)=>`${i+1}. ${p.emoji||'💳'} ${p.name} — ${p.isActive?'🟢 Online':'🔴 Offline'} — ${p.accountNumber||'-'}`).join('\n')
    : 'No payment methods configured.';
  const chLines = channels.length
    ? channels.map((c,i)=>`${i+1}. ${c.name} — ${c.showToUser?'👁 User':'🙈 Admin'} — ${formatReward(c)}`).join('\n')
    : 'No channels configured.';
  return ctx.reply(`📊 *Dashboard*\n\n🟡 Pending: *${pending}*\n🔵 Processing: *${processing}*\n🧾 Today Orders: *${ordersToday}*\n👥 Users: *${users}*\n🛍️ Active Products: *${activeProducts}*\n\n💳 *Payment Gateways*\n${payLines}\n\n📢 *Channels*\n${chLines}`, {parse_mode:'Markdown', ...kb(ADMIN_MAIN)});
}

async function showProducts(ctx){
  ctx.session.adminFlow9 = null;
  const [total, active] = await Promise.all([Product.countDocuments({}), Product.countDocuments({isActive:true})]);
  return ctx.reply(`🛍️ *Product Management*\n\n✅ Active: *${active}*\n📦 Total: *${total}*\n\nFolder → Category → Product flow နဲ့ထည့်နိုင်ပါတယ်။`, {parse_mode:'Markdown', ...kb(ADMIN_PRODUCTS)});
}

async function showFolders(ctx){
  const folders = await Product.distinct('mainFolder');
  return ctx.reply(`📁 *Folders*\n\n${folders.filter(Boolean).map((f,i)=>`${i+1}. ${f}`).join('\n') || 'No folders yet.'}\n\nCommands:\n• Add: \`add FolderName\`\n• Rename: \`rename Old | New\`\n• Delete: \`delete FolderName\``, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
}
async function showCategories(ctx, folder){
  const filter = folder ? {mainFolder:folder} : {};
  const cats = await Product.distinct('category', filter);
  return ctx.reply(`📂 *Categories*${folder?` — ${folder}`:''}\n\n${cats.filter(Boolean).map((c,i)=>`${i+1}. ${c}`).join('\n') || 'No categories yet.'}\n\nCommands:\n• Add: \`add CategoryName\`\n• Rename: \`rename Old | New\`\n• Delete: \`delete CategoryName\``, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
}
async function folderListText(){
  const folders = (await Product.distinct('mainFolder')).filter(Boolean);
  return folders.length ? folders.map((f,i)=>`${i+1}. ${f}`).join('\n') : 'No folders yet. Type a new folder name.';
}
async function categoryListText(folder){
  const cats = (await Product.distinct('category', {mainFolder:folder})).filter(Boolean);
  return cats.length ? cats.map((c,i)=>`${i+1}. ${c}`).join('\n') : 'No categories yet. Type a new category name.';
}
async function selectByNumberOrName(list, input){
  const n = Number(input);
  if (Number.isInteger(n) && n >= 1 && n <= list.length) return list[n-1];
  return input;
}
function calcSuggested({buyPrice=0, extraCost=0, profit=0}){
  const base = Number(buyPrice||0) + Number(extraCost||0);
  return Math.ceil(base + Number(profit||0));
}
async function createProductFromParts({folder, category, parts}){
  const [name, p2, p3, p4, p5, p6] = parts;
  if (!name || !p2) throw new Error('Product name နဲ့ price လိုပါတယ်။');
  let buyPrice=0, extraCost=0, profit=0, finalPrice=0, pricingMode='Manual';
  if (parts.length === 2) {
    finalPrice = Number(p2);
    buyPrice = finalPrice;
  } else {
    buyPrice = Number(p2||0);
    extraCost = Number(p3||0);
    profit = Number(p4||0);
    pricingMode = String(p6||'manual').toLowerCase().startsWith('auto') ? 'Auto' : 'Manual';
    const suggested = calcSuggested({buyPrice, extraCost, profit});
    finalPrice = pricingMode === 'Auto' ? suggested : Number(p5||suggested);
  }
  if (Number.isNaN(finalPrice) || finalPrice < 0) throw new Error('Price မှားနေပါတယ်။');
  const productCode = safeId(`${folder}_${category}_${name}_${Date.now()}`);
  return Product.create({
    productCode,
    mainFolder: folder,
    category,
    name,
    region:'Myanmar',
    baseCurrency:'MMK',
    baseCost: Number(buyPrice||0),
    baseUnit: Number(extraCost||0),
    baseProfitKS: Number(profit||0),
    profitMode:'fixedUnit',
    profitMargin:0,
    suggestedPrice: calcSuggested({buyPrice, extraCost, profit}),
    finalPrice,
    pricingMode,
    stockCount:-1,
    quantity:1,
    isActive:true,
    description:`Buy: ${buyPrice} | Extra: ${extraCost} | Profit: ${profit} | Mode: ${pricingMode}`
  });
}

async function showSpin(ctx){
  ctx.session.adminFlow9 = null;
  const cfg = await GameConfig.get();
  const prizes = Array.isArray(cfg.spinPrizes) && cfg.spinPrizes.length ? cfg.spinPrizes : [];
  const lines = prizes.length ? prizes.map((p,i)=>`${i+1}. ${p.label} — ${p.type||'none'}:${p.value||0}`).join('\n') : 'No custom rewards yet.';
  return ctx.reply(`🎰 *Spin Rewards*\n\n${lines}\n\nUser side မှာ percentage/weight မပြပါ။`, {parse_mode:'Markdown', ...kb([['➕ Add Spin Reward','✏️ Replace Spin Rewards'],['💸 Set Spin Cost','🔙 Back'],['🏠 Admin Menu']])});
}

async function showUsers(ctx){
  ctx.session.adminFlow9 = {type:'user_find'};
  return ctx.reply('👥 *Manage Users*\n\nSend Telegram ID or username.\nExample: `123456789` or `username`', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
}
async function showUser(ctx,user){
  ctx.session.adminFlow9 = {type:'user_action', telegramId:String(user.telegramId)};
  const txt = `👤 *User Control*\n\n🆔 \`${user.telegramId}\`\n👤 @${user.username||'-'}\n💰 ${money(user.balanceKS)} KS | 🪙 ${money(user.balanceCoin)} MC\n⚠️ Warnings: *${user.warningsCount||0}*\n🚫 Banned: *${user.isBlocked?'YES':'NO'}*\n🔒 Rules: ${(user.restrictedRights||[]).join(', ')||'None'}\n\nUse buttons below.`;
  return ctx.reply(txt, {parse_mode:'Markdown', ...kb([['⚠️ + Warning','➖ Warning'],['🧹 Clear Warnings', user.isBlocked?'✅ Unban':'🚫 Ban'],['🔒 Edit Rules','🧹 Clear Restrictions'],['🔙 Back','🏠 Admin Menu']])});
}

async function showPayments(ctx){
  ctx.session.adminFlow9 = null;
  const methods = await PaymentMethod.find().sort({displayOrder:1,name:1}).lean();
  const lines = methods.length ? methods.map((m,i)=>`${i+1}. ${m.emoji||'💳'} *${m.name}* (${m.shortCode})\n   👤 ${m.accountName}\n   🔢 \`${m.accountNumber}\`\n   ${m.isActive?'🟢 Active':'🔴 Inactive'}`).join('\n\n') : 'No payment methods yet.';
  return ctx.reply(`💳 *Payment Methods*\n\n${lines}`, {parse_mode:'Markdown', ...kb(PAYMENT_KB)});
}

async function showChannelsAdmin(ctx){
  await seedDefaultChannels();
  ctx.session.adminFlow9 = null;
  const channels = await Channel.find().sort({displayOrder:1,name:1}).lean();
  const lines = channels.length ? channels.map((c,i)=>`${i+1}. ${c.name}\n   🆔 ${c.channelId}\n   Type: ${c.type} | ${c.isActive?'🟢 Active':'🔴 Inactive'} | ${c.showToUser?'👁 Show User':'🙈 Hide User'}\n   ${formatReward(c)}\n   🔗 ${c.link||'Link not set'}`).join('\n\n') : 'No channels yet.';
  return ctx.reply(`📢 *Channel Settings*\n\n${lines}\n\nUser side မှာ Show User = yes ဖြစ်တဲ့ channel တွေပဲ ပေါ်မယ်။`, {parse_mode:'Markdown', ...kb(CHANNEL_KB)});
}

async function showCheckInAdmin(ctx){
  ctx.session.adminFlow9 = null;
  const cfg = await GameConfig.get();
  const defaults = [
    {coins:10,ks:0,label:'Day 1'}, {coins:15,ks:0,label:'Day 2'}, {coins:25,ks:0,label:'Day 3'},
    {coins:40,ks:0,label:'Day 4'}, {coins:60,ks:0,label:'Day 5'}, {coins:90,ks:0,label:'Day 6'},
    {coins:150,ks:100,label:'Day 7 🎉'},
  ];
  const rewards = Array.isArray(cfg.checkInRewards) && cfg.checkInRewards.length >= 7 ? cfg.checkInRewards : defaults;
  const lines = rewards.slice(0,7).map((r,i)=>`${i+1}. ${r.label || `Day ${i+1}`} — ${Number(r.coins||0)} MC / ${Number(r.ks||0)} KS`).join('\n');
  return ctx.reply(`🗓 *7-Day Check-In Manager*\n\n${lines}\n\nပြင်ရန်: *✏️ Set 7-Day Rewards* ကိုနှိပ်ပါ။`, {parse_mode:'Markdown', ...kb([['✏️ Set 7-Day Rewards'], ['🔙 Back', '🏠 Admin Menu']])});
}

async function findChannelByInput(text){
  const channels = await Channel.find().sort({displayOrder:1,name:1});
  const n = Number(text);
  if (Number.isInteger(n) && n>=1 && n<=channels.length) return channels[n-1];
  return Channel.findOne({ $or: [{channelId:text}, {name:text}] });
}

async function productChoicesText() {
  const products = await Product.find({ isActive: true }).sort({ mainFolder: 1, category: 1, name: 1 }).limit(80).lean();
  return products.length
    ? products.map((p, i) => `${i + 1}. ${p.productCode || p._id} — [${p.mainFolder || 'General'} / ${p.category}] ${p.name}`).join('\n')
    : 'No active products.';
}
async function findProductByInput(input) {
  const products = await Product.find({ isActive: true }).sort({ mainFolder: 1, category: 1, name: 1 }).limit(200);
  const n = Number(input);
  if (Number.isInteger(n) && n >= 1 && n <= products.length) return products[n - 1];
  return Product.findOne({ $or: [{ productCode: input }, { name: input }] });
}
function parseRequiredFieldsText(text) {
  return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [labelRaw, requiredRaw, hintRaw] = parseLine(line);
    const label = labelRaw || 'Info';
    const key = label.toLowerCase().includes('server') ? 'serverId'
      : label.toLowerCase().includes('zone') ? 'zoneId'
      : label.toLowerCase().includes('uid') ? 'uid'
      : label.toLowerCase().includes('email') ? 'email'
      : label.toLowerCase().includes('phone') ? 'phone'
      : label.toLowerCase().includes('name') ? 'playerName'
      : label.toLowerCase().includes('id') ? 'gameId'
      : label.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0,32) || 'info';
    return { key, label, required: !String(requiredRaw || 'yes').toLowerCase().startsWith('no'), hint: hintRaw || '' };
  });
}

async function channelChoicesText(){
  const channels = await Channel.find().sort({displayOrder:1,name:1}).lean();
  return channels.length ? channels.map((c,i)=>`${i+1}. ${c.name} — ${c.channelId}`).join('\n') : 'No channels yet.';
}

module.exports = function registerAdminFullFix9(bot){
  bot.command('admin', adminOnly(), showAdmin);
  bot.command('admin2', adminOnly(), showAdmin);
  bot.command('dashboard', adminOnly(), showDashboard);
  bot.command('adminpanel', adminOnly(), showAdmin);
  bot.hears('🔧 Admin Panel', adminOnly(), showAdmin);
  bot.hears('🏠 Admin Menu', adminOnly(), showAdmin);
  bot.hears('📊 Dashboard', adminOnly(), showDashboard);
  bot.hears('🛍️ Manage Products', adminOnly(), showProducts);
  bot.hears('🎰 Spin Rewards', adminOnly(), showSpin);
  bot.hears('👥 Manage Users', adminOnly(), showUsers);
  bot.hears('💳 Payments', adminOnly(), showPayments);
  bot.hears('⬅️ Back to Payments', adminOnly(), showPayments);
  bot.hears('📢 Channel Settings', adminOnly(), showChannelsAdmin);
  bot.hears('📁 Categories', adminOnly(), async ctx=>{ ctx.session.adminFlow9={type:'categories',from:'products'}; return showCategories(ctx); });
  bot.hears('📦 Manage Orders', adminOnly(), async ctx=> {
    const orders = await Order.find({status:'Pending'}).populate('userId','username telegramId').populate('productId','name productType').sort({timestamp:-1}).limit(1);
    const actionKb = kb([['✅ Complete','🔄 Processing'], ['❌ Cancel & Refund'], ['💬 Message User','⚠️ Warn User'], ['📜 Use Template'], ['⬅️ Back to Orders','🏠 Admin Menu']]);
    if (!orders.length) return ctx.reply('✅ No pending orders right now.', kb([['🔄 Refresh Orders'], ['🏠 Admin Menu']]));
    const order = orders[0];
    ctx.session.adminSelectedOrderId = order._id.toString();
    const shortId = order._id.toString().slice(-8).toUpperCase();
    const user = order.userId?.username ? `@${order.userId.username}` : `ID: ${order.userId?.telegramId || 'N/A'}`;
    const info = orderInfoBlock(order);
    await ctx.reply(`🟡 *Pending Order*\n\n🆔 Order: \`${shortId}\`\n👤 Customer: ${user}\n📦 Product: ${order.productId?.name || 'Unknown'}\n🎮 Type: ${order.productType || order.productId?.productType || 'DirectTopup'}${info ? '\n'+info : ''}\n💰 Original: ${(order.originalAmount||order.amount||0).toLocaleString()} KS\n✨ Charged: *${(order.amount||0).toLocaleString()} KS*\n📊 Status: ${order.status}\n🕐 Placed: ${new Date(order.timestamp||order.createdAt).toLocaleString('en-GB',{timeZone:'Asia/Rangoon', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'})}`, {parse_mode:'Markdown', ...actionKb});
  });
  bot.hears('🗓 Check-In', adminOnly(), showCheckInAdmin);
  bot.hears('✏️ Set 7-Day Rewards', adminOnly(), async ctx=>{
    ctx.session.adminFlow9={type:'checkin_rewards_set',from:'checkin'};
    return ctx.reply('✏️ Send 7 lines, one per day:\n`Label | MC | KS`\n\nExample:\n`Day 1 | 10 | 0`\n`Day 2 | 15 | 0`\n...\n`Day 7 🎉 | 150 | 100`', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });

  bot.hears('🔙 Back', async (ctx,next)=>{
    const flow=ctx.session?.adminFlow9;
    if (!flow) return next();
    ctx.session.adminFlow9=null;
    if (flow.from === 'products' || ['add_product_folder','add_product_category','add_product_detail','bulk_folder','bulk_category','bulk_detail','folders','categories'].includes(flow.type)) return showProducts(ctx);
    if (flow.from === 'payments' || flow.type?.includes('payment')) return showPayments(ctx);
    if (flow.from === 'channels' || flow.type?.includes('channel')) return showChannelsAdmin(ctx);
    return showAdmin(ctx);
  });
  bot.hears('❌ Cancel', async (ctx,next)=>{
    if (!ctx.session?.adminFlow9) return next();
    ctx.session.adminFlow9=null;
    return ctx.reply('❌ Cancelled.', kb(ADMIN_MAIN));
  });

  // Product buttons
  bot.hears('📁 Manage Folders', adminOnly(), async ctx=>{ ctx.session.adminFlow9={type:'folders',from:'products'}; return showFolders(ctx); });
  bot.hears('📂 Manage Categories', adminOnly(), async ctx=>{ ctx.session.adminFlow9={type:'categories',from:'products'}; return showCategories(ctx); });
  bot.hears('📋 Product List', adminOnly(), async ctx=>{
    const products = await Product.find({isActive:true}).sort({mainFolder:1, category:1, name:1}).limit(30).lean();
    const lines = products.map((p,i)=>`${i+1}. [${p.mainFolder||'General'} / ${p.category}] ${p.name} — ${money(p.finalPrice)} KS`).join('\n') || 'No active products.';
    return ctx.reply(`📋 *Products*\n\n${lines}`, {parse_mode:'Markdown', ...kb(ADMIN_PRODUCTS)});
  });
  bot.hears('🧾 Required Fields', adminOnly(), async ctx=>{
    ctx.session.adminFlow9={type:'required_fields_select',from:'products'};
    return ctx.reply(`🧾 *Product Required Fields*

Choose product number/code/name:

${await productChoicesText()}`, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });
  bot.hears('🧮 Price Calculator', adminOnly(), async ctx=>{
    ctx.session.adminFlow9={type:'price_calc'};
    return ctx.reply('🧮 Send pricing line:\n`Buy Price | Extra Cost | Profit | optional Selling Price | auto/manual`\n\nExample:\n`1000 | 200 | 300 | | auto`\nor\n`1000 | 200 | 300 | 1800 | manual`', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });
  bot.hears('➕ Add Product', adminOnly(), async ctx=>{
    ctx.session.adminFlow9={type:'add_product_folder',from:'products'};
    return ctx.reply(`📁 Choose folder by number or type new folder name:\n\n${await folderListText()}`, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });
  bot.hears('📦 Bulk Add Products', adminOnly(), async ctx=>{
    ctx.session.adminFlow9={type:'bulk_folder',from:'products'};
    return ctx.reply(`📁 Choose folder first:\n\n${await folderListText()}`, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });

  // Spin buttons
  bot.hears('➕ Add Spin Reward', adminOnly(), async ctx=>{
    ctx.session.adminFlow9={type:'spin_reward_add'};
    return ctx.reply('➕ Send new spin reward:\n`Label | type | value | weight`\n\nTypes: `none`, `coin`, `ks`, `spin`\nExample: `🪙 100 MC | coin | 100 | 10`', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });
  bot.hears('✏️ Replace Spin Rewards', adminOnly(), async ctx=>{
    ctx.session.adminFlow9={type:'spin_replace'};
    return ctx.reply('✏️ Send rewards, one per line:\n`Label | type | value | weight`\n\nUser side မှာ percentage/weight မပြပါ။', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });
  bot.hears('💸 Set Spin Cost', adminOnly(), async ctx=>{ ctx.session.adminFlow9={type:'spin_cost'}; return ctx.reply('💸 Send spin cost in MC.', kb(BACK_CANCEL)); });

  // Payment buttons
  bot.hears('📋 Payment Methods', adminOnly(), showPayments);
  bot.hears('➕ Add Payment Method', adminOnly(), async ctx=>{
    ctx.session.adminFlow9={type:'payment_add',from:'payments'};
    return ctx.reply('➕ Send payment method:\n`Name | ShortCode | Account Name | Account Number | Emoji | Instructions`\n\nExample:\n`WaveMoney | WAVE | Mental Gaming | 09xxxxxxx | 🌊 | Send exact amount and upload screenshot`', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });
  bot.hears('✏️ Toggle Payment', adminOnly(), async ctx=>{
    ctx.session.adminFlow9={type:'payment_toggle',from:'payments'};
    const methods = await PaymentMethod.find().sort({displayOrder:1,name:1}).lean();
    return ctx.reply(`✏️ Send number/name to toggle active/offline:\n\n${methods.map((m,i)=>`${i+1}. ${m.name} — ${m.isActive?'🟢 Active':'🔴 Inactive'}`).join('\n') || 'No payment methods.'}`, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });
  bot.hears('🗑 Delete Payment', adminOnly(), async ctx=>{
    ctx.session.adminFlow9={type:'payment_delete',from:'payments'};
    const methods = await PaymentMethod.find().sort({displayOrder:1,name:1}).lean();
    return ctx.reply(`🗑 Send number/name to delete:\n\n${methods.map((m,i)=>`${i+1}. ${m.name}`).join('\n') || 'No payment methods.'}`, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });

  // Channel buttons
  bot.hears('📋 Channel List', adminOnly(), showChannelsAdmin);
  bot.hears('➕ Add Channel', adminOnly(), async ctx=>{
    ctx.session.adminFlow9={type:'channel_add',from:'channels'};
    return ctx.reply('➕ Send channel:\n`Name | Channel ID | Link | type | show yes/no | reward type | reward value/code`\n\nTypes: announcement, review, promotion, support, backup, other\nReward types: none, coin, wallet, product, coupon\nExamples:\n`Promo Channel | -100123 | https://t.me/yourchannel | promotion | yes | coupon | 5`\n`VIP Gift | -100123 | https://t.me/x | promotion | yes | product | MLBB_86`', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });
  bot.hears('✏️ Edit Channel', adminOnly(), async ctx=>{
    ctx.session.adminFlow9={type:'channel_edit_select',from:'channels'};
    return ctx.reply(`✏️ Choose channel number/name/id:\n\n${await channelChoicesText()}`, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });
  bot.hears('👁 Toggle User Show', adminOnly(), async ctx=>{
    ctx.session.adminFlow9={type:'channel_toggle_show',from:'channels'};
    return ctx.reply(`👁 Choose channel number/name/id to toggle user visibility:\n\n${await channelChoicesText()}`, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });
  bot.hears('🎁 Set Join Reward', adminOnly(), async ctx=>{
    ctx.session.adminFlow9={type:'channel_reward_select',from:'channels'};
    return ctx.reply(`🎁 Choose channel number/name/id:\n\n${await channelChoicesText()}`, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });
  bot.hears('🗑 Delete Channel', adminOnly(), async ctx=>{
    ctx.session.adminFlow9={type:'channel_delete',from:'channels'};
    return ctx.reply(`🗑 Choose channel number/name/id to deactivate:\n\n${await channelChoicesText()}`, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });


  bot.hears('🎟 Coupon Manager', adminOnly(), async ctx=>{
    ctx.session.adminFlow9={type:'coupon_add'};
    return ctx.reply(`🎟 Send coupon:
\`CODE | Flat/Percentage | value | maxUses | expiry YYYY-MM-DD or none | minOrder | maxDiscount | productCodes comma | folders comma | categories comma | tiers comma | newUser yes/no\`

Example:
\`ML5 | Percentage | 5 | 100 | none | 0 | 1000 | MLBB_86,MLBB_172 | Mobile Games | MLBB | Silver,Gold | no\``, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });
  bot.hears('🗓 Auto Channel Posts', adminOnly(), async ctx=>{
    ctx.session.adminFlow9={type:'autopost_add'};
    const channels = await channelChoicesText();
    return ctx.reply(`🗓 Auto Channel Posts

Choose channel + schedule format:
\`Channel number/name/id | postType | HH:MM | daily/weekly | optional custom text\`

Post types: about_bot, how_to_buy, features, daily_promo, top_products, reviews, custom

Channels:
${channels}`, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });



  bot.on('text', async (ctx,next)=>{
    const flow = ctx.session?.adminFlow9;
    if (!flow) return next();
    const text = getText(ctx);
    if (isCancel(text)) { ctx.session.adminFlow9=null; return ctx.reply('❌ Cancelled.', kb(ADMIN_MAIN)); }
    if (isAdminMenu(text)) { ctx.session.adminFlow9=null; return showAdmin(ctx); }
    if (isBack(text)) {
      ctx.session.adminFlow9=null;
      if (flow.from === 'payments' || flow.type?.includes('payment')) return showPayments(ctx);
      if (flow.from === 'channels' || flow.type?.includes('channel')) return showChannelsAdmin(ctx);
      if (flow.from === 'products') return showProducts(ctx);
      if (flow.from === 'checkin' || flow.type?.includes('checkin')) return showCheckInAdmin(ctx);
      return showAdmin(ctx);
    }
    try {
      // 7-day check-in rewards
      if (flow.type === 'checkin_rewards_set') {
        const rows = text.split('\n').map(x=>x.trim()).filter(Boolean).map((line,i)=>{
          const [label, coins, ks] = parseLine(line);
          return { label: label || `Day ${i+1}`, coins: Number(coins||0), ks: Number(ks||0) };
        });
        if (rows.length !== 7 || rows.some(r=>Number.isNaN(r.coins)||Number.isNaN(r.ks))) {
          return ctx.reply('❌ 7 lines လိုပါတယ်။ Format: `Label | MC | KS`', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
        }
        await GameConfig.set({ checkInRewards: rows });
        ctx.session.adminFlow9 = null;
        await auditLog(ctx.from.id,'CHECKIN_REWARDS_SET','global','GameConfig',{rows});
        return ctx.reply('✅ 7-Day Check-In rewards updated.', kb([['🗓 Check-In'], ['🏠 Admin Menu']]));
      }

      // Folder/category manager
      if (flow.type === 'folders') {
        const [cmd, rest] = text.split(/\s+(.+)/);
        if (cmd?.toLowerCase()==='add') { await Product.create({productCode:`FOLDER_${safeId(rest)}`, mainFolder:rest, category:'General', name:`${rest} Placeholder`, region:'Myanmar', baseCurrency:'MMK', baseCost:0, finalPrice:0, isActive:false}); await auditLog(ctx.from.id,'FOLDER_ADD',rest,'Product'); return showFolders(ctx); }
        if (cmd?.toLowerCase()==='rename') { const [oldName,newName]=parseLine(rest); await Product.updateMany({mainFolder:oldName}, {$set:{mainFolder:newName}}); await auditLog(ctx.from.id,'FOLDER_RENAME',oldName,'Product',{to:newName}); return showFolders(ctx); }
        if (cmd?.toLowerCase()==='delete') { await Product.updateMany({mainFolder:rest}, {$set:{isActive:false, mainFolder:`${rest} (Deleted)`}}); await auditLog(ctx.from.id,'FOLDER_DELETE',rest,'Product'); return showFolders(ctx); }
        return ctx.reply('❌ Use `add Name`, `rename Old | New`, or `delete Name`.', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
      }
      if (flow.type === 'categories') {
        const [cmd, rest] = text.split(/\s+(.+)/);
        if (cmd?.toLowerCase()==='add') { await Product.create({productCode:`CAT_${safeId(rest)}`, mainFolder:'General', category:rest, name:`${rest} Placeholder`, region:'Myanmar', baseCurrency:'MMK', baseCost:0, finalPrice:0, isActive:false}); await auditLog(ctx.from.id,'CATEGORY_ADD',rest,'Product'); return showCategories(ctx); }
        if (cmd?.toLowerCase()==='rename') { const [oldName,newName]=parseLine(rest); await Product.updateMany({category:oldName}, {$set:{category:newName}}); await auditLog(ctx.from.id,'CATEGORY_RENAME',oldName,'Product',{to:newName}); return showCategories(ctx); }
        if (cmd?.toLowerCase()==='delete') { await Product.updateMany({category:rest}, {$set:{isActive:false, category:`${rest} (Deleted)`}}); await auditLog(ctx.from.id,'CATEGORY_DELETE',rest,'Product'); return showCategories(ctx); }
        return ctx.reply('❌ Use `add Name`, `rename Old | New`, or `delete Name`.', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
      }
      if (flow.type === 'add_product_folder' || flow.type === 'bulk_folder') {
        const list=(await Product.distinct('mainFolder')).filter(Boolean);
        const folder=await selectByNumberOrName(list,text);
        ctx.session.adminFlow9={type:flow.type==='add_product_folder'?'add_product_category':'bulk_category', folder, from:'products'};
        return ctx.reply(`📂 Folder: *${folder}*\n\nChoose category by number or type new category:\n\n${await categoryListText(folder)}`, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
      }
      if (flow.type === 'add_product_category' || flow.type === 'bulk_category') {
        const list=(await Product.distinct('category',{mainFolder:flow.folder})).filter(Boolean);
        const category=await selectByNumberOrName(list,text);
        if (flow.type === 'add_product_category') {
          ctx.session.adminFlow9={type:'add_product_detail', folder:flow.folder, category, from:'products'};
          return ctx.reply(`📦 Add product in *${flow.folder} / ${category}*\n\nSimple format:\n\`Product Name | Selling Price\`\n\nFull pricing format:\n\`Product Name | Buy Price | Extra Cost | Profit | Selling Price | manual/auto\`\n\nAuto = calculated price. Manual = entered selling price.`, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
        }
        ctx.session.adminFlow9={type:'bulk_detail', folder:flow.folder, category, from:'products'};
        return ctx.reply(`📦 Bulk add in *${flow.folder} / ${category}*\n\nPaste products, one per line:\n\`Product Name | Selling Price\`\n\nOptional full line:\n\`Product Name | Buy Price | Extra Cost | Profit | Selling Price | manual/auto\``, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
      }
      if (flow.type === 'add_product_detail') {
        const doc = await createProductFromParts({folder:flow.folder, category:flow.category, parts:parseLine(text)});
        ctx.session.adminFlow9=null;
        await auditLog(ctx.from.id,'PRODUCT_ADD',String(doc._id),'Product',{name:doc.name});
        return ctx.reply(`✅ Product added\n\n📦 ${doc.name}\n📁 ${flow.folder} / ${flow.category}\n💰 ${money(doc.finalPrice)} KS\n🧮 Mode: ${doc.pricingMode}`, kb(ADMIN_PRODUCTS));
      }
      if (flow.type === 'bulk_detail') {
        const docs=[];
        for (const line of text.split('\n').map(x=>x.trim()).filter(Boolean)) docs.push(await createProductFromParts({folder:flow.folder, category:flow.category, parts:parseLine(line)}));
        ctx.session.adminFlow9=null;
        await auditLog(ctx.from.id,'PRODUCT_BULK_ADD',`${flow.folder}/${flow.category}`,'Product',{count:docs.length});
        return ctx.reply(`✅ Bulk added ${docs.length} products to ${flow.folder} / ${flow.category}.`, kb(ADMIN_PRODUCTS));
      }
      if (flow.type === 'required_fields_select') {
        const product = await findProductByInput(text);
        if (!product) return ctx.reply('❌ Product not found.', kb(BACK_CANCEL));
        ctx.session.adminFlow9={type:'required_fields_set', productId:String(product._id), from:'products'};
        const current = Array.isArray(product.requiredFields) && product.requiredFields.length
          ? product.requiredFields.map((f,i)=>`${i+1}. ${f.label} — ${f.required===false?'optional':'required'}${f.hint?` — ${f.hint}`:''}`).join('\n')
          : 'No custom fields. Default Game ID will be asked for DirectTopup.';
        return ctx.reply(`🧾 *${product.name}* Required Fields\n\nCurrent:\n${current}\n\nSend fields, one per line:\n\`Label | required/optional | hint\`\n\nExamples:\n\`Game ID | required | MLBB ID\`\n\`Server ID | required | MLBB Server\`\n\`Player Name | optional | In-game name\`\n\nSend \`clear\` to use default.`, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
      }
      if (flow.type === 'required_fields_set') {
        const product = await Product.findById(flow.productId);
        if (!product) return ctx.reply('❌ Product not found.', kb(BACK_CANCEL));
        if (text.toLowerCase() === 'clear') product.requiredFields = [];
        else {
          const fields = parseRequiredFieldsText(text);
          if (!fields.length) return ctx.reply('❌ Send at least one field.', kb(BACK_CANCEL));
          product.requiredFields = fields;
        }
        await product.save();
        ctx.session.adminFlow9=null;
        await auditLog(ctx.from.id,'PRODUCT_REQUIRED_FIELDS_SET',String(product._id),'Product',{fields:product.requiredFields});
        const lines = product.requiredFields.length ? product.requiredFields.map((f,i)=>`${i+1}. ${f.label} — ${f.required===false?'optional':'required'}`).join('\n') : 'Default Game ID fields enabled.';
        return ctx.reply(`✅ Required fields updated for ${product.name}.\n\n${lines}`, kb(ADMIN_PRODUCTS));
      }

      if (flow.type === 'price_calc') {
        const [buy, cost, profit, selling, modeRaw]=parseLine(text);
        const suggested=calcSuggested({buyPrice:Number(buy), extraCost:Number(cost), profit:Number(profit)});
        const mode=String(modeRaw||'manual').toLowerCase();
        const final=mode.startsWith('auto') ? suggested : Number(selling||suggested);
        return ctx.reply(`🧮 *Price Result*\n\nဝယ်ဈေး: ${money(buy)} KS\nအပိုကုန်ကျ: ${money(cost)} KS\nအမြတ်: ${money(profit)} KS\nတွက်ချက်ဈေး: *${money(suggested)} KS*\nရောင်းဈေး: *${money(final)} KS*\nMode: ${mode.startsWith('auto')?'Auto rate':'Manual price'}`, {parse_mode:'Markdown', ...kb(ADMIN_PRODUCTS)});
      }

      // Spin
      if (flow.type === 'spin_reward_add') {
        const [label,type,value,weight]=parseLine(text);
        if (!label || !['none','coin','ks','spin'].includes(type)) return ctx.reply('❌ Format မှားနေပါတယ်။ `Label | type | value | weight`', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
        const cfg=await GameConfig.get();
        const current=Array.isArray(cfg.spinPrizes)?cfg.spinPrizes:[];
        current.push({id:safeId(label), label, type, value:Number(value||0), weight:Number(weight||1)});
        await GameConfig.set({spinPrizes:current}); ctx.session.adminFlow9=null;
        return ctx.reply(`✅ Spin reward added: ${label}`, kb([['🎰 Spin Rewards'], ['🔙 Back', '🏠 Admin Menu']]));
      }
      if (flow.type === 'spin_replace') {
        const prizes=text.split('\n').map((line,i)=>{ const [label,type,value,weight]=parseLine(line); return {id:safeId(label)||`reward_${i}`, label, type:type||'none', value:Number(value||0), weight:Number(weight||1)}; }).filter(p=>p.label && ['none','coin','ks','spin'].includes(p.type));
        if (!prizes.length) return ctx.reply('❌ No valid rewards.', kb(BACK_CANCEL));
        await GameConfig.set({spinPrizes:prizes}); ctx.session.adminFlow9=null;
        return ctx.reply(`✅ Replaced spin rewards: ${prizes.length}`, kb([['🎰 Spin Rewards'], ['🔙 Back', '🏠 Admin Menu']]));
      }
      if (flow.type === 'spin_cost') { const n=Number(text); if(n<0 || Number.isNaN(n)) return ctx.reply('❌ Send valid number.'); await GameConfig.set({spinCostCoins:n}); ctx.session.adminFlow9=null; return ctx.reply(`✅ Spin cost set: ${n} MC`, kb([['🎰 Spin Rewards'], ['🔙 Back', '🏠 Admin Menu']])); }

      // User management
      if (flow.type === 'user_find') {
        const id=text.replace('@','');
        const user=await User.findByTelegramId(id) || await User.findOne({username:id});
        if (!user) return ctx.reply('❌ User not found. Send Telegram ID or username.', kb(BACK_CANCEL));
        return showUser(ctx,user);
      }
      if (flow.type === 'user_action') {
        const user=await User.findByTelegramId(flow.telegramId); if(!user) throw new Error('User not found');
        if (text==='⚠️ + Warning') user.warningsCount=(user.warningsCount||0)+1;
        else if (text==='➖ Warning') user.warningsCount=Math.max(0,(user.warningsCount||0)-1);
        else if (text==='🧹 Clear Warnings') user.warningsCount=0;
        else if (text==='🚫 Ban') { user.isBlocked=true; user.restrictedRights=[...new Set([...(user.restrictedRights||[]),'all'])]; }
        else if (text==='✅ Unban') { user.isBlocked=false; user.restrictedRights=(user.restrictedRights||[]).filter(r=>r!=='all'); }
        else if (text==='🧹 Clear Restrictions') { user.restrictedRights=[]; user.restrictedUntil=null; user.restrictionReason=null; user.isBlocked=false; }
        else if (text==='🔒 Edit Rules') { ctx.session.adminFlow9={type:'user_rules_edit', telegramId:flow.telegramId}; return ctx.reply('🔒 Send rules separated by comma:\n`spin, checkin, rewards, order, topup, support, all`\nSend `none` to clear.', {parse_mode:'Markdown', ...kb(BACK_CANCEL)}); }
        else return showUser(ctx,user);
        await user.save(); await auditLog(ctx.from.id,'USER_ADMIN_UPDATE',String(user.telegramId),'User',{action:text}); return showUser(ctx,user);
      }
      if (flow.type === 'user_rules_edit') {
        const user=await User.findByTelegramId(flow.telegramId); if(!user) throw new Error('User not found');
        user.restrictedRights = text.toLowerCase()==='none' ? [] : text.split(',').map(x=>x.trim()).filter(Boolean);
        user.isBlocked = user.restrictedRights.includes('all');
        user.restrictionReason = user.restrictedRights.length ? 'Manual admin rule edit' : null;
        await user.save(); await auditLog(ctx.from.id,'USER_RULES_EDIT',String(user.telegramId),'User',{rights:user.restrictedRights}); return showUser(ctx,user);
      }

      // Payments
      if (flow.type === 'payment_add') {
        const [name, shortCode, accountName, accountNumber, emoji, instructions] = parseLine(text);
        if (!name || !shortCode || !accountName || !accountNumber) return ctx.reply('❌ Format: `Name | ShortCode | Account Name | Account Number | Emoji | Instructions`', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
        const doc = await PaymentMethod.findOneAndUpdate({shortCode:shortCode.toUpperCase()}, {$set:{name, shortCode:shortCode.toUpperCase(), accountName, accountNumber, emoji:emoji||'💳', instructions:instructions||'Transfer exact amount and upload screenshot.', isActive:true}}, {upsert:true, new:true});
        ctx.session.adminFlow9=null;
        await auditLog(ctx.from.id,'PAYMENT_METHOD_UPSERT',String(doc._id),'PaymentMethod',{name:doc.name});
        return ctx.reply(`✅ Payment method added: ${doc.name}`, kb([['⬅️ Back to Payments', '🏠 Admin Menu'], ['➕ Add Payment Method']]));
      }
      if (flow.type === 'payment_toggle' || flow.type === 'payment_delete') {
        const methods=await PaymentMethod.find().sort({displayOrder:1,name:1});
        const n=Number(text);
        const doc=(Number.isInteger(n)&&n>=1&&n<=methods.length) ? methods[n-1] : await PaymentMethod.findOne({$or:[{name:text},{shortCode:text.toUpperCase()}]});
        if (!doc) return ctx.reply('❌ Payment method not found.', kb(BACK_CANCEL));
        if (flow.type === 'payment_toggle') { doc.isActive=!doc.isActive; await doc.save(); await auditLog(ctx.from.id,'PAYMENT_TOGGLE',String(doc._id),'PaymentMethod',{active:doc.isActive}); ctx.session.adminFlow9=null; return ctx.reply(`✅ ${doc.name} is now ${doc.isActive?'Active':'Inactive'}.`, kb([['⬅️ Back to Payments','🏠 Admin Menu']])); }
        await PaymentMethod.deleteOne({_id:doc._id}); await auditLog(ctx.from.id,'PAYMENT_DELETE',String(doc._id),'PaymentMethod',{name:doc.name}); ctx.session.adminFlow9=null; return ctx.reply(`✅ Payment method deleted: ${doc.name}`, kb([['⬅️ Back to Payments','🏠 Admin Menu']]));
      }

      // Channels
      if (flow.type === 'channel_add') {
        const [name, channelId, link, type, showRaw, rewardTypeRaw, rewardRaw] = parseLine(text);
        if (!name || !channelId) return ctx.reply('❌ Format: `Name | Channel ID | Link | type | show yes/no | reward type | reward value/code`', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
        const rewardType = ['none','coin','wallet','product','coupon'].includes(String(rewardTypeRaw||'none').toLowerCase()) ? String(rewardTypeRaw||'none').toLowerCase() : 'none';
        const set = {name, channelId, link:link||null, type:type||'other', showToUser:!String(showRaw||'yes').toLowerCase().startsWith('no'), rewardType, isActive:true};
        if (rewardType === 'coin' || rewardType === 'wallet' || rewardType === 'coupon') set.rewardValue = Number(rewardRaw || 0);
        if (rewardType === 'product') set.rewardProductCode = rewardRaw || null;
        if (rewardType === 'coupon' && String(rewardRaw||'').match(/^[A-Z0-9_-]+$/i) && Number.isNaN(Number(rewardRaw))) set.rewardCouponCode = String(rewardRaw).toUpperCase();
        if (rewardType === 'coin') set.joinRewardCoins = Number(rewardRaw || 0);
        const doc = await Channel.findOneAndUpdate({channelId}, {$set:set}, {upsert:true, new:true});
        if (doc.type === 'announcement') await SystemStatus.set({announcementChannelId: doc.channelId}, ctx.from.id);
        if (doc.type === 'review') await SystemStatus.set({feedbackChannelId: doc.channelId}, ctx.from.id);
        ctx.session.adminFlow9=null; await auditLog(ctx.from.id,'CHANNEL_UPSERT',String(doc._id),'Channel',{name:doc.name});
        return ctx.reply(`✅ Channel saved: ${doc.name}`, kb([['📋 Channel List'], ['🏠 Admin Menu']]));
      }
      if (flow.type === 'channel_edit_select') {
        const ch = await findChannelByInput(text); if(!ch) return ctx.reply('❌ Channel not found.', kb(BACK_CANCEL));
        ctx.session.adminFlow9={type:'channel_edit_update', channelId:String(ch._id), from:'channels'};
        return ctx.reply(`✏️ Editing: ${ch.name}\n\nSend new values:\n\`Name | Channel ID | Link | type | show yes/no | reward type | reward value/code\``, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
      }
      if (flow.type === 'channel_edit_update') {
        const ch = await Channel.findById(flow.channelId); if(!ch) throw new Error('Channel not found');
        const [name, channelId, link, type, showRaw, rewardTypeRaw, rewardRaw] = parseLine(text);
        ch.name=name||ch.name; ch.channelId=channelId||ch.channelId; ch.link=link||ch.link; ch.type=type||ch.type; ch.showToUser=!String(showRaw|| (ch.showToUser?'yes':'no')).toLowerCase().startsWith('no');
        if (rewardTypeRaw) ch.rewardType = String(rewardTypeRaw).toLowerCase();
        if (ch.rewardType === 'coin' || ch.rewardType === 'wallet' || ch.rewardType === 'coupon') ch.rewardValue = Number(rewardRaw || ch.rewardValue || 0);
        if (ch.rewardType === 'product') ch.rewardProductCode = rewardRaw || ch.rewardProductCode;
        if (ch.rewardType === 'coin') ch.joinRewardCoins = Number(ch.rewardValue || 0);
        await ch.save(); ctx.session.adminFlow9=null; await auditLog(ctx.from.id,'CHANNEL_EDIT',String(ch._id),'Channel'); return ctx.reply(`✅ Channel updated: ${ch.name}`, kb([['📋 Channel List'], ['🏠 Admin Menu']]));
      }
      if (flow.type === 'channel_toggle_show' || flow.type === 'channel_delete') {
        const ch = await findChannelByInput(text); if(!ch) return ctx.reply('❌ Channel not found.', kb(BACK_CANCEL));
        if (flow.type === 'channel_toggle_show') { ch.showToUser=!ch.showToUser; await ch.save(); ctx.session.adminFlow9=null; return ctx.reply(`✅ ${ch.name}: ${ch.showToUser?'shown to users':'hidden from users'}`, kb([['📋 Channel List'], ['🏠 Admin Menu']])); }
        ch.isActive=false; await ch.save(); ctx.session.adminFlow9=null; return ctx.reply(`✅ Channel deactivated: ${ch.name}`, kb([['📋 Channel List'], ['🏠 Admin Menu']]));
      }
      if (flow.type === 'channel_reward_select') {
        const ch = await findChannelByInput(text); if(!ch) return ctx.reply('❌ Channel not found.', kb(BACK_CANCEL));
        ctx.session.adminFlow9={type:'channel_reward_amount', channelId:String(ch._id), from:'channels'};
        return ctx.reply(`🎁 Send reward for ${ch.name}:\n\nFormats:\n• \`none\`\n• \`coin | 10\`\n• \`wallet | 1000\`\n• \`product | PRODUCT_CODE\`\n• \`coupon | 5\` (5% discount auto coupon)\n• \`coupon | CODE\` (existing coupon code)`, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
      }
      if (flow.type === 'channel_reward_amount') {
        const ch=await Channel.findById(flow.channelId); if(!ch) throw new Error('Channel not found');
        if (text.toLowerCase() === 'none') { ch.rewardType='none'; ch.rewardValue=0; ch.joinRewardCoins=0; ch.rewardProductCode=null; ch.rewardCouponCode=null; }
        else {
          const [rt, val] = parseLine(text);
          const rewardType = String(rt||'').toLowerCase();
          if (!['coin','wallet','product','coupon'].includes(rewardType)) return ctx.reply('❌ Use: coin | amount, wallet | amount, product | code, coupon | value/code, or none', kb(BACK_CANCEL));
          ch.rewardType = rewardType;
          if (rewardType === 'coin') { ch.rewardValue = Number(val||0); ch.joinRewardCoins = ch.rewardValue; }
          if (rewardType === 'wallet') ch.rewardValue = Number(val||0);
          if (rewardType === 'product') ch.rewardProductCode = val;
          if (rewardType === 'coupon') { if (Number.isNaN(Number(val))) ch.rewardCouponCode = String(val||'').toUpperCase(); else ch.rewardValue = Number(val||0); }
        }
        await ch.save(); ctx.session.adminFlow9=null;
        return ctx.reply(`✅ ${ch.name} reward set: ${formatReward(ch)}`, kb([['📋 Channel List'], ['🏠 Admin Menu']]));
      }
      if (flow.type === 'coupon_add') {
        const [code, discountType, value, maxUses, expiryRaw, minOrder, maxDiscount, productCodes, folders, categories, tiers, newUserRaw] = parseLine(text);
        if (!code || !discountType || !value) return ctx.reply('❌ Format မှားနေပါတယ်။ CODE | Flat/Percentage | value ...', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
        const promo = await Promo.create({
          code: code.toUpperCase(),
          discountType: /^flat$/i.test(discountType) ? 'Flat' : 'Percentage',
          value: Number(value||0),
          maxUses: maxUses && maxUses !== 'none' ? Number(maxUses) : null,
          expiryDate: expiryRaw && expiryRaw !== 'none' ? new Date(expiryRaw) : null,
          minOrderAmount: Number(minOrder||0),
          maxDiscountAmount: maxDiscount && maxDiscount !== 'none' ? Number(maxDiscount) : null,
          applicableProductCodes: productCodes ? productCodes.split(',').map(x=>x.trim()).filter(Boolean) : [],
          applicableFolders: folders ? folders.split(',').map(x=>x.trim()).filter(Boolean) : [],
          applicableCategories: categories ? categories.split(',').map(x=>x.trim()).filter(Boolean) : [],
          allowedTiers: tiers ? tiers.split(',').map(x=>x.trim()).filter(Boolean) : [],
          newUserOnly: String(newUserRaw||'no').toLowerCase().startsWith('y'),
          createdBy: ctx.from.id,
          source: 'admin_fullfix10',
          description: 'Created from Admin Coupon Manager',
        });
        ctx.session.adminFlow9=null;
        await auditLog(ctx.from.id,'COUPON_CREATE',String(promo._id),'Promo',{code:promo.code});
        return ctx.reply(`✅ Coupon created: ${promo.code}`, kb([['🎟 Coupon Manager'], ['🏠 Admin Menu']]));
      }
      if (flow.type === 'autopost_add') {
        const [channelInput, postType, timeRaw, frequency, customText] = parseLine(text);
        const ch = await findChannelByInput(channelInput); if(!ch) return ctx.reply('❌ Channel not found.', kb(BACK_CANCEL));
        const [hh, mm] = String(timeRaw||'09:00').split(':').map(Number);
        const doc = await ChannelAutoPost.create({ channelId: ch._id, postType: postType || 'about_bot', hour: Number.isFinite(hh)?hh:9, minute: Number.isFinite(mm)?mm:0, frequency: frequency || 'daily', customText: customText || '', createdBy: ctx.from.id });
        ch.autoPostEnabled = true; await ch.save();
        ctx.session.adminFlow9=null;
        await auditLog(ctx.from.id,'AUTOPOST_CREATE',String(doc._id),'ChannelAutoPost',{channel:ch.name});
        return ctx.reply(`✅ Auto post scheduled for ${ch.name}: ${doc.postType} at ${String(doc.hour).padStart(2,'0')}:${String(doc.minute).padStart(2,'0')}`, kb([['🗓 Auto Channel Posts'], ['🏠 Admin Menu']]));
      }
      return next();
    } catch(e){ return ctx.reply(`❌ ${e.message}`, kb(BACK_CANCEL)); }
  });
};
