const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
tg?.setHeaderColor?.('#0d0c14');
tg?.setBackgroundColor?.('#0d0c14');

const $view = document.getElementById('view');
const state = { me: null, templates: [], tab: 'home', stack: [], category: 'Все', query: '', pollTimer: null };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isImg = (u) => /\.(png|jpe?g|webp|svg|gif)(\?|$)/i.test(u || '');
const haptic = (t = 'light') => tg?.HapticFeedback?.impactOccurred?.(t);

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'X-Init-Data': tg?.initData || '', ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Ошибка'), { code: data.code, status: res.status });
  return data;
}

const icons = {
  video: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10.5 5-3v9l-5-3"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="15" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 2-2 5 5"/></svg>',
  audio: '<svg viewBox="0 0 24 24"><path d="M4 9.5h3l4-3.5v12l-4-3.5H4z"/><path d="M15 9.5a3.5 3.5 0 0 1 0 5M18 7.5a6.5 6.5 0 0 1 0 9"/></svg>',
  brush: '<svg viewBox="0 0 24 24"><path d="M19.5 4.5c-2 0-8 6-10.5 9.5l1.5 1.5C14 13 20 7 19.5 4.5zM9 14c-2 0-3.5 1.5-3.5 3.5 0 1-1 2-2 2 2 1 6 .5 7-2"/></svg>',
  expand: '<svg viewBox="0 0 24 24"><path d="M5 9V5h4M5 5l5 5M19 9V5h-4M19 5l-5 5M5 15v4h4M5 19l5-5M19 15v4h-4M19 19l-5-5"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M10 3c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7zM18 2v4M16 4h4M20 8v3M18.5 9.5h3"/></svg>',
};

// Описание форм инструментов
const TOOL_FORMS = {
  motion: {
    title: 'Повторить видео', desc: 'Загрузите видео с движением и фото героя — персонаж повторит движения.', icon: icons.video,
    fields: [
      { name: 'video', type: 'file', accept: 'video/*', label: 'Видео с движением (3–10 сек)' },
      { name: 'image', type: 'file', accept: 'image/*', label: 'Фото героя' },
      { name: 'prompt', type: 'text', label: 'Пожелания (необязательно)', placeholder: 'Например: на фоне ночного города' },
    ],
  },
  image: {
    title: 'Картинка', desc: 'По описанию или по вашему фото.', icon: icons.image,
    fields: [
      { name: 'prompt', type: 'text', label: 'Что нарисовать?', placeholder: 'Кот-астронавт на Луне, кинематографичный свет' },
      { name: 'image', type: 'file', accept: 'image/*', label: 'Ваше фото (необязательно) — тогда опишите, что изменить', optional: true },
    ],
  },
  audio: {
    title: 'Аудио', desc: 'Ваша идея в новом звучании — музыка и звуки по описанию.', icon: icons.audio,
    fields: [{ name: 'prompt', type: 'text', label: 'Опишите звук или музыку', placeholder: 'Энергичный электронный бит, 128 BPM' }],
  },
  tryon: {
    title: 'Примерочная', desc: 'Примерьте новый образ: загрузите своё фото и фото одежды.', icon: icons.brush,
    fields: [
      { name: 'image', type: 'file', accept: 'image/*', label: 'Ваше фото' },
      { name: 'image2', type: 'file', accept: 'image/*', label: 'Фото одежды' },
    ],
  },
  tts: {
    title: 'Озвучка', desc: 'Превратите текст в речь.', icon: icons.audio,
    fields: [
      { name: 'prompt', type: 'text', label: 'Текст', placeholder: 'Привет! Это моя первая озвучка.' },
      { name: 'voice', type: 'select', label: 'Голос', options: ['Rachel', 'Aria', 'Sarah', 'Laura', 'Charlotte', 'Roger', 'George', 'Brian', 'Daniel'] },
    ],
  },
  upscale: {
    title: 'Улучшить качество', desc: 'Больше деталей в ваших кадрах.', icon: icons.expand,
    fields: [{ name: 'image', type: 'file', accept: 'image/*', label: 'Фото' }],
  },
};

