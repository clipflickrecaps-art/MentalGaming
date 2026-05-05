const { Markup } = require('telegraf');
const { adminOnly } = require('../middlewares/adminCheck');
const Product = require('../models/Product');
const GameConfig = require('../models/GameConfig');
const User = require('../models/User');
const { auditLog } = require('../services/logger');

const ADMIN_MAIN = [
  ['📊 Dashboard', '📦 Manage Orders'],
  ['🛍️ Manage Products', '👥 Manage Users'],
  ['🎰 Spin Rewards', '💳 Payments'],
  ['🗓 Check-In', '📁 Categories'],
  ['🔙 Back to Main']
];
const ADMIN_PRODUCTS = [
  ['➕ Add Product', '📦 Bulk Add Products'],
  ['📁 Manage Folders', '📂 Manage Categories'],
  ['🧮 Price Calculator', '📋 Product List'],
  ['🔙 Back', '❌ Cancel']
];
const BACK_CANCEL = [['🔙 Back', '❌ Cancel']];
function kb(rows){ return Markup.keyboard(rows).resize(); }
function safeId(s){ return String(s||'').trim().replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,48) || `P_${Date.now()}`; }
function money(n){ return Number(n||0).toLocaleString(); }
function parseLine(line){ return String(line||'').split('|').map(x=>x.trim()); }
function getText(ctx){ return ctx.message?.text?.trim() || ''; }
function isCancel(t){ return ['❌ Cancel','/cancel','cancel'].includes(t); }
function isBack(t){ return ['🔙 Back','Back','back'].includes(t); }

