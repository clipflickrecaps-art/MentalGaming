/**
 * Address Book Commands
 *
 * /myids — view all saved game IDs
 * /saveid — save a new game ID
 * /deleteid — delete a saved ID
 */

const { Markup } = require('telegraf');
const { getEntries, saveEntry, deleteEntry, setDefault, formatEntry } = require('../services/AddressBookService');
const AddressBook = require('../models/AddressBook');
const User = require('../models/User');

module.exports = function registerAddressBook(bot) {

  bot.command('myids', async (ctx) => {
    const entries = await getEntries(ctx.from.id);
    if (!entries.length) {
      return ctx.reply(
        `📖 *Game ID Address Book*\n\nNo saved IDs yet.\n\nUse /saveid to save your first game account!\n_Example: /saveid MobileLegends 123456 9001 "My Main"_`,
        { parse_mode: 'Markdown' }
      );
    }

    const byGame = {};
    for (const e of entries) {
      if (!byGame[e.gameName]) byGame[e.gameName] = [];
      byGame[e.gameName].push(e);
    }

    const lines = [];
    for (const [game, ids] of Object.entries(byGame)) {
      lines.push(`*${game}:*`);
      ids.forEach((e, i) => {
        lines.push(`  ${i + 1}. ${e.isDefault ? '⭐ ' : ''}${formatEntry(e)}${e.nickname !== e.gameId ? ` _(${e.nickname})_` : ''}`);
      });
    }

    await ctx.reply(
      `📖 *Saved Game IDs (${entries.length})*\n\n${lines.join('\n')}`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('➕ Save New ID', 'ab_start_save')],
          [Markup.button.callback('🗑 Delete an ID', 'ab_start_delete')],
        ]),
      }
    );
  });

  // ── /saveid <Game> <GameID> [ZoneID] ["Nickname"] ──────────────────────────
  bot.command('saveid', async (ctx) => {
    const text = ctx.message.text.slice('/saveid'.length).trim();
    if (!text) {
      return ctx.reply(
        `📖 *Save Game ID*\n\nFormat:\n\`/saveid GameName GameID [ZoneID] [Nickname]\`\n\nExamples:\n• \`/saveid MobileLegends 123456 9001 MyMain\`\n• \`/saveid FreeFire 987654321 Main\``,
        { parse_mode: 'Markdown' }
      );
    }

    const parts = text.match(/[^\s"']+|"([^"]*)"|\`([^`]*)\`/g)?.map((p) => p.replace(/^["'`]|["'`]$/g, '')) || [];

    if (parts.length < 2) {
      return ctx.reply('❌ Minimum: /saveid GameName GameID\n\nExample: `/saveid FreeFire 987654`', {
        parse_mode: 'Markdown',
      });
    }

    const [gameName, gameId, ...rest] = parts;
    const hasZone = rest.length && /^\d+$/.test(rest[0]);
    const zoneId   = hasZone ? rest[0] : null;
    const nickname = rest[hasZone ? 1 : 0] || null;

    try {
      const entry = await saveEntry(ctx.from.id, { gameName, gameId, zoneId, nickname });
      await ctx.reply(
        `✅ *Game ID Saved!*\n\n` +
        `🎮 Game: *${entry.gameName}*\n` +
        `🆔 ID: \`${entry.gameId}\`` +
        (entry.zoneId ? `\n🗺 Zone: \`${entry.zoneId}\`` : '') +
        (entry.nickname !== entry.gameId ? `\n📝 Label: *${entry.nickname}*` : '') +
        `\n${entry.isDefault ? '\n⭐ Set as default for this game' : ''}`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  // ── Inline: start save flow ────────────────────────────────────────────────
  bot.action('ab_start_save', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
      `📖 *Save a Game ID*\n\nUse:\n\`/saveid GameName GameID [ZoneID] [Nickname]\`\n\nExample:\n\`/saveid MobileLegends 123456 9001 MyMain\``,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Inline: start delete flow ──────────────────────────────────────────────
  bot.action('ab_start_delete', async (ctx) => {
    await ctx.answerCbQuery();
    const user = await User.findByTelegramId(ctx.from.id);
    if (!user) return;

    const entries = await AddressBook.find({ userId: user._id });
    if (!entries.length) return ctx.reply('No saved IDs to delete.');

    const buttons = entries.map((e) => [
      Markup.button.callback(
        `🗑 ${e.gameName}: ${formatEntry(e)}`,
        `ab_delete:${e._id}`
      ),
    ]);

    await ctx.reply('Select an ID to delete:', {
      ...Markup.inlineKeyboard([...buttons, [Markup.button.callback('❌ Cancel', 'ab_cancel')]]),
    });
  });

  bot.action(/^ab_delete:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const entryId = ctx.match[1];
    try {
      const entry = await deleteEntry(ctx.from.id, entryId);
      await ctx.editMessageText(`✅ Deleted: ${entry.gameName} — ${entry.gameId}`);
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`);
    }
  });

  bot.action('ab_cancel', async (ctx) => {
    await ctx.answerCbQuery('Cancelled');
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  });

  // ── /deleteid ──────────────────────────────────────────────────────────────
  bot.command('deleteid', async (ctx) => {
    const user = await User.findByTelegramId(ctx.from.id);
    if (!user) return;

    const entries = await AddressBook.find({ userId: user._id });
    if (!entries.length) return ctx.reply('📖 No saved IDs to delete.');

    const buttons = entries.map((e) => [
      Markup.button.callback(
        `🗑 ${e.gameName}: ${formatEntry(e)}`,
        `ab_delete:${e._id}`
      ),
    ]);

    await ctx.reply('Select an ID to delete:', {
      ...Markup.inlineKeyboard([...buttons, [Markup.button.callback('❌ Cancel', 'ab_cancel')]]),
    });
  });
};
