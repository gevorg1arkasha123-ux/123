import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { config, packages, tools, loadTemplates, addTemplate, deleteTemplate } from './config.js';
import { upsertUser, getUser, recordPayment, addBalance, stats } from './db.js';

export const bot = config.botToken ? new Bot(config.botToken) : null;

const appButton = () => new InlineKeyboard().webApp('🎬 Открыть приложение', config.publicUrl);
const isAdmin = (ctx) => config.adminIds.includes(String(ctx.from?.id));
const rubFmt = (n) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
const who = (u) => `${u.first_name || ''} ${u.username ? '@' + u.username : ''} (${u.id})`.trim();

// Реферальная ссылка вида https://t.me/<bot>?start=ref_<id>
export const refLink = (userId) => (bot?.botInfo ? `https://t.me/${bot.botInfo.username}?start=ref_${userId}` : null);
export const parseRef = (s) => Number(/^ref_(\d+)$/.exec(s || '')?.[1]) || null;

export function notifyAdmins(text) {
  for (const admin of config.adminIds) bot?.api.sendMessage(admin, text).catch(() => {});
}

// Зачисление после оплаты (Stars или ЮKassa): сообщения клиенту, пригласившему и админам
export async function announcePayment({ userId, credits, referrerId, bonus, label }) {
  if (!bot) return;
  await bot.api.sendMessage(userId, `✅ Оплата прошла! Зачислено ${credits} ₽. Баланс: ${getUser(userId).balance} ₽`, { reply_markup: appButton() }).catch(() => {});
  if (bonus > 0) bot.api.sendMessage(referrerId, `🎁 Ваш друг пополнил баланс — вам начислено ${bonus} ₽ на баланс!`).catch(() => {});
  notifyAdmins(`💸 Оплата ${label} от ${who(getUser(userId))}`);
}

// Скачивает файл, присланный боту, в папку uploads и возвращает публичную ссылку
async function saveTelegramFile(fileId, ext) {
  const file = await bot.api.getFile(fileId);
  const res = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`);
  if (!res.ok) throw new Error('Не удалось скачать файл из Telegram');
  const name = `${crypto.randomBytes(12).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(config.uploadsDir, name), Buffer.from(await res.arrayBuffer()));
  return `${config.publicUrl}/uploads/${name}`;
}

const ADMIN_HELP = `🛠 Команды владельца

/stats — выручка, расходы и прибыль
/prices — цены и маржа по инструментам
/templates — список шаблонов (с кнопками удаления)
/give <user_id> <монеты> — начислить монеты
/broadcast <текст> — рассылка всем пользователям

➕ Новый шаблон-тренд: просто отправьте мне видео (до 20 МБ, лучше 5–10 сек) — я спрошу название.
Можно сразу подписью: Название (категория будет «Тренды»).
Для тонкой настройки: Название | Категория | Подсказка для клиента
Движения из видео будут переноситься на фото клиента.`;