async function showAdmin(ctx){
  return ctx.reply('🔧 *Admin Panel*\n\nReply keyboard တစ်ခုတည်းနဲ့စီမံနိုင်အောင်ပြင်ထားပါတယ်။', {parse_mode:'Markdown', ...kb(ADMIN_MAIN)});
}
async function showProducts(ctx){
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
function calcSuggested({buyPrice=0, baseCost=0, profit=0}){
  const base = Number(buyPrice||0) + Number(baseCost||0);
  return Math.ceil(base + Number(profit||0));
}
async function createProductFromParts({folder, category, parts}){
  const [name, p2, p3, p4, p5, p6] = parts;
  if (!name || !p2) throw new Error('Product name နဲ့ price လိုပါတယ်။');
  let buyPrice=0, baseCost=0, profit=0, finalPrice=0, pricingMode='Manual';
  if (parts.length === 2) {
    finalPrice = Number(p2);
    buyPrice = finalPrice;
  } else {
    buyPrice = Number(p2||0);
    baseCost = Number(p3||0);
    profit = Number(p4||0);
    finalPrice = p5 ? Number(p5) : calcSuggested({buyPrice, baseCost, profit});
    pricingMode = String(p6||'manual').toLowerCase().startsWith('auto') ? 'Auto' : 'Manual';
    if (pricingMode === 'Auto') finalPrice = calcSuggested({buyPrice, baseCost, profit});
  }
  if (!finalPrice || finalPrice < 0) throw new Error('Price မှားနေပါတယ်။');
  const productCode = safeId(`${folder}_${category}_${name}_${Date.now()}`);
  return Product.create({
    productCode,
    mainFolder: folder,
    category,
    name,
    region:'Myanmar',
    baseCurrency:'MMK',
    baseCost: Number(buyPrice||0),
    baseUnit: Number(baseCost||0),
    baseProfitKS: Number(profit||0),
    profitMode:'fixedUnit',
    profitMargin:0,
    suggestedPrice: calcSuggested({buyPrice, baseCost, profit}),
    finalPrice,
    pricingMode,
    stockCount:-1,
    quantity:1,
    isActive:true,
    description:`Buy: ${buyPrice} | Cost: ${baseCost} | Profit: ${profit} | Mode: ${pricingMode}`
  });
}
async function showSpin(ctx){
  const cfg = await GameConfig.get();
  const prizes = Array.isArray(cfg.spinPrizes) && cfg.spinPrizes.length ? cfg.spinPrizes : [];
  const lines = prizes.length ? prizes.map((p,i)=>`${i+1}. ${p.label} — ${p.type||'none'}:${p.value||0}`).join('\n') : 'No custom rewards yet.';
  return ctx.reply(`🎰 *Spin Rewards*\n\n${lines}\n\nChoose action:`, {parse_mode:'Markdown', ...kb([['➕ Add Spin Reward','✏️ Replace Spin Rewards'],['💸 Set Spin Cost','🔙 Back']])});
}
async function showUsers(ctx){
  ctx.session.adminFlow8 = {type:'user_find'};
  return ctx.reply('👥 *Manage Users*\n\nSend Telegram ID or username.\nExample: `123456789` or `username`', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
}
async function showUser(ctx,user){
  ctx.session.adminFlow8 = {type:'user_action', telegramId:String(user.telegramId)};
  const txt = `👤 *User Control*\n\n🆔 \`${user.telegramId}\`\n👤 @${user.username||'-'}\n💰 ${money(user.balanceKS)} KS | 🪙 ${money(user.balanceCoin)} MC\n⚠️ Warnings: *${user.warningsCount||0}*\n🚫 Banned: *${user.isBlocked?'YES':'NO'}*\n🔒 Rules: ${(user.restrictedRights||[]).join(', ')||'None'}\n\nUse buttons below.`;
  return ctx.reply(txt, {parse_mode:'Markdown', ...kb([['⚠️ + Warning','➖ Warning'],['🧹 Clear Warnings', user.isBlocked?'✅ Unban':'🚫 Ban'],['🔒 Edit Rules','🧹 Clear Restrictions'],['🔙 Back','❌ Cancel']])});
}

module.exports = function registerAdminFullFix8(bot){
  bot.command('admin2', adminOnly(), showAdmin);
  bot.hears('🔧 Admin Panel', adminOnly(), showAdmin);
  bot.hears('🛍️ Manage Products', adminOnly(), showProducts);
  bot.hears('🔙 Back', async (ctx,next)=>{
    const flow=ctx.session?.adminFlow8;
    if (!flow) return next();
    ctx.session.adminFlow8=null;
    if (flow.from === 'products' || ['add_product_folder','add_product_category','add_product_detail','bulk_folder','bulk_category','bulk_detail','folders','categories'].includes(flow.type)) return showProducts(ctx);
    return showAdmin(ctx);
  });
  bot.hears('❌ Cancel', async (ctx,next)=>{
    if (!ctx.session?.adminFlow8) return next();
    ctx.session.adminFlow8=null;
    return ctx.reply('❌ Cancelled.', kb(ADMIN_MAIN));
  });

  bot.hears('📁 Manage Folders', adminOnly(), async ctx=>{ ctx.session.adminFlow8={type:'folders',from:'products'}; return showFolders(ctx); });
  bot.hears('📂 Manage Categories', adminOnly(), async ctx=>{ ctx.session.adminFlow8={type:'categories',from:'products'}; return showCategories(ctx); });
  bot.hears('📋 Product List', adminOnly(), async ctx=>{
    const products = await Product.find({isActive:true}).sort({mainFolder:1, category:1, name:1}).limit(30).lean();
    const lines = products.map((p,i)=>`${i+1}. [${p.mainFolder||'General'} / ${p.category}] ${p.name} — ${money(p.finalPrice)} KS`).join('\n') || 'No active products.';
    return ctx.reply(`📋 *Products*\n\n${lines}`, {parse_mode:'Markdown', ...kb(ADMIN_PRODUCTS)});
  });
  bot.hears('🧮 Price Calculator', adminOnly(), async ctx=>{
    ctx.session.adminFlow8={type:'price_calc'};
    return ctx.reply('🧮 Send pricing line:\n`Buy Price | Extra Cost | Profit | optional Selling Price | auto/manual`\n\nExample:\n`1000 | 200 | 300 | | auto`\nor\n`1000 | 200 | 300 | 1800 | manual`', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });
  bot.hears('➕ Add Product', adminOnly(), async ctx=>{
    ctx.session.adminFlow8={type:'add_product_folder',from:'products'};
    return ctx.reply(`📁 Choose folder by number or type new folder name:\n\n${await folderListText()}`, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });
  bot.hears('📦 Bulk Add Products', adminOnly(), async ctx=>{
    ctx.session.adminFlow8={type:'bulk_folder',from:'products'};
    return ctx.reply(`📁 Choose folder first:\n\n${await folderListText()}`, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });
  bot.hears('🎰 Spin Rewards', adminOnly(), showSpin);
  bot.hears('➕ Add Spin Reward', adminOnly(), async ctx=>{
    ctx.session.adminFlow8={type:'spin_reward_add'};
    return ctx.reply('➕ Send new spin reward:\n`Label | type | value | weight`\n\nTypes: `none`, `coin`, `ks`, `spin`\nExample: `🪙 100 MC | coin | 100 | 10`', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });
  bot.hears('✏️ Replace Spin Rewards', adminOnly(), async ctx=>{
    ctx.session.adminFlow8={type:'spin_replace'};
    return ctx.reply('✏️ Send rewards, one per line:\n`Label | type | value | weight`\n\nUser side မှာ percentage/weight မပြပါ။', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
  });
  bot.hears('💸 Set Spin Cost', adminOnly(), async ctx=>{ ctx.session.adminFlow8={type:'spin_cost'}; return ctx.reply('💸 Send spin cost in MC.', kb(BACK_CANCEL)); });
  bot.hears('👥 Manage Users', adminOnly(), showUsers);

  bot.on('text', async (ctx,next)=>{
    const flow = ctx.session?.adminFlow8;
    if (!flow) return next();
    const text = getText(ctx);
    if (isCancel(text)) { ctx.session.adminFlow8=null; return ctx.reply('❌ Cancelled.', kb(ADMIN_MAIN)); }
    if (isBack(text)) { ctx.session.adminFlow8=null; return showAdmin(ctx); }
    try {
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
        ctx.session.adminFlow8={type:flow.type==='add_product_folder'?'add_product_category':'bulk_category', folder, from:'products'};
        return ctx.reply(`📂 Folder: *${folder}*\n\nChoose category by number or type new category:\n\n${await categoryListText(folder)}`, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
      }
      if (flow.type === 'add_product_category' || flow.type === 'bulk_category') {
        const list=(await Product.distinct('category',{mainFolder:flow.folder})).filter(Boolean);
        const category=await selectByNumberOrName(list,text);
        if (flow.type === 'add_product_category') {
          ctx.session.adminFlow8={type:'add_product_detail', folder:flow.folder, category, from:'products'};
          return ctx.reply(`📦 Add product in *${flow.folder} / ${category}*\n\nSimple format:\n\`Product Name | Selling Price\`\n\nFull pricing format:\n\`Product Name | Buy Price | Extra Cost | Profit | Selling Price | manual/auto\`\n\nAuto = sell using calculated price. Manual = sell using selling price.`, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
        }
        ctx.session.adminFlow8={type:'bulk_detail', folder:flow.folder, category, from:'products'};
        return ctx.reply(`📦 Bulk add in *${flow.folder} / ${category}*\n\nPaste products, one per line:\n\`Product Name | Selling Price\`\n\nOptional full line:\n\`Product Name | Buy Price | Extra Cost | Profit | Selling Price | manual/auto\``, {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
      }
      if (flow.type === 'add_product_detail') {
        const doc = await createProductFromParts({folder:flow.folder, category:flow.category, parts:parseLine(text)});
        ctx.session.adminFlow8=null;
        await auditLog(ctx.from.id,'PRODUCT_ADD',String(doc._id),'Product',{name:doc.name});
        return ctx.reply(`✅ Product added\n\n📦 ${doc.name}\n📁 ${flow.folder} / ${flow.category}\n💰 ${money(doc.finalPrice)} KS\n🧮 Mode: ${doc.pricingMode}`, kb(ADMIN_PRODUCTS));
      }
      if (flow.type === 'bulk_detail') {
        const docs=[];
        for (const line of text.split('\n').map(x=>x.trim()).filter(Boolean)) docs.push(await createProductFromParts({folder:flow.folder, category:flow.category, parts:parseLine(line)}));
        ctx.session.adminFlow8=null;
        await auditLog(ctx.from.id,'PRODUCT_BULK_ADD',`${flow.folder}/${flow.category}`,'Product',{count:docs.length});
        return ctx.reply(`✅ Bulk added ${docs.length} products to ${flow.folder} / ${flow.category}.`, kb(ADMIN_PRODUCTS));
      }
      if (flow.type === 'price_calc') {
        const [buy, cost, profit, selling, modeRaw]=parseLine(text);
        const suggested=calcSuggested({buyPrice:Number(buy), baseCost:Number(cost), profit:Number(profit)});
        const mode=String(modeRaw||'manual').toLowerCase();
        const final=mode.startsWith('auto') ? suggested : Number(selling||suggested);
        return ctx.reply(`🧮 *Price Result*\n\nဝယ်ဈေး: ${money(buy)} KS\nအပိုကုန်ကျ: ${money(cost)} KS\nအမြတ်: ${money(profit)} KS\nတွက်ချက်ဈေး: *${money(suggested)} KS*\nရောင်းဈေး: *${money(final)} KS*\nMode: ${mode.startsWith('auto')?'Auto rate':'Manual price'}`, {parse_mode:'Markdown', ...kb(ADMIN_PRODUCTS)});
      }
      if (flow.type === 'spin_reward_add') {
        const [label,type,value,weight]=parseLine(text);
        if (!label || !['none','coin','ks','spin'].includes(type)) return ctx.reply('❌ Format မှားနေပါတယ်။ `Label | type | value | weight`', {parse_mode:'Markdown', ...kb(BACK_CANCEL)});
        const cfg=await GameConfig.get();
        const current=Array.isArray(cfg.spinPrizes)?cfg.spinPrizes:[];
        current.push({id:safeId(label), label, type, value:Number(value||0), weight:Number(weight||1)});
        await GameConfig.set({spinPrizes:current}); ctx.session.adminFlow8=null;
        return ctx.reply(`✅ Spin reward added: ${label}`, kb(ADMIN_MAIN));
      }
      if (flow.type === 'spin_replace') {
        const prizes=text.split('\n').map((line,i)=>{ const [label,type,value,weight]=parseLine(line); return {id:safeId(label)||`reward_${i}`, label, type:type||'none', value:Number(value||0), weight:Number(weight||1)}; }).filter(p=>p.label && ['none','coin','ks','spin'].includes(p.type));
        if (!prizes.length) return ctx.reply('❌ No valid rewards.', kb(BACK_CANCEL));
        await GameConfig.set({spinPrizes:prizes}); ctx.session.adminFlow8=null;
        return ctx.reply(`✅ Replaced spin rewards: ${prizes.length}`, kb(ADMIN_MAIN));
      }
      if (flow.type === 'spin_cost') { const n=Number(text); if(n<0 || Number.isNaN(n)) return ctx.reply('❌ Send valid number.'); await GameConfig.set({spinCostCoins:n}); ctx.session.adminFlow8=null; return ctx.reply(`✅ Spin cost set: ${n} MC`, kb(ADMIN_MAIN)); }
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
        else if (text==='🔒 Edit Rules') { ctx.session.adminFlow8={type:'user_rules_edit', telegramId:flow.telegramId}; return ctx.reply('🔒 Send rules separated by comma:\n`spin, checkin, rewards, order, topup, support, all`\nSend `none` to clear.', {parse_mode:'Markdown', ...kb(BACK_CANCEL)}); }
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
      return next();
    } catch(e){ return ctx.reply(`❌ ${e.message}`, kb(BACK_CANCEL)); }
  });
};
