import { config, mockMode, tools } from './config.js';
import { createJob, updateJob, getJob, pendingJobs, addBalance, chargeBalance } from './db.js';

const FAL_QUEUE = 'https://queue.fal.run';

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

// Собирает модель и входные параметры fal.ai для конкретного инструмента
export function buildRequest(tool, p, template) {
  const t = tools[tool];
  switch (tool) {
    case 'template':
      return {
        model: template.model || t.model,
        input: { prompt: template.prompt, image_url: p.image_url, duration: String(template.duration || 5) },
      };
    case 'motion':
      return {
        model: t.model,
        input: { image_url: p.image_url, video_url: p.video_url, prompt: p.prompt || '', character_orientation: 'video' },
      };
    case 'image':
      return p.image_url
        ? { model: t.editModel, input: { prompt: p.prompt, image_url: p.image_url } }
        : { model: t.model, input: { prompt: p.prompt, image_size: 'portrait_16_9' } };
    case 'tryon':
      return {
        model: t.model,
        input: {
          prompt: p.prompt || 'Put the clothing from the second image on the person from the first image. Keep face, pose and background unchanged. Photorealistic.',
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
  const cost = template?.cost ?? t.cost;
  const title = template ? template.title : t.title;
  const kind = template ? 'video' : t.kind;
  const { model, input } = buildRequest(tool, params, template);

  if (!chargeBalance(userId, cost)) {
    const err = new Error('Недостаточно монет');
    err.code = 'NO_BALANCE';
    throw err;
  }
  const jobId = createJob({ userId, tool, title, kind, cost, model });

  if (mockMode) {
    // Демо-режим без FAL_KEY: через 4 секунды «готово», в результате — загруженный файл или превью шаблона
    updateJob(jobId, { request_id: 'mock' });
    const result = params.image_url || template?.preview || `${config.publicUrl}/img/mock.svg`;
    setTimeout(() => finish(jobId, result), 4000);
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
