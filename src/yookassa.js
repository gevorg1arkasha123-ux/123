import crypto from 'node:crypto';
import { config, packages, yookassaEnabled } from './config.js';
import { createInvoiceRow, getInvoice, setInvoiceStatus, pendingInvoices, recordPayment } from './db.js';

// Документация: https://yookassa.ru/developers/api
const API = 'https://api.yookassa.ru/v3';

async function yk(pathname, opts = {}) {
  const auth = Buffer.from(`${config.yookassaShopId}:${config.yookassaSecret}`).toString('base64');
  const res = await fetch(`${API}${pathname}`, {
    ...opts,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.description || `ЮKassa HTTP ${res.status}`);
  return body;
}

// Создаёт платёж и возвращает ссылку на страницу оплаты (карта, СБП, T-Pay, SberPay — что включено в ЮKassa)
export async function createYookassaPayment(userId, pkgId) {
  if (!yookassaEnabled) throw new Error('Оплата картой пока не подключена');
  const pkg = packages.find((p) => p.id === pkgId);
  if (!pkg) throw new Error('Пакет не найден');
  const payment = await yk('/payments', {
    method: 'POST',
    headers: { 'Idempotence-Key': crypto.randomUUID() },
    body: JSON.stringify({
      amount: { value: pkg.rub.toFixed(2), currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: config.publicUrl },
      description: `Пополнение баланса: ${pkg.title}`,
      metadata: { user_id: String(userId), package_id: pkg.id },
    }),
  });
  createInvoiceRow({ id: payment.id, userId, packageId: pkg.id, rub: pkg.rub, credits: pkg.credits });
  return payment.confirmation.confirmation_url;
}

let onPaid = async () => {};
export function setYookassaPaidHandler(fn) { onPaid = fn; }

// Проверяет платёж напрямую в API ЮKassa (вебхуку на слово не верим) и зачисляет монеты один раз
export async function syncPayment(paymentId) {
  const inv = getInvoice(paymentId);
  if (!inv || inv.status !== 'pending') return;
  const p = await yk(`/payments/${encodeURIComponent(paymentId)}`);
  if (p.status === 'succeeded' && p.paid) {
    const rub = Number(p.amount.value);
    if (p.amount.currency !== 'RUB' || rub < inv.rub) return;
    setInvoiceStatus(inv.id, 'succeeded');
    const r = recordPayment(`yk_${inv.id}`, inv.user_id, { method: 'yookassa', rub }, inv.credits, config.refPercent);
    if (r) await onPaid({ userId: inv.user_id, credits: inv.credits, rub, ...r });
  } else if (p.status === 'canceled') {
    setInvoiceStatus(inv.id, 'canceled');
  }
}

// Вебхук: в личном кабинете ЮKassa → Интеграция → HTTP-уведомления → <PUBLIC_URL>/webhook/yookassa
export async function handleWebhook(body) {
  const id = body?.object?.id;
  if (typeof id === 'string' && /^[\w-]{10,64}$/.test(id)) await syncPayment(id);
}

// Подстраховка, если вебхук не настроен или не дошёл: раз в 20 секунд проверяем свежие счета
export function startYookassaPoller() {
  if (!yookassaEnabled) return;
  const loop = async () => {
    for (const inv of pendingInvoices()) {
      await syncPayment(inv.id).catch((e) => console.error('yookassa sync', e.message));
    }
    setTimeout(loop, 20000);
  };
  loop();
}