if (bot) {
  bot.command('start', async (ctx) => {
    const isNew = !getUser(ctx.from.id);
    const u = upsertUser(ctx.from, config.startBonus, parseRef(ctx.match));
    if (isNew && u.referrer_id) {
      bot.api.sendMessage(u.referrer_id, `🎉 По вашей ссылке пришёл новый пользователь! Вы будете получать ${config.refPercent}% от каждой его покупки.`).catch(() => {});
    }
    await ctx.reply(
      `Привет, ${ctx.from.first_name || 'друг'}! 👋\n\n`
      + '🎬 Видео по трендовым шаблонам — просто добавь своё фото\n'
      + '✍️ Видео по описанию — напиши, что снять\n'
      + '📸 Оживление фото, картинки, примерочная, озвучка\n\n'
      + `🎁 Тебе подарено ${config.startBonus} ₽ на баланс. Баланс: ${u.balance} ₽\n\nЖми кнопку ниже 👇`,
      { reply_markup: appButton() },
    );
    if (isAdmin(ctx)) await ctx.reply(ADMIN_HELP);
  });

  bot.command('balance', async (ctx) => {
    const u = upsertUser(ctx.from, config.startBonus);
    await ctx.reply(`💰 Баланс: ${u.balance} ₽`, { reply_markup: appButton() });
  });

  bot.command('invite', async (ctx) => {
    upsertUser(ctx.from, config.startBonus);
    await ctx.reply(`Приглашайте друзей и получайте ${config.refPercent}% от каждой их покупки 🎁\n\nВаша ссылка:\n${refLink(ctx.from.id)}`);
  });

  bot.command('help', async (ctx) => {
    const support = config.supportUsername ? `\n\nПоддержка: @${config.supportUsername}` : '';
    await ctx.reply(`Откройте приложение кнопкой ниже, выберите шаблон или инструмент и загрузите фото. Готовый результат придёт сюда в чат.${support}`, { reply_markup: appButton() });
    if (isAdmin(ctx)) await ctx.reply(ADMIN_HELP);
  });

  /* ---------- команды владельца ---------- */
  bot.command('admin', async (ctx) => { if (isAdmin(ctx)) await ctx.reply(ADMIN_HELP); });

  bot.command('stats', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const s = stats();
    // rub в payments хранится только для ЮKassa; звёзды переводим по курсу вывода
    const starRub = config.starUsd * config.usdRub;
    const yk = s.rub;
    const ykDay = s.rubDay;
    const rev = yk + s.stars * starRub;
    const revDay = ykDay + s.starsDay * starRub;
    const cost = s.falUsd * config.usdRub;
    const costDay = s.falUsdDay * config.usdRub;
    await ctx.reply(
      '📊 Статистика (всего / за сутки)\n\n'
      + `👥 Пользователи: ${s.users} / +${s.usersDay}, платящих: ${s.payers}\n`
      + `🎬 Генераций: ${s.jobs} / ${s.jobsDay}\n\n`
      + `💳 Картой/СБП: ${rubFmt(yk)} / ${rubFmt(ykDay)}\n`
      + `⭐ Stars: ${s.stars} ≈ ${rubFmt(s.stars * starRub)} / ${s.starsDay} ≈ ${rubFmt(s.starsDay * starRub)}\n`
      + `💰 Выручка: ${rubFmt(rev)} / ${rubFmt(revDay)}\n\n`
      + `🤖 Расход на нейросети ≈ ${rubFmt(cost)} / ${rubFmt(costDay)}\n`
      + `💵 Прибыль ≈ ${rubFmt(rev - cost)} / ${rubFmt(revDay - costDay)}\n`
      + `🎁 Выдано реферальных монет: ${s.refPaid}\n\n`
      + 'Расход — оценка по ценам из config.js; точные суммы в кабинете fal.ai. '
      + 'Комиссия ЮKassa (~3%) и налог (4–6%) не вычтены.',
    );
  });

  bot.command('prices', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const line = (title, cost, falUsd) => {
      const c = falUsd * config.usdRub;
      return `${title}: ${cost} ₽ | себест. ≈ ${rubFmt(c)} | прибыль ≈ ${rubFmt(cost * config.coinRub - c)}`;
    };
    const lines = [];
    for (const t of Object.values(tools)) {
      if (t.variants) for (const v of Object.values(t.variants)) lines.push(line(`${t.title} · ${v.title}`, v.cost, v.falUsd));
      else lines.push(line(t.title, t.cost, t.falUsd));
    }
    await ctx.reply(`💰 Наценка ×${config.markup}, $1 = ${config.usdRub} ₽, 1 монета = ${config.coinRub} ₽\n\n${lines.join('\n')}`);
  });

  bot.command('give', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const [id, amount] = ctx.match.split(/\s+/).map(Number);
    if (!id || !amount || !getUser(id)) return ctx.reply('Использование: /give <user_id> <монеты>');
    addBalance(id, amount);
    await ctx.reply(`Готово. Баланс ${id}: ${getUser(id).balance}`);
  });

  bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const text = ctx.match.trim();
    if (!text) return ctx.reply('Использование: /broadcast <текст сообщения>');
    const { db } = await import('./db.js');
    const ids = db.prepare('SELECT id FROM users').all().map((r) => r.id);
    await ctx.reply(`Отправляю ${ids.length} пользователям…`);
    let ok = 0;
    for (const id of ids) {
      try { await bot.api.sendMessage(id, text, { reply_markup: appButton() }); ok++; } catch { /* пользователь заблокировал бота */ }
      await new Promise((r) => setTimeout(r, 40)); // лимит Telegram ~30 сообщений/сек
    }
    await ctx.reply(`Готово: доставлено ${ok} из ${ids.length}`);
  });

  bot.command('templates', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const list = loadTemplates();
    if (!list.length) return ctx.reply('Шаблонов нет. Отправьте видео с подписью, чтобы добавить.');
    for (const t of list.slice(0, 50)) {
      await ctx.reply(`${t.type === 'scene' ? '👥' : t.type === 'motion' ? '🎬' : '📸'} ${t.title} · ${t.category || '—'} · ${t.cost} ₽\nid: ${t.id}`, {
        reply_markup: new InlineKeyboard().text('🗑 Удалить', `del:${t.id}`),
      });
    }
  });

  bot.callbackQuery(/^del:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery();
    const ok = deleteTemplate(ctx.match[1]);
    await ctx.answerCallbackQuery(ok ? 'Удалено' : 'Уже удалён');
    await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n🗑 Удалён`).catch(() => {});
  });

  // Админ присылает видео → новый шаблон-тренд. Подпись (необязательно): «Название» или «Название | Категория | Подсказка».
  // Без подписи бот спросит название следующим сообщением.
  const pendingTemplates = new Map(); // adminId → видео, ждущее названия
  bot.on(['message:video', 'message:animation', 'message:document'], async (ctx, next) => {
    if (!isAdmin(ctx)) return next();
    const media = ctx.message.video || ctx.message.animation || ctx.message.document;
    if (ctx.message.document && !/^video\//.test(media.mime_type || '')) return next();
    if (media.file_size > 20 * 1024 * 1024) return ctx.reply('Видео больше 20 МБ — Telegram не даст боту его скачать. Сожмите или обрежьте его и пришлите снова.');
    const caption = (ctx.message.caption || '').trim();
    if (!caption) {
      pendingTemplates.set(ctx.from.id, media.file_id);
      return ctx.reply('🎬 Как назвать шаблон? Напиши название одним сообщением (или /cancel).');
    }
    return saveTemplate(ctx, media.file_id, caption);
  });

  bot.command('cancel', async (ctx, next) => {
    if (!pendingTemplates.delete(ctx.from?.id)) return next();
    return ctx.reply('Ок, шаблон не добавляю.');
  });

  bot.on('message:text', async (ctx, next) => {
    const fileId = pendingTemplates.get(ctx.from?.id);
    if (!fileId || !isAdmin(ctx) || ctx.message.text.startsWith('/')) return next();
    pendingTemplates.delete(ctx.from.id);
    return saveTemplate(ctx, fileId, ctx.message.text.trim());
  });

  async function saveTemplate(ctx, fileId, text) {
    const [title, category, hint] = text.split('|').map((x) => x.trim());
    const msg = await ctx.reply('⏳ Сохраняю шаблон…');
    try {
      const url = await saveTelegramFile(fileId, '.mp4');
      const id = `t${Date.now().toString(36)}`;
      addTemplate({ id, title, category: category || 'Тренды', hint: hint || 'Фото в полный рост, хорошо видно лицо', video: url, preview: url });
      await bot.api.editMessageText(ctx.chat.id, msg.message_id, `✅ Шаблон «${title}» добавлен и уже виден в приложении.\nid: ${id}`, {
        reply_markup: new InlineKeyboard().text('🗑 Удалить', `del:${id}`),
      });
    } catch (e) {
      await bot.api.editMessageText(ctx.chat.id, msg.message_id, `❌ ${e.message}`);
    }
  }

  /* ---------- оплата Telegram Stars ---------- */
  bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

  bot.on('message:successful_payment', async (ctx) => {
    const p = ctx.message.successful_payment;
    const pkg = packages.find((x) => p.invoice_payload === `pkg:${x.id}:${ctx.from.id}`);
    if (!pkg) return;
    upsertUser(ctx.from, config.startBonus);
    const r = recordPayment(p.telegram_payment_charge_id, ctx.from.id, { method: 'stars', stars: p.total_amount }, pkg.credits, config.refPercent);
    if (r) await announcePayment({ userId: ctx.from.id, credits: pkg.credits, ...r, label: `${p.total_amount} ⭐` });
  });

  bot.catch((err) => console.error('bot error', err.error));
}

export async function createStarsInvoice(userId, pkgId) {
  const pkg = packages.find((p) => p.id === pkgId);
  if (!pkg || !bot) throw new Error('Пакет не найден');
  // Валюта XTR = Telegram Stars, provider_token для неё пустой
  return bot.api.createInvoiceLink(
    pkg.title, `Пополнение баланса на ${pkg.credits} ₽`, `pkg:${pkg.id}:${userId}`,
    '', 'XTR', [{ label: pkg.title, amount: pkg.stars }],
  );
}

// Отправляет результат генерации в чат с ботом
export async function notifyJob(job) {
  if (!bot) return;
  const kb = appButton();
  if (job.status === 'failed') {
    await bot.api.sendMessage(job.user_id, `❌ «${job.title}» — не получилось. Монеты (${job.cost}) возвращены.`, { reply_markup: kb });
    return;
  }
  const caption = `✅ «${job.title}» готово!`;
  const url = job.result_url;
  try {
    const file = new InputFile(new URL(url));
    if (job.kind === 'video' && !/\.(png|jpe?g|webp|svg)(\?|$)/i.test(url)) await bot.api.sendVideo(job.user_id, file, { caption, reply_markup: kb });
    else if (job.kind === 'audio') await bot.api.sendAudio(job.user_id, file, { caption, reply_markup: kb });
    else await bot.api.sendDocument(job.user_id, file, { caption, reply_markup: kb });
  } catch {
    await bot.api.sendMessage(job.user_id, `${caption}\n${url}`, { reply_markup: kb });
  }
}
