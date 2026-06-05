/**
 * Catalog Admin Commands
 * Registers all catalog management actions for the admin panel.
 *
 * Commands / actions:
 *   admin_catalogs_action  — catalog list panel
 *   cat_view:<id>          — view catalog details + fields
 *   cat_add                — add new catalog (name prompt)
 *   cat_del:<id>           — delete catalog
 *   cat_toggle:<id>        — toggle active/inactive
 *   cat_field_add:<id>     — add checkout field
 *   cat_field_del:<id>:<key> — remove a checkout field
 *   /bulkaddproducts       — bulk import products from formatted text
 */

const { Markup } = require('telegraf');
const { adminOnly } = require('../middlewares/adminCheck');
const Catalog = require('../models/Catalog');
const Product = require('../models/Product');
const { auditLog } = require('../services/logger');
const { price } = require('../utils/ui');

// ── Helpers ────────────────────────────────────────────────────────────────────

function catalogKeyboard(catalogId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Add Field',      `cat_field_add:${catalogId}`)],
    [Markup.button.callback(
      '🔀 Toggle Active',    `cat_toggle:${catalogId}`),
      Markup.button.callback('🗑 Delete',         `cat_del:${catalogId}`)],
    [Markup.button.callback('🔙 All Catalogs',   'admin_catalogs_action')],
  ]);
}

async function sendCatalogView(ctx, catalog) {
  const fieldLines = catalog.checkoutFields.length
    ? catalog.checkoutFields
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((f, i) =>
          `${i + 1}\\. *${f.label}* (\`${f.key}\`) — ${f.fieldType}${f.required ? ' ✅' : ' ☑️ opt'}`
        )
        .join('\n')
    : '_No checkout fields — will not prompt user for delivery info_';

  const productCount = await Product.countDocuments({ catalogId: catalog._id });

  const text =
    `📂 *${catalog.name}*\n\n` +
    `Status: ${catalog.isActive ? '✅ Active' : '🔴 Inactive'}\n` +
    `Products: *${productCount}*\n` +
    (catalog.description ? `📝 ${catalog.description}\n` : '') +
    `\n*Checkout Fields:*\n${fieldLines}`;

  const fieldDelButtons = catalog.checkoutFields.map((f) => [
    Markup.button.callback(`🗑 Remove: ${f.label}`, `cat_field_del:${catalog._id}:${f.key}`),
  ]);

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('➕ Add Field', `cat_field_add:${catalog._id}`)],
      ...fieldDelButtons,
      [
        Markup.button.callback('🔀 Toggle Active', `cat_toggle:${catalog._id}`),
        Markup.button.callback('🗑 Delete', `cat_del:${catalog._id}`),
      ],
      [Markup.button.callback('🔙 All Catalogs', 'admin_catalogs_action')],
    ]),
  });
}

