import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { config, packages, tools } from './config.js';
import { upsertUser, getUser, recordPayment, addBalance, stats } from './db.js';

export const bot = config.botToken ? new Bot(config.botToken) : null;

const appButton = () => new InlineKeyboard().webApp('🎬 Открыть приложение', config.publicUrl);
const isAdmin = (ctx) => config.adminIds.includes(String(ctx.from.id));

// Реферальная ссылка вида https://t.me/<bot>?start=ref_<id>
export const refLink = (userId) => (bot?.botInfo ? `https://t.me/${bot.botInfo.username}?start=ref_${userId}` : null);
export const parseRef = (s) => Number(/^ref_(\d+)$/.exec(s || '')?.[1]) || null;

if (bot) {
  bot.command('start', async (ctx) => {
    const isNew = !getUser(ctx.from.id);
    const u = upsertUser(ctx.from, config.startBonus, parseRef(ctx.match));
    if (isNew && u.referrer_id) {
      bot.api.sendMessage(u.referrer_id, `🎉 По вашей ссылке пришёл новый пользователь! Вы будете получать ${config.refPercent}% монет с каждой его покупки.`).catch(() => {});
    }
    await ctx.reply(
      `Привет, ${ctx.from.first_name || 'друг'}! 👋\n\n`
      + 'Здесь можно сделать видео по готовому шаблону, сгенерировать картинку, озвучку и многое другое.\n\n'
      + `💰 Баланс: ${u.balance} монет\n\nЖми кнопку ниже 👇`,
      { reply_markup: appButton() },
    );
  });

  bot.command('invite', async (ctx) => {
    upsertUser(ctx.from, config.startBonus);
    await ctx.reply(`Приглашайте друзей и получайте ${config.refPercent}% монет с каждой их покупки 🎁\n\nВаша ссылка:\n${refLink(ctx.from.id)}`);
  });

  // Сводка доходов и расходов — только для админов
  bot.command('stats', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const s = stats();
    const usd = (n) => `$${n.toFixed(2)}`;
    const rev = s.stars * config.starUsd;
    const revDay = s.starsDay * config.starUsd;
    await ctx.reply(
      '📊 Статистика\n\n'
      + `👥 Пользователи: ${s.users} (+${s.usersDay} за сутки), платящих: ${s.payers}\n`
      + `🎬 Генераций: ${s.jobs} (${s.jobsDay} за сутки)\n\n`
      + `⭐ Получено звёзд: ${s.stars} ≈ ${usd(rev)} (за сутки ${s.starsDay} ≈ ${usd(revDay)})\n`
      + `🤖 Потрачено на fal.ai ≈ ${usd(s.falUsd)} (за сутки ${usd(s.falUsdDay)})\n`
      + `🎁 Выдано реферальных монет: ${s.refPaid}\n\n`
      + `💵 Прибыль ≈ ${usd(rev - s.falUsd)} (за сутки ${usd(revDay - s.falUsdDay)})\n\n`
      + 'Расходы fal.ai — оценка по falUsd из config.js. Точные цифры — в личном кабинете fal.ai. '
      + 'Сервер в расчёт не входит. Звёзды можно вывести через Fragment не раньше чем через 21 день.',
    );
  });

  // Цены, себестоимость и маржа по каждому инструменту — только для админов
  bot.command('prices', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const lines = Object.values(tools).map((t) => {
      const income = t.cost * config.starUsd;
      return `${t.title}: ${t.cost} мон. ≈ $${income.toFixed(2)} | fal ≈ $${t.falUsd.toFixed(2)} | прибыль ≈ $${(income - t.falUsd).toFixed(2)}`;
    });
    await ctx.reply(`💰 Наценка ×${config.markup}, 1 звезда ≈ $${config.starUsd}\n\n${lines.join('\n')}`);
  });

  bot.command('balance', async (ctx) => {
    const u = upsertUser(ctx.from, config.startBonus);
    await ctx.reply(`💰 Баланс: ${u.balance} монет`, { reply_markup: appButton() });
  });

  // /give <user_id> <amount> — только для админов
  bot.command('give', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const [id, amount] = ctx.match.split(/\s+/).map(Number);
    if (!id || !amount || !getUser(id)) return ctx.reply('Использование: /give <user_id> <монеты>');
    addBalance(id, amount);
    await ctx.reply(`Готово. Баланс ${id}: ${getUser(id).balance}`);
  });

  bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

  bot.on('message:successful_payment', async (ctx) => {
    const p = ctx.message.successful_payment;
    const pkg = packages.find((x) => p.invoice_payload === `pkg:${x.id}:${ctx.from.id}`);
    if (!pkg) return;
    upsertUser(ctx.from, config.startBonus);
    const r = recordPayment(p.telegram_payment_charge_id, ctx.from.id, p.total_amount, pkg.credits, config.refPercent);
    if (!r) return;
    await ctx.reply(`✅ Зачислено ${pkg.credits} монет. Баланс: ${getUser(ctx.from.id).balance}`, { reply_markup: appButton() });
    if (r.bonus > 0) {
      bot.api.sendMessage(r.referrerId, `🎁 Ваш друг пополнил баланс — вам начислено ${r.bonus} монет!`).catch(() => {});
    }
    for (const admin of config.adminIds) {
      bot.api.sendMessage(admin, `💸 Оплата: ${p.total_amount} ⭐ от ${ctx.from.first_name || ''} ${ctx.from.username ? '@' + ctx.from.username : ''} (${ctx.from.id})`).catch(() => {});
    }
  });

  bot.catch((err) => console.error('bot error', err.error));
}

export async function createInvoice(userId, pkgId) {
  const pkg = packages.find((p) => p.id === pkgId);
  if (!pkg || !bot) throw new Error('Пакет не найден');
  // Валюта XTR = Telegram Stars, provider_token для неё пустой
  return bot.api.createInvoiceLink(
    pkg.title, `Пополнение баланса на ${pkg.credits} монет`, `pkg:${pkg.id}:${userId}`,
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