/* ---------- navigation ---------- */
function setTab(tab) {
  state.tab = tab;
  state.stack = [];
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  render();
}
function push(screen) {
  state.stack.push(screen);
  render();
  window.scrollTo(0, 0);
}
function pop() {
  state.stack.pop();
  render();
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { haptic(); setTab(b.dataset.tab); }));
tg?.BackButton?.onClick(pop);

function render() {
  clearTimeout(state.pollTimer);
  const top = state.stack[state.stack.length - 1];
  if (state.stack.length) tg?.BackButton?.show(); else tg?.BackButton?.hide();
  if (top) return top.render();
  ({ home: renderHome, topup: renderTopup, create: renderCreate, history: renderHistory, profile: renderProfile })[state.tab]();
}

const balanceHtml = () => `<div class="topbar"><button class="balance" data-go="topup"><span class="coin">🪙</span>${state.me?.user.balance ?? '…'}<span class="plus">+</span></button></div>`;
const demoHtml = () => (state.me?.mock ? '<div class="demo-note">Демо-режим: ключ FAL_KEY не задан, генерация имитируется.</div>' : '');
const backHtml = () => `<button class="back" data-back>${icons.back}Назад</button>`;

function bindCommon() {
  $view.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => setTab(el.dataset.go)));
  $view.querySelectorAll('[data-back]').forEach((el) => el.addEventListener('click', pop));
}

/* ---------- Главная ---------- */
function tplCard(t) {
  const media = t.preview
    ? (isImg(t.preview) ? `<img src="${esc(t.preview)}" alt="">` : `<video src="${esc(t.preview)}" autoplay muted loop playsinline></video>`)
    : `<div class="media" style="background:linear-gradient(135deg,${esc(t.gradient?.[0] || '#7b2ff7')},${esc(t.gradient?.[1] || '#f107a3')})">${esc(t.emoji || '🎬')}</div>`;
  return `<button class="tpl" data-tpl="${esc(t.id)}">${media}<span class="badge">${icons.video}</span><span class="name">${esc(t.title)}</span></button>`;
}

function renderHome() {
  const cats = ['Все', ...new Set(state.templates.map((t) => t.category).filter(Boolean))];
  const q = state.query.toLowerCase();
  const list = state.templates.filter((t) => (state.category === 'Все' || t.category === state.category) && (!q || t.title.toLowerCase().includes(q)));
  $view.innerHTML = `
    ${balanceHtml()}${demoHtml()}
    <button class="hero" data-go="create">
      <span class="ic">${icons.spark}</span>
      <span><b>СГЕНЕРИРОВАТЬ</b><small>Создай что-то уникальное</small></span>
      <span class="arrow">${icons.arrow}</span>
    </button>
    <div class="divider"></div>
    <div class="row-between"><h2>Тренды</h2><button class="icon-btn" id="searchBtn">${icons.search}</button></div>
    <input class="search" id="search" placeholder="Поиск шаблона" value="${esc(state.query)}" ${state.query ? '' : 'hidden'}>
    <p class="sub" style="margin-top:14px">Создавайте потрясающие фото и видео с помощью нейросетей</p>
    <div class="chips">${cats.map((c) => `<button class="chip ${c === state.category ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div class="grid">${list.map(tplCard).join('') || '<div class="empty">Ничего не найдено</div>'}</div>`;
  bindCommon();
  const search = $view.querySelector('#search');
  $view.querySelector('#searchBtn').onclick = () => { search.hidden = !search.hidden; if (!search.hidden) search.focus(); };
  search.oninput = () => { state.query = search.value; const pos = search.selectionStart; renderHome(); const s = $view.querySelector('#search'); s.hidden = false; s.focus(); s.setSelectionRange(pos, pos); };
  $view.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => { state.category = b.dataset.cat; renderHome(); });
  $view.querySelectorAll('[data-tpl]').forEach((b) => b.onclick = () => openTemplate(b.dataset.tpl));
}

