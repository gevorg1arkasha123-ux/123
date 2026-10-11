import crypto from 'node:crypto';
import { config } from './config.js';

// Проверка подписи Telegram WebApp initData:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
export function verifyInitData(initData, maxAgeSec = 24 * 3600) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (maxAgeSec && Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    // start_param — параметр из ссылки t.me/<bot>/<app>?startapp=..., используем для рефералов
    return { ...JSON.parse(params.get('user')), start_param: params.get('start_param') };
  } catch {
    return null;
  }
}