// ── Bulk product parser ────────────────────────────────────────────────────────
// Parses lines like:
//   💎 86 - 5000 ks
//   86 Diamonds - 5,000 KS
//   Elite Pass - 35000
function parseBulkProducts(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const results = [];
  for (const line of lines) {
    // Strip leading emoji/symbols
    const clean = line.replace(/^[\p{Emoji}\s*#•\-]+/u, '').trim();
    // Try: "Name - Price unit" or "Name - Price"
    const match = clean.match(/^(.+?)\s*[-–—]\s*([\d,\.]+)\s*(ks|mmk|k)?$/i);
    if (!match) continue;
    const name = match[1].trim();
    const priceRaw = parseFloat(match[2].replace(/,/g, ''));
    if (!name || isNaN(priceRaw) || priceRaw <= 0) continue;
    results.push({ name, finalPrice: priceRaw });
  }
  return results;
}

// ── Register ───────────────────────────────────────────────────────────────────

module.exports = (bot) => {
  // ── Catalog list ─────────────────────────────────────────────────────────────
  bot.action('admin_catalogs_action', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const catalogs = await Catalog.find().sort({ sortOrder: 1, name: 1 });
    if (!catalogs.length) {
      return ctx.reply(
        `📂 *Catalogs*\n\nNo catalogs yet.\nCatalogs group products and define what delivery info (Game ID, Player ID, etc.) is required during checkout.`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('➕ Add Catalog', 'cat_add')],
            [Markup.button.callback('🔙 Back', 'nav:go:admin_main')],
          ]),
        }
      );
    }
    const rows = catalogs.map((c) => [
      Markup.button.callback(
        `${c.isActive ? '✅' : '🔴'} ${c.name} (${c.checkoutFields.length} fields)`,
        `cat_view:${c._id}`
      ),
    ]);
    rows.push([Markup.button.callback('➕ Add Catalog', 'cat_add')]);
    rows.push([Markup.button.callback('🔙 Back', 'nav:go:admin_main')]);
    await ctx.reply(`📂 *Catalogs (${catalogs.length})*\n\nSelect a catalog to manage:`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(rows),
    });
  });

  // ── View catalog ─────────────────────────────────────────────────────────────
  bot.action(/^cat_view:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const catalog = await Catalog.findById(ctx.match[1]);
    if (!catalog) return ctx.reply('❌ Catalog not found.');
    await sendCatalogView(ctx, catalog);
  });

  // ── Add catalog — name prompt ─────────────────────────────────────────────
  bot.action('cat_add', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.catalogAction = 'add_name';
    await ctx.reply(
      `📂 *New Catalog*\n\nEnter the catalog name (e.g. "Mobile Legends", "PUBG Mobile", "Gift Cards"):\n\n_Send /cancel to abort._`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Toggle active ─────────────────────────────────────────────────────────
  bot.action(/^cat_toggle:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const catalog = await Catalog.findById(ctx.match[1]);
    if (!catalog) return ctx.reply('❌ Catalog not found.');
    catalog.isActive = !catalog.isActive;
    await catalog.save();
    await auditLog(ctx.from.id, 'CATALOG_TOGGLE', catalog._id.toString(), 'Catalog', { isActive: catalog.isActive });
    await ctx.reply(`${catalog.isActive ? '✅' : '🔴'} *${catalog.name}* is now ${catalog.isActive ? 'Active' : 'Inactive'}.`, { parse_mode: 'Markdown' });
    await sendCatalogView(ctx, catalog);
  });

  // ── Delete catalog ────────────────────────────────────────────────────────
  bot.action(/^cat_del:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const catalog = await Catalog.findById(ctx.match[1]);
    if (!catalog) return ctx.reply('❌ Catalog not found.');
    const inUse = await Product.countDocuments({ catalogId: catalog._id });
    if (inUse > 0) {
      return ctx.reply(`❌ Cannot delete — *${catalog.name}* is used by ${inUse} product(s). Reassign products first.`, { parse_mode: 'Markdown' });
    }
    await Catalog.deleteOne({ _id: catalog._id });
    await auditLog(ctx.from.id, 'CATALOG_DELETE', catalog._id.toString(), 'Catalog', { name: catalog.name });
    await ctx.reply(`🗑 Catalog *${catalog.name}* deleted.`, { parse_mode: 'Markdown' });
  });

  // ── Remove checkout field ─────────────────────────────────────────────────
  bot.action(/^cat_field_del:([^:]+):(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const [, catalogId, key] = ctx.match;
    const catalog = await Catalog.findById(catalogId);
    if (!catalog) return ctx.reply('❌ Catalog not found.');
    catalog.checkoutFields = catalog.checkoutFields.filter((f) => f.key !== key);
    await catalog.save();
    await auditLog(ctx.from.id, 'CATALOG_FIELD_DEL', catalogId, 'Catalog', { key });
    await ctx.reply(`✅ Field \`${key}\` removed.`, { parse_mode: 'Markdown' });
    await sendCatalogView(ctx, catalog);
  });

  // ── Add checkout field — starts a multi-step session ─────────────────────
  bot.action(/^cat_field_add:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.catalogAction = 'field_add';
    ctx.session.catalogFieldStep = 'key';
    ctx.session.catalogId = ctx.match[1];
    ctx.session.catalogFieldDraft = {};
    await ctx.reply(
      `➕ *Add Checkout Field*\n\nStep 1/4 — Enter the field *key* (short code, no spaces, e.g. \`game_id\`, \`player_id\`, \`email\`):\n\n_Send /cancel to abort._`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Bulk add products command ─────────────────────────────────────────────
  bot.command('bulkaddproducts', adminOnly(), async (ctx) => {
    const catalogs = await Catalog.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });
    if (!catalogs.length) {
      return ctx.reply('❌ No active catalogs. Create a catalog first with the admin panel → Catalogs.');
    }
    ctx.session.catalogAction = 'bulk_select_catalog';
    const buttons = catalogs.map((c) => [Markup.button.callback(c.name, `bulk_cat:${c._id}`)]);
    buttons.push([Markup.button.callback('❌ Cancel', 'bulk_cancel')]);
    await ctx.reply(
      `📦 *Bulk Add Products*\n\nSelect the catalog these products belong to:`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
    );
  });

  bot.action(/^bulk_cat:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const catalog = await Catalog.findById(ctx.match[1]);
    if (!catalog) return ctx.reply('❌ Catalog not found.');
    ctx.session.catalogAction = 'bulk_paste';
    ctx.session.bulkCatalogId = catalog._id.toString();
    ctx.session.bulkCatalogName = catalog.name;
    await ctx.reply(
      `📦 *Bulk Add — ${catalog.name}*\n\nPaste your product list, one per line:\n\n` +
      `Format: \`Product Name - Price\`\n\nExamples:\n` +
      `\`💎 86 Diamonds - 5000\`\n` +
      `\`💎 172 Diamonds - 10000\`\n` +
      `\`Elite Pass - 35000 ks\`\n\n` +
      `_Send /cancel to abort._`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.action('bulk_cancel', adminOnly(), async (ctx) => {
    await ctx.answerCbQuery('Cancelled');
    ctx.session.catalogAction = null;
    ctx.session.bulkCatalogId = null;
    await ctx.reply('❌ Bulk import cancelled.');
  });

  // ── Confirm bulk import ───────────────────────────────────────────────────
  bot.action(/^bulk_confirm:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery('Saving...');
    const catalogId = ctx.match[1];
    const products = ctx.session.bulkProductsDraft;
    const catalogName = ctx.session.bulkCatalogName;
    if (!products?.length) return ctx.reply('❌ Nothing to import.');

    const catalog = await Catalog.findById(catalogId);
    if (!catalog) return ctx.reply('❌ Catalog not found.');

    const docs = products.map((p, i) => ({
      name: p.name,
      category: catalog.name,
      catalogId: catalog._id,
      region: 'Global',
      baseCurrency: 'MMK',
      baseCost: p.finalPrice,
      finalPrice: p.finalPrice,
      sortOrder: i,
      isActive: true,
      productType: 'DirectTopup',
    }));

    await Product.insertMany(docs);
    await auditLog(ctx.from.id, 'BULK_PRODUCTS_IMPORT', catalogId, 'Product', { count: docs.length, catalogName });

    ctx.session.bulkProductsDraft = null;
    ctx.session.catalogAction = null;
    ctx.session.bulkCatalogId = null;

    await ctx.reply(
      `✅ *${docs.length} products* added to *${catalogName}*!`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('📋 View Products', 'pm_list_products')]]),
      }
    );
  });

  // ── Message handler — catalog field wizard + bulk paste ───────────────────
  bot.on('message', adminOnly(), async (ctx, next) => {
    const action = ctx.session?.catalogAction;
    if (!action) return next();

    const text = ctx.message?.text?.trim();

    // Cancel
    if (text === '/cancel') {
      ctx.session.catalogAction = null;
      ctx.session.catalogFieldStep = null;
      ctx.session.catalogId = null;
      ctx.session.catalogFieldDraft = null;
      ctx.session.bulkCatalogId = null;
      ctx.session.bulkProductsDraft = null;
      return ctx.reply('❌ Cancelled.');
    }

    // ── Add catalog name ──────────────────────────────────────────────────
    if (action === 'add_name') {
      if (!text) return ctx.reply('Please enter a catalog name:');
      const existing = await Catalog.findOne({ name: { $regex: `^${text}$`, $options: 'i' } });
      if (existing) return ctx.reply(`❌ A catalog named *${text}* already exists.`, { parse_mode: 'Markdown' });

      const catalog = await Catalog.create({ name: text });
      await auditLog(ctx.from.id, 'CATALOG_CREATE', catalog._id.toString(), 'Catalog', { name: text });
      ctx.session.catalogAction = null;
      await ctx.reply(
        `✅ Catalog *${catalog.name}* created!\n\nNow add checkout fields (e.g. Game ID, Server ID) so the system knows what to ask buyers:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('➕ Add Field', `cat_field_add:${catalog._id}`)]]),
        }
      );
      return;
    }

    // ── Checkout field wizard ─────────────────────────────────────────────
    if (action === 'field_add') {
      if (!text) return;
      const step = ctx.session.catalogFieldStep;
      const draft = ctx.session.catalogFieldDraft || {};

      if (step === 'key') {
        const key = text.toLowerCase().replace(/\s+/g, '_');
        draft.key = key;
        ctx.session.catalogFieldDraft = draft;
        ctx.session.catalogFieldStep = 'label';
        return ctx.reply(
          `Step 2/4 — Enter the field *label* (shown to user, e.g. "Game ID", "Player ID", "Email Address"):`,
          { parse_mode: 'Markdown' }
        );
      }

      if (step === 'label') {
        draft.label = text;
        ctx.session.catalogFieldDraft = draft;
        ctx.session.catalogFieldStep = 'required';
        return ctx.reply(
          `Step 3/4 — Is this field *required*?`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✅ Required', 'cat_field_req:yes'), Markup.button.callback('☑️ Optional', 'cat_field_req:no')],
            ]),
          }
        );
      }

      if (step === 'placeholder') {
        draft.placeholder = text === '-' ? '' : text;
        ctx.session.catalogFieldDraft = null;
        ctx.session.catalogFieldStep = null;
        ctx.session.catalogAction = null;

        const catalog = await Catalog.findById(ctx.session.catalogId);
        if (!catalog) return ctx.reply('❌ Catalog not found.');
        catalog.checkoutFields.push({
          key: draft.key,
          label: draft.label,
          fieldType: draft.fieldType || 'text',
          required: draft.required !== false,
          placeholder: draft.placeholder || '',
          sortOrder: catalog.checkoutFields.length,
        });
        await catalog.save();
        await auditLog(ctx.from.id, 'CATALOG_FIELD_ADD', catalog._id.toString(), 'Catalog', { key: draft.key, label: draft.label });
        await ctx.reply(`✅ Field *${draft.label}* added to *${catalog.name}*!`, { parse_mode: 'Markdown' });
        await sendCatalogView(ctx, catalog);
        return;
      }

      return next();
    }

    // ── Bulk product paste ────────────────────────────────────────────────
    if (action === 'bulk_paste') {
      if (!text) return ctx.reply('Please paste your product list:');
      const products = parseBulkProducts(text);
      if (!products.length) {
        return ctx.reply(
          `❌ Could not parse any products.\n\nEach line must be:\n\`Product Name - Price\`\nExample: \`86 Diamonds - 5000\``,
          { parse_mode: 'Markdown' }
        );
      }
      ctx.session.bulkProductsDraft = products;
      ctx.session.catalogAction = 'bulk_pending_confirm';

      const preview = products
        .slice(0, 20)
        .map((p, i) => `${i + 1}. *${p.name}* — ${p.finalPrice.toLocaleString()} KS`)
        .join('\n');
      const more = products.length > 20 ? `\n_... and ${products.length - 20} more_` : '';

      await ctx.reply(
        `📋 *Preview (${products.length} products)*\n\n${preview}${more}\n\nCatalog: *${ctx.session.bulkCatalogName}*\n\nConfirm import?`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Confirm Import', `bulk_confirm:${ctx.session.bulkCatalogId}`)],
            [Markup.button.callback('❌ Cancel', 'bulk_cancel')],
          ]),
        }
      );
      return;
    }

    return next();
  });

  // ── Field required/optional buttons ──────────────────────────────────────
  bot.action(/^cat_field_req:(yes|no)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const draft = ctx.session.catalogFieldDraft || {};
    draft.required = ctx.match[1] === 'yes';
    ctx.session.catalogFieldDraft = draft;
    ctx.session.catalogFieldStep = 'fieldType';
    await ctx.reply(
      `Step 4a/4 — Field type:`,
      {
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('Text', 'cat_field_type:text'),
            Markup.button.callback('Number', 'cat_field_type:number'),
          ],
          [
            Markup.button.callback('Email', 'cat_field_type:email'),
            Markup.button.callback('Textarea', 'cat_field_type:textarea'),
          ],
        ]),
      }
    );
  });

  bot.action(/^cat_field_type:(.+)$/, adminOnly(), async (ctx) => {
    await ctx.answerCbQuery();
    const draft = ctx.session.catalogFieldDraft || {};
    draft.fieldType = ctx.match[1];
    ctx.session.catalogFieldDraft = draft;
    ctx.session.catalogFieldStep = 'placeholder';
    await ctx.reply(
      `Step 4b/4 — Enter placeholder text (shown greyed out in the input), or send \`-\` to skip:`,
      { parse_mode: 'Markdown' }
    );
  });
};