/* ---------- Шаблон ---------- */
function openTemplate(id) {
  const t = state.templates.find((x) => x.id === id);
  haptic();
  push({
    render() {
      const media = t.preview
        ? (isImg(t.preview) ? `<img src="${esc(t.preview)}">` : `<video src="${esc(t.preview)}" autoplay muted loop playsinline></video>`)
        : `<span>${esc(t.emoji || '🎬')}</span>`;
      $view.innerHTML = `
        ${backHtml()}
        <div class="preview-big" style="background:linear-gradient(135deg,${esc(t.gradient?.[0] || '#7b2ff7')},${esc(t.gradient?.[1] || '#f107a3')})">${media}</div>
        <h2>${esc(t.title)}</h2>
        <p class="hint" style="margin-top:6px">${esc(t.hint || 'Загрузите фото')}</p>
        <form id="f">
          ${fieldHtml({ name: 'image', type: 'file', accept: 'image/*', label: 'Ваше фото' })}
          <button class="cta" type="submit">Создать видео · ${t.cost} 🪙</button>
        </form>`;
      bindCommon();
      bindForm({ tool: 'template', template_id: t.id }, [{ name: 'image', type: 'file' }]);
    },
  });
}

/* ---------- Что создадим? ---------- */
function renderCreate() {
  const tile = (key, icon, title, desc) => `<button class="tool" data-tool="${key}"><span class="ic">${icon}</span><b>${title}</b><small>${desc}</small></button>`;
  $view.innerHTML = `
    ${demoHtml()}
    <h1>Что создадим?</h1>
    <p class="sub">Выберите инструмент и создайте что-то своё.</p>
    <button class="banner" data-go="home"><span class="ic">${icons.grid}</span><span><b>Начните с готового шаблона</b><small>Выберите сюжет и добавьте фото</small></span><span class="chev">${icons.chev}</span></button>
    <div class="section-label">Все инструменты</div>
    <button class="feature" data-tool="motion">
      <span class="txt"><span class="new">НОВОЕ</span><h3>Повторить видео</h3><p>Перенесите движение или замените героя, предмет и фон.</p>
      <span class="pill"><span class="pill-tag">${state.me?.tools.motion.cost ?? ''} 🪙</span><span class="round">${icons.arrow}</span></span></span>
      <span class="art">🐱</span>
    </button>
    <div class="tools">
      ${tile('image', icons.image, 'КАРТИНКА', 'По описанию или по вашему фото')}
      ${tile('audio', icons.audio, 'АУДИО', 'Ваша идея в новом звучании')}
      ${tile('tryon', icons.brush, 'Примерочная', 'Примерьте новый образ')}
      ${tile('tts', icons.audio, 'ОЗВУЧКА', 'Превратите текст в речь')}
      ${tile('upscale', icons.expand, 'Улучшить качество', 'Больше деталей в ваших кадрах')}
    </div>`;
  bindCommon();
  $view.querySelectorAll('[data-tool]').forEach((b) => b.onclick = () => openTool(b.dataset.tool));
}

function fieldHtml(f) {
  if (f.type === 'file') {
    return `<div class="field"><label>${esc(f.label)}</label><div class="drop" data-drop="${f.name}"><span>Нажмите, чтобы загрузить</span><input type="file" name="${f.name}" accept="${f.accept}"></div></div>`;
  }
  if (f.type === 'select') {
    return `<div class="field"><label>${esc(f.label)}</label><select name="${f.name}">${f.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select></div>`;
  }
  return `<div class="field"><label>${esc(f.label)}</label><textarea name="${f.name}" rows="4" placeholder="${esc(f.placeholder || '')}"></textarea></div>`;
}

