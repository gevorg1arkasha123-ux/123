import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { config, packages } from './config.js';
import { upsertUser, getUser, recordPayment, addBalance } from './db.js';

export const bot = config.botToken ? new Bot(config.botToken) : null;

const appButton = () => new InlineKeyboard().webApp('🎬 Открыть приложение', config.publicUrl);

if (bot) {
  bot.command('start', async (ctx) => {
    const u = upsertUser(ctx.from, config.startBonus);
    await ctx.reply(
      `Привет, ${ctx.from.first_name || 'друг'}! 👋\n\n`
      + 'Здесь можно сделать видео по готовому шаблону, сгенерировать картинку, озвучку и многое другое.\n\n'
      + `💰 Баланс: ${u.balance} монет\n\nЖми кнопку ниже 👇`,
      { reply_markup: appButton() },
    );
  });

  bot.command('balance', async (ctx) => {
    const u = upsertUser(ctx.from, config.startBonus);
    await ctx.reply(`💰 Баланс: ${u.balance} монет`, { reply_markup: appButton() });
  });

  // /give <user_id> <amount> — только для админов
  bot.command('give', async (ctx) => {
    if (!config.adminIds.includes(String(ctx.from.id))) return;
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
    recordPayment(p.telegram_payment_charge_id, ctx.from.id, p.total_amount, pkg.credits);
    await ctx.reply(`✅ Зачислено ${pkg.credits} монет. Баланс: ${getUser(ctx.from.id).balance}`, { reply_markup: appButton() });
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
