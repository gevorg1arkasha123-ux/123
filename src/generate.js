import https from 'node:https';
import { config, mockMode, provider, polzaModels, tools, resolveTool } from './config.js';
import { createJob, updateJob, getJob, pendingJobs, addBalance, chargeBalance } from './db.js';

const FAL_QUEUE = 'https://queue.fal.run';
const POLZA_MEDIA = 'https://polza.ai/api/v1/media';

async function falFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Key ${config.falKey}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(body?.detail ? JSON.stringify(body.detail) : `fal.ai HTTP ${res.status}`);
  return body;
}

async function polzaFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${config.polzaKey}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(`polza HTTP ${res.status}: ${JSON.stringify(body?.error || body?.message || body).slice(0, 300)}`);
  return body;
}

// POST к Polza держит соединение, пока результат не готов (у видео — минуты), поэтому без 5-минутного
// таймаута встроенного fetch: ждём до 20 минут.
function polzaSubmit(body) {
  return new Promise((resolve, reject) => {
    const req = https.request(POLZA_MEDIA, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.polzaKey}`, 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let b;
        try { b = JSON.parse(data); } catch { b = { raw: data }; }
        if (res.statusCode >= 400) reject(new Error(`polza HTTP ${res.statusCode}: ${JSON.stringify(b?.error?.message || b?.error || b).slice(0, 300)}`));
        else resolve(b);
      });
    });
    req.on('error', reject);
    req.setTimeout(20 * 60 * 1000, () => req.destroy(new Error('polza: превышено время ожидания результата')));
    req.end(JSON.stringify(body));
  });
}

const POLZA_DONE = /^(completed|succeeded|success|done|finished)$/;
const POLZA_FAILED = /^(failed|error|cancel+ed|rejected|expired)$/;

// То же, что buildRequest, но для Polza.ai: POST /api/v1/media { model, input }
export function buildPolzaRequest(tool, p, template) {
  const m = polzaModels;
  const sound = true;
  const video = (variant, extra) => (variant === 'seedance'
    ? { model: m.video.seedance.model, input: { resolution: '720p', duration: '5', generate_audio: sound, ...extra } }
    : { model: m.video.kling.model, input: { mode: 'std', duration: '5', sound, ...extra } });
  switch (tool) {
    case 'template':
      if (template.type === 'motion') {
        return {
          model: m.template.model,
          input: { prompt: template.prompt || '', images: [p.image_url], videos: [template.video], mode: '720p', character_orientation: 'video' },
        };
      }
      return { model: m.template.i2vModel, input: { prompt: template.prompt, images: [p.image_url], mode: 'std', duration: '5', sound } };
    case 't2v':
      return video(p.variant, { prompt: p.prompt, aspect_ratio: p.aspect || '9:16' });
    case 'i2v':
      return video(p.variant, { prompt: p.prompt || 'natural cinematic motion', images: [p.image_url] });
    case 'motion':
      return {
        model: m.motion.model,
        input: { prompt: p.prompt || '', images: [p.image_url], videos: [p.video_url], mode: '720p', character_orientation: 'video' },
      };
    case 'image':
      return p.image_url
        ? { model: m.image.model, input: { prompt: p.prompt, images: [p.image_url] } }
        : { model: m.image.model, input: { prompt: p.prompt, aspect_ratio: '9:16' } };
    case 'tryon':
      return {
        model: m.tryon.model,
        input: {
          prompt: p.prompt || 'Put the clothing from the second image on the person from the first image. Keep face, body, pose and background unchanged. Photorealistic.',
          images: [p.image_url, p.image2_url],
        },
      };
    case 'tts':
      return { model: m.tts.model, input: { text: p.prompt, voice: p.voice || 'Rachel' } };
    case 'audio':
      return { model: m.audio.model, input: { prompt: p.prompt } };
    case 'upscale':
      return { model: m.upscale.model, input: { images: [p.image_url], upscale_factor: '2' } };
    default:
      throw new Error('Неизвестный инструмент');
  }
}

// Ищет ссылку на результат в ответе Polza, не заходя во входные параметры (там лежат ссылки на исходники)
export function findResultUrl(node, depth = 0) {
  if (depth > 6 || node == null) return null;
  if (typeof node === 'string') return /^https?:\/\//.test(node) ? node : null;
  if (Array.isArray(node)) {
    for (const v of node) { const u = findResultUrl(v, depth + 1); if (u) return u; }
    return null;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (/^(input|inputs|request|params|parameters)$/i.test(k)) continue;
      const u = findResultUrl(v, depth + 1);
      if (u) return u;
    }
  }
  return null;
}

// Собирает модель и входные параметры fal.ai для конкретного инструмента
export function buildRequest(tool, p, template) {
  const t = tools[tool];
  const variant = t.variants ? (t.variants[p.variant] || Object.values(t.variants)[0]) : null;
  switch (tool) {
    case 'template':
      // Шаблон с образцовым видео: движения из видео переносятся на фото клиента
      if (template.type === 'motion') {
        return {
          model: template.model || t.model,
          input: {
            image_url: p.image_url, video_url: template.video, prompt: template.prompt || '',
            character_orientation: 'video', keep_original_sound: true,
          },
        };
      }
      return {
        model: template.model || t.i2vModel,
        input: { prompt: template.prompt, start_image_url: p.image_url, duration: '5' },
      };
    case 't2v':
      return {
        model: variant.t2v,
        input: { prompt: p.prompt, aspect_ratio: p.aspect || '9:16', duration: '5', generate_audio: true },
      };
    case 'i2v':
      return {
        model: variant.i2v,
        input: p.variant === 'seedance'
          ? { prompt: p.prompt || 'natural cinematic motion', image_url: p.image_url, duration: '5', generate_audio: true }
          : { prompt: p.prompt || 'natural cinematic motion', start_image_url: p.image_url, duration: '5', generate_audio: true },
      };
    case 'motion':
      return {
        model: t.model,
        input: { image_url: p.image_url, video_url: p.video_url, prompt: p.prompt || '', character_orientation: 'video', keep_original_sound: true },
      };
    case 'image':
      return p.image_url
        ? { model: t.editModel, input: { prompt: p.prompt, image_urls: [p.image_url] } }
        : { model: t.model, input: { prompt: p.prompt, aspect_ratio: '9:16' } };
    case 'tryon':
      return {
        model: t.model,
        input: {
          prompt: p.prompt || 'Put the clothing from the second image on the person from the first image. Keep face, body, pose and background unchanged. Photorealistic.',
          image_urls: [p.image_url, p.image2_url],
        },
      };
    case 'tts':
      return { model: t.model, input: { text: p.prompt, voice: p.voice || 'Rachel' } };
    case 'audio':
      return { model: t.model, input: { prompt: p.prompt, seconds_total: 30 } };
    case 'upscale':
      return { model: t.model, input: { image_url: p.image_url } };
    default:
      throw new Error('Неизвестный инструмент');
  }
}

// Достаёт ссылку на результат из ответа любой модели fal.ai
function extractUrl(out) {
  return out?.video?.url || out?.images?.[0]?.url || out?.image?.url
    || out?.audio?.url || out?.audio_file?.url || out?.audio_url?.url || null;
}

let notify = async () => {};
export function setNotifier(fn) { notify = fn; }

export async function startJob({ userId, tool, params, template }) {
  const t = tools[tool];
  const { cost, falUsd: estUsd, title } = resolveTool(tool, params.variant, template);
  const kind = t.kind;
  const { model, input } = provider === 'polza' ? buildPolzaRequest(tool, params, template) : buildRequest(tool, params, template);

  if (!chargeBalance(userId, cost)) {
    const err = new Error('Недостаточно монет');
    err.code = 'NO_BALANCE';
    throw err;
  }
  const falUsd = mockMode ? 0 : estUsd;
  const jobId = createJob({ userId, tool, title, kind, cost, model, falUsd });

  if (mockMode) {
    // Демо-режим без FAL_KEY: через 4 секунды «готово», в результате — загруженный файл или превью шаблона
    updateJob(jobId, { request_id: 'mock' });
    const result = template?.preview || params.video_url || params.image_url || `${config.publicUrl}/img/mock.svg`;
    setTimeout(() => finish(jobId, result), 4000);
    return jobId;
  }

  if (provider === 'polza') {
    // Клиенту отвечаем сразу, а результат ждём в фоне; если Polza вернула задачу в очереди — её добирает поллер
    updateJob(jobId, { request_id: 'polza-submit' });
    polzaSubmit({ model, input }).then((sub) => {
      const status = String(sub.status || '').toLowerCase();
      if (POLZA_FAILED.test(status)) return fail(jobId, sub.error?.message || sub.error || `polza: ${status}`);
      const url = POLZA_DONE.test(status) ? findResultUrl(sub) : null;
      if (url) return finish(jobId, url);
      const id = sub.id || sub.data?.id;
      if (!id) throw new Error(`polza: нет результата и id задачи: ${JSON.stringify(sub).slice(0, 200)}`);
      updateJob(jobId, { request_id: String(id), status_url: `${POLZA_MEDIA}/${id}`, response_url: `${POLZA_MEDIA}/${id}` });
    }).catch((e) => fail(jobId, e.message));
    return jobId;
  }

  try {
    const sub = await falFetch(`${FAL_QUEUE}/${model}`, { method: 'POST', body: JSON.stringify(input) });
    updateJob(jobId, {
      request_id: sub.request_id,
      status_url: sub.status_url || `${FAL_QUEUE}/${model}/requests/${sub.request_id}/status`,
      response_url: sub.response_url || `${FAL_QUEUE}/${model}/requests/${sub.request_id}`,
    });
  } catch (e) {
    fail(jobId, e.message);
  }
  return jobId;
}

function finish(jobId, url) {
  updateJob(jobId, { status: 'done', result_url: url });
  notify(getJob(jobId)).catch((e) => console.error('notify', e.message));
}

function fail(jobId, error) {
  const job = getJob(jobId);
  if (job.status !== 'queued') return;
  updateJob(jobId, { status: 'failed', error: String(error).slice(0, 500) });
  addBalance(job.user_id, job.cost); // возврат монет
  notify(getJob(jobId)).catch((e) => console.error('notify', e.message));
}

const MAX_AGE = 30 * 60 * 1000;

async function pollOnce() {
  for (const job of pendingJobs()) {
    if (job.request_id === 'mock') continue;
    if (job.request_id === 'polza-submit') {
      // отправка ещё идёт в фоне; если бот перезапускали посреди неё — вернуть монеты по таймауту
      if (Date.now() - job.created_at > MAX_AGE) fail(job.id, 'Превышено время ожидания');
      continue;
    }
    if (job.status_url?.startsWith(POLZA_MEDIA)) {
      try {
        const st = await polzaFetch(job.status_url);
        const status = String(st.status || st.data?.status || '').toLowerCase();
        if (POLZA_DONE.test(status)) {
          const url = findResultUrl(st);
          url ? finish(job.id, url) : fail(job.id, 'Модель не вернула результат');
        } else if (POLZA_FAILED.test(status)) {
          fail(job.id, st.error?.message || st.error || st.message || `polza: ${status}`);
        } else if (Date.now() - job.created_at > MAX_AGE) {
          fail(job.id, 'Превышено время ожидания');
        }
      } catch (e) {
        if (/HTTP 4\d\d/.test(e.message) || Date.now() - job.created_at > MAX_AGE) fail(job.id, e.message);
      }
      continue;
    }
    try {
      const st = await falFetch(job.status_url);
      if (st.status === 'COMPLETED') {
        const out = await falFetch(job.response_url);
        const url = extractUrl(out);
        url ? finish(job.id, url) : fail(job.id, 'Модель не вернула результат');
      } else if (Date.now() - job.created_at > MAX_AGE) {
        fail(job.id, 'Превышено время ожидания');
      }
    } catch (e) {
      // ошибка генерации на стороне fal.ai приходит при запросе результата
      if (/HTTP 4\d\d|detail/.test(e.message) || Date.now() - job.created_at > MAX_AGE) fail(job.id, e.message);
    }
  }
}

export function startPoller() {
  if (mockMode) return;
  const loop = async () => {
    try { await pollOnce(); } catch (e) { console.error('poll', e); }
    setTimeout(loop, 5000);
  };
  loop();
}
