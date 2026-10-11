import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  botToken: process.env.BOT_TOKEN || '',
  // Публичный HTTPS-адрес сервера (нужен и для Mini App, и чтобы fal.ai мог скачать загруженные фото)
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),
  port: num(process.env.PORT, 3000),
  falKey: process.env.FAL_KEY || '',
  // Ключ https://polza.ai — российский посредник с оплатой в рублях (картой РФ / СБП). Если задан, используется вместо fal.ai
  polzaKey: process.env.POLZA_API_KEY || '',
  adminIds: (process.env.ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  startBonus: num(process.env.START_BONUS, 50),
  supportUsername: (process.env.SUPPORT_USERNAME || '').replace(/^@/, ''),
  // В режиме разработки можно открыть Mini App в обычном браузере без Telegram
  devAuth: process.env.DEV_AUTH === '1',
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  uploadsDir: process.env.UPLOADS_DIR || path.join(ROOT, 'uploads'),

  // ---- ЮKassa (карты, СБП, T-Pay, SberPay) ----
  yookassaShopId: process.env.YOOKASSA_SHOP_ID || '',
  yookassaSecret: process.env.YOOKASSA_SECRET_KEY || '',

  // ---- Экономика ----
  // 1 монета = COIN_RUB рублей. По умолчанию 1 монета = 1 ₽ — так клиенту проще считать.
  coinRub: num(process.env.COIN_RUB, 1),
  // Курс доллара: fal.ai выставляет счёт в долларах
  usdRub: num(process.env.USD_RUB, 85),
  // Наценка: 2.5 = клиент платит в 2.5 раза больше, чем стоит генерация на fal.ai
  markup: num(process.env.MARKUP, 2.5),
  // Сколько $ вы получаете за 1 Telegram Star при выводе через Fragment (~$0.013)
  starUsd: num(process.env.STAR_USD, 0.013),
  // Сколько % от купленных монет получает тот, кто пригласил покупателя
  refPercent: num(process.env.REF_PERCENT, 10),
};
config.dbPath = process.env.DB_PATH || path.join(config.dataDir, 'app.db');

// Кто генерирует: polza (рубли) → fal (доллары) → демо-режим без ключей
export const provider = config.polzaKey ? 'polza' : config.falKey ? 'fal' : 'mock';
export const mockMode = provider === 'mock';
export const yookassaEnabled = Boolean(config.yookassaShopId && config.yookassaSecret);

// Цена в монетах = себестоимость на fal.ai ($) × курс × наценка / цена монеты
export const priceFor = (falUsd) => Math.max(1, Math.ceil((falUsd * config.usdRub * config.markup) / config.coinRub));
// Сколько звёзд взять за пакет, чтобы после вывода получить ту же сумму в рублях
const starsFor = (rub) => Math.ceil(rub / (config.starUsd * config.usdRub));

// Пакеты пополнения. rub — цена в рублях (ЮKassa), credits — сколько монет получит клиент.
// Бонусные монеты в крупных пакетах немного снижают маржу.
export const packages = [
  { id: 'p199', rub: 199, credits: 200, title: '200 монет' },
  { id: 'p490', rub: 490, credits: 550, title: '550 монет', badge: '+10%' },
  { id: 'p990', rub: 990, credits: 1200, title: '1200 монет', badge: 'Хит' },
  { id: 'p2490', rub: 2490, credits: 3200, title: '3200 монет', badge: '+28%' },
].map((p) => ({ ...p, stars: starsFor(p.rub) }));

// Два уровня качества для видео по описанию и «оживления» фото. Клиент видит только «Стандарт» и «Премиум».
// falUsd — ПРИМЕРНАЯ себестоимость одного ролика на fal.ai. Сверьте с ценой на странице модели.
const videoModels = {
  kling: {
    title: 'Стандарт', desc: '5 сек · со звуком · быстро', falUsd: 0.5, // Kling 3
    t2v: 'fal-ai/kling-video/v3/standard/text-to-video',
    i2v: 'fal-ai/kling-video/v3/standard/image-to-video',
  },
  seedance: {
    title: 'Премиум', desc: '5 сек · со звуком · кино-качество', falUsd: 1.55, // Seedance 2
    t2v: 'bytedance/seedance-2.0/text-to-video',
    i2v: 'bytedance/seedance-2.0/image-to-video',
  },
};