function openTool(key) {
  const form = TOOL_FORMS[key];
  haptic();
  push({
    render() {
      $view.innerHTML = `
        ${backHtml()}
        <h1>${esc(form.title)}</h1>
        <p class="sub">${esc(form.desc)}</p>
        <form id="f">
          ${form.fields.map(fieldHtml).join('')}
          <button class="cta" type="submit">Создать · ${state.me.tools[key].cost} 🪙</button>
        </form>`;
      bindCommon();
      bindForm({ tool: key }, form.fields);
    },
  });
}

function bindForm(extra, fields) {
  const f = $view.querySelector('#f');
  // превью выбранных файлов
  f.querySelectorAll('.drop input').forEach((inp) => inp.addEventListener('change', () => {
    const file = inp.files[0];
    const box = inp.parentElement;
    box.querySelector('img,video,span')?.remove();
    if (!file) return;
    const url = URL.createObjectURL(file);
    const el = document.createElement(file.type.startsWith('video') ? 'video' : 'img');
    el.src = url;
    if (el.tagName === 'VIDEO') Object.assign(el, { muted: true, autoplay: true, loop: true, playsInline: true });
    box.prepend(el);
  }));

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    for (const fl of fields) {
      const v = fd.get(fl.name);
      const empty = fl.type === 'file' ? !(v && v.size) : !String(v || '').trim();
      if (empty && !fl.optional && !(fl.name === 'prompt' && extra.tool === 'motion')) return toast('Заполните все поля');
      if (fl.type === 'file' && !(v && v.size)) fd.delete(fl.name);
    }
    Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
    const btn = f.querySelector('.cta');
    btn.disabled = true;
    btn.textContent = 'Отправляем…';
    try {
      const r = await api('/api/generate', { method: 'POST', body: fd });
      state.me.user.balance = r.balance;
      tg?.HapticFeedback?.notificationOccurred?.('success');
      toast('Генерация запущена! Результат придёт и в чат с ботом');
      setTab('history');
    } catch (err) {
      tg?.HapticFeedback?.notificationOccurred?.('error');
      if (err.code === 'NO_BALANCE') { toast('Недостаточно монет — пополните баланс'); setTab('topup'); return; }
      toast(err.message);
      btn.disabled = false;
      btn.textContent = 'Попробовать ещё раз';
    }
  });
}

