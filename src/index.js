import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { ROOT, config, mockMode, provider, yookassaEnabled, packages, tools, loadTemplates } from './config.js';
import { verifyInitData } from './auth.js';
import { upsertUser, getUser, userJobs, refStats } from './db.js';
import { startJob, startPoller, setNotifier } from './generate.js';
import { bot, createStarsInvoice, notifyJob, refLink, parseRef, announcePayment } from './bot.js';
import { createYookassaPayment, handleWebhook, startYookassaPoller, setYookassaPaidHandler } from './yookassa.js';

fs.mkdirSync(config.uploadsDir, { recursive: true });

const ALLOWED = /^(image\/(jpeg|png|webp|heic)|video\/(mp4|quicktime|webm))$/;
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadsDir,
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.bin').toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, crypto.randomBytes(12).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED.test(file.mimetype)),
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));
app.use('/uploads', express.static(config.uploadsDir));

// Уведомления ЮKassa. Статус платежа всё равно перепроверяется через API, поэтому подделать оплату нельзя.
app.post('/webhook/yookassa', async (req, res) => {
  try { await handleWebhook(req.body); } catch (e) { console.error('yookassa webhook', e.message); }
  res.sendStatus(200);
});

// Авторизация через подписанный Telegram initData
app.use('/api', (req, res, next) => {
  let tgUser = verifyInitData(req.get('X-Init-Data'));
  if (!tgUser && config.devAuth) tgUser = { id: 1, first_name: 'Dev', username: 'dev' };
  if (!tgUser) return res.status(401).json({ error: 'Откройте приложение через Telegram' });
  req.user = upsertUser(tgUser, config.startBonus, parseRef(tgUser.start_param));
  next();
});

app.get('/api/me', (req, res) => {
  res.json({
    user: getUser(req.user.id),
    mock: mockMode,
    packages,
    payments: { card: yookassaEnabled, stars: Boolean(bot) },
    support: config.supportUsername || null,
    ref: { link: refLink(req.user.id), percent: config.refPercent, earned: getUser(req.user.id).ref_earned, ...refStats(req.user.id) },
    tools: Object.fromEntries(Object.entries(tools).map(([k, v]) => [k, {
      title: v.title, cost: v.cost, kind: v.kind,
      variants: v.variants && Object.fromEntries(Object.entries(v.variants).map(([vk, x]) => [vk, { title: x.title, desc: x.desc, cost: x.cost }])),
    }])),
  });
});

// Клиенту не отдаём промпты и себестоимость
app.get('/api/templates', (_req, res) => res.json(loadTemplates().map(({ prompt, falUsd, model, video, refVideo, ...t }) => t)));

app.get('/api/history', (req, res) => res.json({ jobs: userJobs(req.user.id), balance: getUser(req.user.id).balance }));

app.post('/api/pay/stars', async (req, res) => {
  try {
    res.json({ link: await createStarsInvoice(req.user.id, req.body.package) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/pay/card', async (req, res) => {
  try {
    res.json({ link: await createYookassaPayment(req.user.id, req.body.package) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const fileFields = upload.fields([{ name: 'image', maxCount: 1 }, { name: 'image2', maxCount: 1 }, { name: 'video', maxCount: 1 },
  { name: 'face1', maxCount: 1 }, { name: 'face2', maxCount: 1 }, { name: 'face3', maxCount: 1 }]);

app.post('/api/generate', fileFields, async (req, res) => {
  const { tool, template_id, prompt, voice, variant, aspect } = req.body;
  const f = req.files || {};
  const url = (k) => (f[k]?.[0] ? `${config.publicUrl}/uploads/${f[k][0].filename}` : undefined);
  // заказ не принят (нет денег, не хватает фото и т.п.) — загруженные файлы не нужны, не копим их на диске
  res.on('finish', () => {
    if (res.statusCode >= 400) for (const x of Object.values(f).flat()) fs.rm(x.path, { force: true }, () => {});
  });
  const params = {
    prompt: (prompt || '').trim().slice(0, 2000), voice, variant,
    aspect: ['9:16', '16:9', '1:1'].includes(aspect) ? aspect : '9:16',
    image_url: url('image'), image2_url: url('image2'), video_url: url('video') };

  if (tool === 'tts') params.prompt = params.prompt.slice(0, 1000); // себестоимость озвучки зависит от длины текста
  if (!tools[tool]) return res.status(400).json({ error: 'Неизвестный инструмент' });
  let template;
  if (tool === 'template') {
    template = loadTemplates().find((t) => t.id === template_id);
    if (!template) return res.status(400).json({ error: 'Шаблон не найден' });
  }
  const need = {
    template: ['image_url'], t2v: ['prompt'], i2v: ['image_url'], motion: ['image_url', 'video_url'], image: ['prompt'],
    tryon: ['image_url', 'image2_url'], tts: ['prompt'], audio: ['prompt'], upscale: ['image_url'],
  }[tool];
  if (template?.type === 'scene') {
    // по фото на каждую роль сцены
    params.face_urls = template.faces.map((_, i) => url(`face${i + 1}`));
    if (params.face_urls.some((u) => !u)) return res.status(400).json({ error: 'Загрузите фото для каждой роли' });
  } else if (need.some((k) => !params[k])) return res.status(400).json({ error: 'Заполните все поля и загрузите файлы' });

  try {
    const jobId = await startJob({ userId: req.user.id, tool, params, template });
    res.json({ job_id: jobId, balance: getUser(req.user.id).balance });
  } catch (e) {
    res.status(e.code === 'NO_BALANCE' ? 402 : 500).json({ error: e.message, code: e.code });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Ошибка сервера' });
});

app.listen(config.port, () => {
  console.log(`Сервер: http://localhost:${config.port}  (публичный адрес: ${config.publicUrl})`);
  if (mockMode) console.log('POLZA_API_KEY и FAL_KEY не заданы — работает ДЕМО-режим, генерация имитируется.');
  else console.log(`Генерация через ${provider === 'polza' ? 'Polza.ai (рубли)' : 'fal.ai'}`);
  if (!yookassaEnabled) console.log('ЮKassa не настроена — оплата картой/СБП скрыта, доступны только Stars.');
});

setNotifier(notifyJob);
startPoller();
setYookassaPaidHandler((p) => announcePayment({ ...p, label: `${p.rub} ₽ (карта/СБП)` }));
startYookassaPoller();

if (bot) {
  await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Открыть', web_app: { url: config.publicUrl } } })
    .catch((e) => console.warn('Не удалось поставить кнопку меню (нужен HTTPS PUBLIC_URL):', e.message));
  // Без меню команд: у клиента только кнопка «Открыть»
  await bot.api.deleteMyCommands().catch(() => {});
  // Тексты профиля: «Что умеет этот бот?» в пустом чате и короткое описание в карточке бота
  await bot.api.setMyDescription({
    description: '🎬 KVQ AI — ролики с вашим лицом за пару минут.\n\n'
      + '🔥 Трендовые шаблоны: выберите сюжет, добавьте фото — нейросеть снимет вас в главной роли.\n'
      + '✍️ Видео по описанию, оживление фото, картинки, примерочная, озвучка.\n\n'
      + 'Оплата в рублях, результат приходит прямо в чат. Жмите «Запустить» 👇',
  }).catch(() => {});
  await bot.api.setMyShortDescription({ short_description: 'Ролики с вашим лицом по трендовым шаблонам. Фото → видео за пару минут.' }).catch(() => {});
  bot.start({ onStart: (me) => console.log(`Бот @${me.username} запущен`) });
} else {
  console.log('BOT_TOKEN не задан — бот не запущен, работает только веб-часть.');
}
