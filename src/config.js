import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  botToken: process.env.BOT_TOKEN || '',
  // Публичный HTTPS-адрес сервера (нужен и для Mini App, и чтобы fal.ai мог скачать загруженные фото)
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),
  port: Number(process.env.PORT || 3000),
  falKey: process.env.FAL_KEY || '',
  adminIds: (process.env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  startBonus: Number(process.env.START_BONUS || 50),
  // В режиме разработки можно открыть Mini App в обычном браузере без Telegram
  devAuth: process.env.DEV_AUTH === '1',
  dbPath: process.env.DB_PATH || path.join(ROOT, 'data', 'app.db'),
  uploadsDir: path.join(ROOT, 'uploads'),

  // ---- Экономика ----
  // Сколько долларов вы реально получаете за 1 Telegram Star при выводе через Fragment (~$0.013).
  // 1 монета = 1 звезда в базовом пакете, поэтому это и «себестоимость» одной монеты для пользователя.
  starUsd: Number(process.env.STAR_USD || 0.013),
  // Наценка: 2.5 = пользователь платит в 2.5 раза больше, чем стоит генерация на fal.ai.
  // Из разницы оплачиваются сервер, реферальные бонусы и ваша прибыль.
  markup: Number(process.env.MARKUP || 2.5),
  // Сколько % от купленных монет получает тот, кто пригласил покупателя
  refPercent: Number(process.env.REF_PERCENT || 10),
};

export const mockMode = !config.falKey;

// Цена в монетах = себестоимость на fal.ai × наценка / стоимость одной монеты
export const priceFor = (falUsd) => Math.max(1, Math.ceil((falUsd * config.markup) / config.starUsd));

// Пакеты пополнения: stars — цена в Telegram Stars, credits — сколько монет получит пользователь.
// Скидки на крупные пакеты уменьшают вашу маржу — учитывайте это при выборе наценки.
export const packages = [
  { id: 'p100', stars: 100, credits: 100, title: '100 монет' },
  { id: 'p300', stars: 280, credits: 300, title: '300 монет', badge: 'Выгодно' },
  { id: 'p1000', stars: 900, credits: 1000, title: '1000 монет', badge: '-10%' },
];

// Инструменты экрана «Что создадим?».
// model — эндпоинт fal.ai; falUsd — ПРИМЕРНАЯ себестоимость одной генерации в долларах.
// Сверьте falUsd с ценой на странице модели на fal.ai и поправьте при необходимости.
const toolDefs = {
  template: {
    title: 'Видео по шаблону', kind: 'video', falUsd: 0.28, // Kling 2.1 standard, 5 сек × $0.056
    model: 'fal-ai/kling-video/v2.1/standard/image-to-video',
  },
  motion: {
    title: 'Повторить видео', kind: 'video', falUsd: 0.6,
    model: 'fal-ai/kling-video/v3/standard/motion-control',
  },
  image: {
    title: 'Картинка', kind: 'image', falUsd: 0.04,
    model: 'fal-ai/flux/dev',
    editModel: 'fal-ai/flux-pro/kontext',
  },
  tryon: {
    title: 'Примерочная', kind: 'image', falUsd: 0.04,
    model: 'fal-ai/flux-pro/kontext/multi',
  },
  tts: {
    title: 'Озвучка', kind: 'audio', falUsd: 0.1, // до 1000 символов
    model: 'fal-ai/elevenlabs/tts/multilingual-v2',
  },
  audio: {
    title: 'Аудио', kind: 'audio', falUsd: 0.05,
    model: 'fal-ai/stable-audio',
  },
  upscale: {
    title: 'Улучшить качество', kind: 'image', falUsd: 0.05,
    model: 'fal-ai/clarity-upscaler',
  },
};

export const tools = Object.fromEntries(
  Object.entries(toolDefs).map(([k, t]) => [k, { ...t, cost: t.cost ?? priceFor(t.falUsd) }]),
);

// Шаблон может задать свои falUsd (например, для Veo 3) или фиксированный cost
export function loadTemplates() {
  const file = path.join(ROOT, 'data', 'templates.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).map((t) => {
    const falUsd = t.falUsd ?? tools.template.falUsd;
    return { ...t, falUsd, cost: t.cost ?? priceFor(falUsd) };
  });
}