/* ---------- Пополнить ---------- */
function renderTopup() {
  $view.innerHTML = `
    ${balanceHtml()}
    <h1>Пополнить</h1>
    <p class="sub">Оплата через Telegram Stars ⭐</p>
    ${state.me.packages.map((p) => `
      <button class="pkg" data-pkg="${p.id}">
        <span style="font-size:30px">🪙</span>
        <span><span class="big">${p.credits}</span> монет${p.badge ? `<span class="tag">${esc(p.badge)}</span>` : ''}</span>
        <span class="price">⭐ ${p.stars}</span>
      </button>`).join('')}
    <div class="section-label">Цены</div>
    ${Object.values(state.me.tools).map((t) => `<div class="list-item"><span>${esc(t.title)}</span><span>${t.cost} 🪙</span></div>`).join('')}`;
  bindCommon();
  $view.querySelectorAll('[data-pkg]').forEach((b) => b.onclick = async () => {
    haptic();
    try {
      const { link } = await api('/api/invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ package: b.dataset.pkg }) });
      if (!tg?.openInvoice) return window.open(link, '_blank');
      tg.openInvoice(link, async (status) => {
        if (status === 'paid') {
          toast('Оплата прошла! Монеты зачислены');
          setTimeout(async () => { await loadMe(); render(); }, 1500);
        }
      });
    } catch (e) { toast(e.message); }
  });
}

/* ---------- История ---------- */
function jobThumb(j) {
  if (j.status === 'queued') return '<div class="spinner"></div>';
  if (j.status === 'failed') return '⚠️';
  if (j.kind === 'audio') return '🎵';
  if (isImg(j.result_url)) return `<img src="${esc(j.result_url)}" loading="lazy">`;
  return `<video src="${esc(j.result_url)}#t=0.1" muted playsinline preload="metadata"></video>`;
}

async function renderHistory() {
  if (!$view.querySelector('.job')) $view.innerHTML = '<h1>История</h1><div class="empty"><div class="spinner" style="margin:auto"></div></div>';
  let data;
  try { data = await api('/api/history'); } catch (e) { $view.innerHTML = `<h1>История</h1><div class="empty">${esc(e.message)}</div>`; return; }
  if (state.tab !== 'history' || state.stack.length) return;
  state.me.user.balance = data.balance;
  const labels = { queued: 'Генерируется…', done: 'Готово', failed: 'Ошибка, монеты возвращены' };
  $view.innerHTML = `
    <h1>История</h1>
    <p class="sub">Ваши генерации</p>
    ${data.jobs.length ? data.jobs.map((j) => `
      <div class="job" data-job="${j.id}">
        <div class="thumb">${jobThumb(j)}</div>
        <div><b>${esc(j.title)}</b><small>${new Date(j.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${j.cost} 🪙</small>
        <div class="status ${j.status}">${labels[j.status]}</div></div>
      </div>`).join('') : '<div class="empty">Пока пусто. Создайте первое видео! ✨</div>'}`;
  $view.querySelectorAll('[data-job]').forEach((el) => el.onclick = () => {
    const j = data.jobs.find((x) => x.id === Number(el.dataset.job));
    if (j.status === 'done') showResult(j);
  });
  if (data.jobs.some((j) => j.status === 'queued')) state.pollTimer = setTimeout(renderHistory, 4000);
}

function showResult(j) {
  const wrap = document.createElement('div');
  wrap.className = 'result';
  const media = j.kind === 'audio' ? `<audio src="${esc(j.result_url)}" controls autoplay></audio>`
    : isImg(j.result_url) ? `<img src="${esc(j.result_url)}">`
      : `<video src="${esc(j.result_url)}" controls autoplay loop playsinline></video>`;
  wrap.innerHTML = `${media}<button class="cta" data-dl>Скачать</button><button class="back" data-close>Закрыть</button>`;
  wrap.querySelector('[data-close]').onclick = () => wrap.remove();
  wrap.querySelector('[data-dl]').onclick = () => {
    if (tg?.downloadFile) tg.downloadFile({ url: j.result_url, file_name: `result-${j.id}${isImg(j.result_url) ? '.png' : j.kind === 'audio' ? '.mp3' : '.mp4'}` }, () => {});
    else tg?.openLink ? tg.openLink(j.result_url) : window.open(j.result_url, '_blank');
  };
  document.body.appendChild(wrap);
}

/* ---------- Профиль ---------- */
function renderProfile() {
  const u = state.me.user;
  const bot = tg?.initDataUnsafe?.receiver?.username;
  $view.innerHTML = `
    <h1>Профиль</h1>
    <div class="profile-card">
      <div class="avatar">${esc((u.first_name || '?')[0])}</div>
      <div><b>${esc(u.first_name || '')}</b><br><small style="color:var(--muted)">${u.username ? '@' + esc(u.username) + ' · ' : ''}ID ${u.id}</small></div>
    </div>
    <div class="list-item"><span>Баланс</span><b>${u.balance} 🪙</b></div>
    <button class="list-item" data-go="topup"><span>Пополнить баланс</span>${icons.chev}</button>
    <button class="list-item" data-go="history"><span>Мои генерации</span>${icons.chev}</button>
    ${bot ? `<button class="list-item" id="share"><span>Поделиться ботом</span>${icons.chev}</button>` : ''}`;
  bindCommon();
  $view.querySelector('#share')?.addEventListener('click', () => tg.openTelegramLink(`https://t.me/share/url?url=https://t.me/${bot}`));
}

/* ---------- start ---------- */
async function loadMe() {
  state.me = await api('/api/me');
}

(async () => {
  try {
    [state.me, state.templates] = await Promise.all([api('/api/me'), api('/api/templates')]);
    render();
  } catch (e) {
    $view.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
})();