// Инструменты. model — эндпоинт fal.ai; falUsd — примерная себестоимость одной генерации в $.
const toolDefs = {
  template: {
    title: 'Видео по шаблону', kind: 'video', falUsd: 0.7, // Kling 3 Motion Control, до ~10 сек
    model: 'fal-ai/kling-video/v3/standard/motion-control',
    i2vModel: 'fal-ai/kling-video/v3/standard/image-to-video', // для шаблонов без образцового видео
  },
  t2v: { title: 'Видео по описанию', kind: 'video', variants: videoModels },
  i2v: { title: 'Оживить фото', kind: 'video', variants: videoModels },
  motion: {
    title: 'Повторить видео', kind: 'video', falUsd: 0.7,
    model: 'fal-ai/kling-video/v3/standard/motion-control',
  },
  image: {
    title: 'Картинка', kind: 'image', falUsd: 0.04,
    model: 'fal-ai/nano-banana',
    editModel: 'fal-ai/nano-banana/edit',
  },
  tryon: {
    title: 'Примерочная', kind: 'image', falUsd: 0.04,
    model: 'fal-ai/nano-banana/edit',
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

// Модели Polza.ai и ПРИМЕРНАЯ себестоимость одного запуска в ₽ (цены: https://polza.ai/models).
// В режиме polza себестоимость пересчитывается в falUsd = rub / USD_RUB, поэтому цены, /stats и /prices работают как раньше.
export const polzaModels = {
  video: {
    kling: { model: 'kling/v3', rub: 70 }, // 14 ₽/сек со звуком × 5 сек
    seedance: { model: 'bytedance/seedance-2', rub: 140 }, // ~28 ₽/сек 720p × 5 сек
  },
  template: { model: 'kling/v3-motion-control', i2vModel: 'kling/v3', rub: 140 }, // 14 ₽/сек 720p, до ~10 сек
  motion: { model: 'kling/v3-motion-control', rub: 140 },
  image: { model: 'google/gemini-nano-banana-2.1', rub: 3 },
  tryon: { model: 'google/gemini-nano-banana-2.1', rub: 3 },
  tts: { model: 'elevenlabs/eleven-v4', rub: 2 }, // ~1,2 ₽ за 1000 символов
  audio: { model: 'suno/sounds', rub: 2 },
  upscale: { model: 'topaz/image-upscale', rub: 7.5 },
};
if (provider === 'polza') {
  for (const [k, v] of Object.entries(polzaModels.video)) videoModels[k].falUsd = v.rub / config.usdRub;
  for (const [k, v] of Object.entries(polzaModels)) if (toolDefs[k] && v.rub) toolDefs[k].falUsd = v.rub / config.usdRub;
}

export const tools = Object.fromEntries(Object.entries(toolDefs).map(([k, t]) => {
  if (!t.variants) return [k, { ...t, cost: priceFor(t.falUsd) }];
  const variants = Object.fromEntries(Object.entries(t.variants).map(([vk, v]) => [vk, { ...v, cost: priceFor(v.falUsd) }]));
  return [k, { ...t, variants, cost: Math.min(...Object.values(variants).map((v) => v.cost)) }];
}));

// Себестоимость и цена конкретного запуска (с учётом выбранной нейросети или шаблона)
export function resolveTool(tool, variant, template) {
  const t = tools[tool];
  if (template) return { falUsd: template.falUsd, cost: template.cost, title: template.title };
  if (t.variants) {
    const v = t.variants[variant] || Object.values(t.variants)[0];
    return { ...v, title: `${t.title} · ${v.title}` };
  }
  return { falUsd: t.falUsd, cost: t.cost, title: t.title };
}

// ---- Шаблоны ----
// Рабочий файл лежит в data/ (в Docker это постоянный том), стартовый набор — в templates.default.json
const templatesFile = path.join(config.dataDir, 'templates.json');
const defaultTemplatesFile = path.join(ROOT, 'templates.default.json');

function readTemplatesRaw() {
  if (!fs.existsSync(templatesFile)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.copyFileSync(defaultTemplatesFile, templatesFile);
  }
  return JSON.parse(fs.readFileSync(templatesFile, 'utf8'));
}

// type "motion" — шаблон с образцовым видео: движения переносятся на фото клиента (как тренды в veo3 bot)
// type "i2v"    — без видео: фото оживляется по промпту
export function loadTemplates() {
  return readTemplatesRaw().map((t) => {
    const type = t.video ? 'motion' : 'i2v';
    const falUsd = t.falUsd ?? (type === 'motion' ? tools.template.falUsd : videoModels.kling.falUsd);
    return { ...t, type, falUsd, cost: t.cost ?? priceFor(falUsd) };
  });
}

export function saveTemplates(list) {
  const tmp = `${templatesFile}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(list, null, 2)}\n`);
  fs.renameSync(tmp, templatesFile);
}

export function addTemplate(tpl) {
  const list = readTemplatesRaw();
  list.unshift(tpl);
  saveTemplates(list);
}

export function deleteTemplate(id) {
  const list = readTemplatesRaw();
  const next = list.filter((t) => t.id !== id);
  saveTemplates(next);
  return next.length !== list.length;
}
