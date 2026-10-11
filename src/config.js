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
};

export const mockMode = !config.falKey;

// Пакеты пополнения: stars — цена в Telegram Stars, credits — сколько монет получит пользователь
export const packages = [
  { id: 'p100', stars: 100, credits: 100, title: '100 монет' },
  { id: 'p300', stars: 250, credits: 300, title: '300 монет', badge: 'Выгодно' },
  { id: 'p1000', stars: 750, credits: 1000, title: '1000 монет', badge: '-25%' },
];

// Инструменты экрана «Что создадим?». model — эндпоинт fal.ai, его можно поменять здесь.
export const tools = {
  template: {
    title: 'Видео по шаблону', cost: 30, kind: 'video',
    model: 'fal-ai/kling-video/v2.1/standard/image-to-video',
  },
  motion: {
    title: 'Повторить видео', cost: 60, kind: 'video',
    model: 'fal-ai/kling-video/v3/standard/motion-control',
  },
  image: {
    title: 'Картинка', cost: 5, kind: 'image',
    model: 'fal-ai/flux/dev',
    editModel: 'fal-ai/flux-pro/kontext',
  },
  tryon: {
    title: 'Примерочная', cost: 10, kind: 'image',
    model: 'fal-ai/flux-pro/kontext/multi',
  },
  tts: {
    title: 'Озвучка', cost: 5, kind: 'audio',
    model: 'fal-ai/elevenlabs/tts/multilingual-v2',
  },
  audio: {
    title: 'Аудио', cost: 10, kind: 'audio',
    model: 'fal-ai/stable-audio',
  },
  upscale: {
    title: 'Улучшить качество', cost: 8, kind: 'image',
    model: 'fal-ai/clarity-upscaler',
  },
};

export function loadTemplates() {
  const file = path.join(ROOT, 'data', 'templates.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
