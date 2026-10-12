const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
tg?.setHeaderColor?.('#0b0b0c');
tg?.setBackgroundColor?.('#0b0b0c');

const $view = document.getElementById('view');
const state = { me: null, templates: [], tab: 'home', stack: [], category: 'Все', query: '', pollTimer: null };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isImg = (u) => /\.(png|jpe?g|webp|svg|gif)(\?|$)/i.test(u || '');
const haptic = (t = 'light') => tg?.HapticFeedback?.impactOccurred?.(t);
const rub = (n) => `${Number(n).toLocaleString('ru-RU')} ₽`;

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2800);
}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'X-Init-Data': tg?.initData || '', ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Ошибка'), { code: data.code, status: res.status });
  return data;
}

const icons = {
  film: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/></svg>',
  play: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/></svg>',
  photo: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 2.5-2 4 3.5"/></svg>',
  wave: '<svg viewBox="0 0 24 24"><path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0"/></svg>',
  voice: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  shirt: '<svg viewBox="0 0 24 24"><path d="M9 3.5 4 6l1.8 4.2L8 9.4V20h8V9.4l2.2.8L20 6l-5-2.5a3 3 0 0 1-6 0z"/></svg>',
  sharp: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><circle cx="12" cy="12" r="3"/></svg>',
  motion: '<svg viewBox="0 0 24 24"><circle cx="13" cy="4.5" r="1.8"/><path d="m9 21 2.5-6 2.5 2v4M7 11l3-3.5h4l2 3.5 3 1M11.5 15l1-7.5"/></svg>',
  people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.9-3 3-4.5 5.5-4.5s4.6 1.5 5.5 4.5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.6c2.3-.4 4.2.8 5 3.4"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>',
};

// Формы инструментов студии
const TOOL_FORMS = {
  t2v: {
    title: 'Видео по описанию', desc: 'Опишите сцену словами — получите ролик со звуком.', icon: icons.play,
    fields: [
      { name: 'variant', type: 'variant' },
      { name: 'prompt', type: 'text', label: 'Что происходит в видео?', placeholder: 'Рыжий кот в очках диджеит на крыше небоскрёба ночью, неоновый свет, камера облетает вокруг' },
      { name: 'aspect', type: 'select', label: 'Формат', options: [['9:16', 'Вертикальное 9:16 (Reels, TikTok)'], ['16:9', 'Горизонтальное 16:9'], ['1:1', 'Квадрат 1:1']] },
    ],
  },
  i2v: {
    title: 'Оживить фото', desc: 'Фото превращается в короткое видео.', icon: icons.film,
    fields: [
      { name: 'variant', type: 'variant' },
      { name: 'image', type: 'file', accept: 'image/*', label: 'Фото' },
      { name: 'prompt', type: 'text', label: 'Что должно произойти (необязательно)', placeholder: 'Человек улыбается и машет рукой, волосы развеваются на ветру', optional: true },
    ],
  },
  motion: {
    title: 'Повторить движение', desc: 'Ваш герой повторит движения из любого видео.', icon: icons.motion,
    fields: [
      { name: 'video', type: 'file', accept: 'video/*', label: 'Видео с движением (3–10 сек)' },
      { name: 'image', type: 'file', accept: 'image/*', label: 'Фото героя' },
      { name: 'prompt', type: 'text', label: 'Пожелания (необязательно)', placeholder: 'Например: на фоне ночного города', optional: true },
    ],
  },
  image: {
    title: 'Картинка', desc: 'По описанию или на основе вашего фото.', icon: icons.photo,
    fields: [
      { name: 'prompt', type: 'text', label: 'Что нарисовать?', placeholder: 'Кот-астронавт на Луне, кинематографичный свет' },
      { name: 'image', type: 'file', accept: 'image/*', label: 'Ваше фото (необязательно) — тогда опишите, что изменить', optional: true },
    ],
  },
  tryon: {
    title: 'Примерочная', desc: 'Своё фото + фото одежды = новый образ.', icon: icons.shirt,
    fields: [
      { name: 'image', type: 'file', accept: 'image/*', label: 'Ваше фото' },
      { name: 'image2', type: 'file', accept: 'image/*', label: 'Фото одежды' },
    ],
  },
  audio: {
    title: 'Музыка и звуки', desc: 'Трек или звуковой эффект по описанию.', icon: icons.wave,
    fields: [{ name: 'prompt', type: 'text', label: 'Опишите звук или музыку', placeholder: 'Энергичный электронный бит, 128 BPM' }],
  },
  tts: {
    title: 'Озвучка текста', desc: 'Живой голос из любого текста.', icon: icons.voice,
    fields: [
      { name: 'prompt', type: 'text', label: 'Текст', placeholder: 'Привет! Это моя первая озвучка.' },
      { name: 'voice', type: 'select', label: 'Голос', options: ['Rachel', 'Aria', 'Sarah', 'Laura', 'Charlotte', 'Roger', 'George', 'Brian', 'Daniel'] },
    ],
  },
  upscale: {
    title: 'Улучшить качество', desc: 'Больше деталей и резкости на фото.', icon: icons.sharp,
    fields: [{ name: 'image', type: 'file', accept: 'image/*', label: 'Фото' }],
  },
};

/* ---------- навигация ---------- */
function setTab(tab) {
  state.tab = tab;
  state.stack = [];
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  render();
  window.scrollTo(0, 0);
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
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { haptic(); setTab(b.dataset.tab); }));
document.getElementById('wallet').addEventListener('click', () => { haptic(); openTopup(); });
tg?.BackButton?.onClick(pop);

function render() {
  clearTimeout(state.pollTimer);
  document.getElementById('walletSum').textContent = state.me ? rub(state.me.user.balance) : '…';
  const top = state.stack[state.stack.length - 1];
  document.body.classList.toggle('inner', !!top);
  if (top) tg?.BackButton?.show(); else tg?.BackButton?.hide();
  if (top) return top.render();
  ({ home: renderHome, create: renderStudio, history: renderWorks, profile: renderProfile })[state.tab]();
  watchVideos();
}

const demoHtml = () => (state.me?.mock ? '<div class="notice">Демо-режим: ключ генерации не задан, результат имитируется.</div>' : '');
const backHtml = () => `<button class="back" data-back>${icons.back}Назад</button>`;
function bindCommon() {
  $view.querySelectorAll('[data-back]').forEach((el) => el.addEventListener('click', pop));
  $view.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => setTab(el.dataset.go)));
}

// Превью-видео играют, только пока видны на экране — экономим трафик и батарею
let videoObserver;
function watchVideos() {
  videoObserver?.disconnect();
  if (!('IntersectionObserver' in window)) return;
  videoObserver = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) e.target.play().catch(() => {}); else e.target.pause();
  }), { threshold: 0.3 });
  $view.querySelectorAll('video[data-auto]').forEach((v) => videoObserver.observe(v));
}

// Заглушка для шаблона без превью: своя «киношная» палитра, цвет стабилен для каждого шаблона
const ART = [['#6a4314', '#17130d'], ['#6b2a19', '#160f0d'], ['#1b4a49', '#0d1414'], ['#4a4519', '#13130d'], ['#33405a', '#0e1014'], ['#55283d', '#140d11']];
const artBg = (id) => ART[[...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % ART.length];
const artHtml = (t, cls = 'art') => {
  const [a, b] = artBg(t.id);
  return `<div class="${cls}" style="background:radial-gradient(120% 90% at 20% 10%,${a},${b})">${t.faces?.length ? icons.people : icons.film}</div>`;
};
// В карточках — лёгкая копия ролика (thumb), полное качество — на экране шаблона
const mediaHtml = (t) => {
  const src = t.thumb || t.preview;
  if (!src) return artHtml(t);
  return isImg(src) ? `<img src="${esc(src)}" alt="" loading="lazy">` : `<video src="${esc(src)}#t=0.1" data-auto muted loop playsinline preload="metadata"></video>`;
};

/* ---------- Шаблоны ---------- */
function cardHtml(t) {
  const faces = t.faces?.length > 1 ? `<span class="card-faces">${icons.people}${t.faces.length}</span>` : '';
  return `<button class="card" data-tpl="${esc(t.id)}" aria-label="${esc(t.title)}, ${rub(t.cost)}">${mediaHtml(t)}${faces}<span class="card-price">${rub(t.cost)}</span><span class="card-name">${esc(t.title)}</span></button>`;
}

function renderHome() {
  const cats = ['Все', ...new Set(state.templates.map((t) => t.category).filter(Boolean))];
  const q = state.query.trim().toLowerCase();
  const filtered = state.templates.filter((t) => (state.category === 'Все' || t.category === state.category)
    && (!q || `${t.title} ${t.description || ''}`.toLowerCase().includes(q)));
  const featured = !q && state.category === 'Все' ? state.templates.find((t) => t.preview) : null;

  let body;
  if (!filtered.length) body = '<div class="empty">Ничего не нашли. Попробуйте другое слово.</div>';
  else if (q || state.category !== 'Все') body = `<div class="grid">${filtered.map(cardHtml).join('')}</div>`;
  else {
    // полки по категориям, как в кинотеке
    body = cats.slice(1).map((c) => {
      const items = filtered.filter((t) => t.category === c);
      return items.length ? `<section class="shelf"><div class="shelf-head"><h2>${esc(c)}</h2>${items.length > 2 ? `<button data-cat="${esc(c)}">Все ${items.length}</button>` : ''}</div>
        <div class="shelf-row">${items.map(cardHtml).join('')}</div></section>` : '';
    }).join('');
    const other = filtered.filter((t) => !t.category);
    if (other.length) body += `<section class="shelf"><div class="shelf-head"><h2>Другое</h2></div><div class="shelf-row">${other.map(cardHtml).join('')}</div></section>`;
  }

  $view.innerHTML = `
    ${demoHtml()}
    <h1>Снимите себя в тренде</h1>
    <p class="lead">Выберите сюжет, добавьте фото — нейросеть сделает ролик.</p>
    <div class="search-box">${icons.search}<input id="search" type="search" placeholder="Найти шаблон" value="${esc(state.query)}" aria-label="Поиск шаблона"></div>
    <div class="cats" role="tablist">${cats.map((c) => `<button class="cat ${c === state.category ? 'active' : ''}" data-cat="${esc(c)}" role="tab" aria-selected="${c === state.category}">${esc(c)}</button>`).join('')}</div>
    ${featured ? `<button class="spotlight" data-tpl="${esc(featured.id)}">${mediaHtml(featured)}<span class="spotlight-body"><span class="kicker">Новинка</span><h2>${esc(featured.title)}</h2><p>${esc(featured.description || featured.hint || '')}</p></span></button>` : ''}
    ${body}`;
  bindCommon();
  const search = $view.querySelector('#search');
  search.oninput = () => {
    state.query = search.value;
    const pos = search.selectionStart;
    renderHome();
    watchVideos();
    const s = $view.querySelector('#search');
    s.focus();
    s.setSelectionRange(pos, pos);
  };
  $view.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => { haptic(); state.category = b.dataset.cat; renderHome(); watchVideos(); });
  $view.querySelectorAll('[data-tpl]').forEach((b) => b.onclick = () => openTemplate(b.dataset.tpl));
}

/* ---------- Экран шаблона ---------- */
function slotHtml(name, label, hint) {
  return `<div class="slot"><label class="slot-box" data-slot="${name}">
      <input type="file" name="${name}" accept="image/*" aria-label="${esc(label)}">
      <span class="slot-empty">${icons.plus}<span>${esc(hint)}</span></span>
    </label><span class="slot-label">${esc(label)}</span></div>`;
}

function openTemplate(id) {
  const t = state.templates.find((x) => x.id === id);
  haptic();
  const roles = t.faces?.length ? t.faces : ['Ваше фото'];
  const names = t.faces?.length ? roles.map((_, i) => `face${i + 1}`) : ['image'];
  push({
    render() {
      const media = t.preview
        ? (isImg(t.preview) ? `<img src="${esc(t.preview)}" alt="">` : `<video src="${esc(t.preview)}#t=0.1" autoplay muted loop playsinline controls preload="metadata"></video>`)
        : artHtml(t);
      const steps = t.faces?.length > 1
        ? [`Загрузите ${roles.length} фото — по одному на героя`, 'Оплатите с баланса', 'Ролик придёт сюда и в чат']
        : ['Загрузите своё фото', 'Оплатите с баланса', 'Ролик придёт сюда и в чат'];
      $view.innerHTML = `
        ${backHtml()}
        <div class="player">${media}</div>
        <div class="tpl-head"><div>${t.category ? `<div class="tpl-cat">${esc(t.category)}</div>` : ''}<h1>${esc(t.title)}</h1></div></div>
        ${t.description ? `<p class="desc">${esc(t.description)}</p>` : ''}
        <ol class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        <form id="f">
          <div class="section-title">${roles.length > 1 ? 'Кто есть кто' : 'Ваше фото'}</div>
          <div class="slots n${Math.min(roles.length, 3)}">${roles.map((r, i) => slotHtml(names[i], r, roles.length > 1 ? 'Фото лица' : 'Нажмите, чтобы выбрать')).join('')}</div>
          ${t.hint ? `<p class="lead" style="font-size:13px">${esc(t.hint)}</p>` : ''}
          ${paybarHtml(t.cost)}
        </form>`;
      bindCommon();
      bindForm({ tool: 'template', template_id: t.id }, names.map((name) => ({ name, type: 'file' })), t.cost);
    },
  });
}

// Нижняя панель: цена, хватает ли денег и главная кнопка
function paybarHtml(cost) {
  const bal = state.me.user.balance;
  const enough = bal >= cost;
  return `<div class="paybar"><div class="paybar-in">
    <div class="paybar-info"><b><span id="price">${rub(cost)}</span></b><span id="balInfo" class="${enough ? 'ok' : 'bad'}">${enough ? `На балансе ${rub(bal)}` : `Не хватает ${rub(cost - bal)}`}</span></div>
    <button class="btn" type="submit" id="cta">${enough ? 'Создать' : 'Пополнить'}</button>
  </div></div>`;
}

function updatePaybar(cost) {
  const bal = state.me.user.balance;
  const enough = bal >= cost;
  $view.querySelector('#price').textContent = rub(cost);
  const info = $view.querySelector('#balInfo');
  info.className = enough ? 'ok' : 'bad';
  info.textContent = enough ? `На балансе ${rub(bal)}` : `Не хватает ${rub(cost - bal)}`;
  $view.querySelector('#cta').textContent = enough ? 'Создать' : 'Пополнить';
}

/* ---------- Студия ---------- */
function renderStudio() {
  const tools = state.me.tools;
  const price = (k) => (tools[k] ? `${tools[k].variants ? 'от ' : ''}${rub(tools[k].cost)}` : '');
  const row = (k) => `<button class="tool" data-tool="${k}"><span class="tool-ic">${TOOL_FORMS[k].icon}</span><span><b>${esc(TOOL_FORMS[k].title)}</b><small>${esc(TOOL_FORMS[k].desc)}</small></span><span class="tool-price">${price(k)}</span></button>`;
  $view.innerHTML = `
    ${demoHtml()}
    <h1>Студия</h1>
    <p class="lead">Свои идеи — без шаблонов. Платите только за результат.</p>
    <div class="tool-list">
      <button class="tool hero" data-go="home"><span><b>Нет идеи? Начните с шаблона</b><small>Готовые трендовые сюжеты — нужно только фото</small></span></button>
      ${Object.keys(TOOL_FORMS).filter((k) => tools[k]).map(row).join('')}
    </div>`;
  bindCommon();
  $view.querySelectorAll('[data-tool]').forEach((b) => b.onclick = () => openTool(b.dataset.tool));
}

function fieldHtml(f, toolKey) {
  if (f.type === 'variant') {
    const vs = Object.entries(state.me.tools[toolKey].variants);
    return `<div class="field"><label>Нейросеть</label><div class="variants">${vs.map(([k, v], i) => `
      <label class="variant"><input type="radio" name="variant" value="${k}" ${i ? '' : 'checked'}>
      <span><b>${esc(v.title)}</b><small>${esc(v.desc)}</small><em>${rub(v.cost)}</em></span></label>`).join('')}</div></div>`;
  }
  if (f.type === 'file') {
    return `<div class="field"><label>${esc(f.label)}</label><div class="slots n1"><div class="slot"><label class="slot-box" data-slot="${f.name}">
      <input type="file" name="${f.name}" accept="${f.accept}" aria-label="${esc(f.label)}">
      <span class="slot-empty">${icons.plus}<span>Нажмите, чтобы выбрать</span></span></label></div></div></div>`;
  }
  if (f.type === 'select') {
    return `<div class="field"><label>${esc(f.label)}</label><select name="${f.name}">${f.options.map((o) => (Array.isArray(o) ? `<option value="${esc(o[0])}">${esc(o[1])}</option>` : `<option>${esc(o)}</option>`)).join('')}</select></div>`;
  }
  return `<div class="field"><label>${esc(f.label)}</label><textarea name="${f.name}" rows="4" placeholder="${esc(f.placeholder || '')}"></textarea></div>`;
}

function openTool(key) {
  const form = TOOL_FORMS[key];
  haptic();
  push({
    render() {
      let cost = state.me.tools[key].cost;
      if (state.me.tools[key].variants) cost = Object.values(state.me.tools[key].variants)[0].cost;
      $view.innerHTML = `
        ${backHtml()}
        <h1>${esc(form.title)}</h1>
        <p class="lead">${esc(form.desc)}</p>
        <form id="f">
          ${form.fields.map((fl) => fieldHtml(fl, key)).join('')}
          ${paybarHtml(cost)}
        </form>`;
      bindCommon();
      const ctl = bindForm({ tool: key }, form.fields.filter((fl) => fl.type !== 'variant'), cost);
      // цена меняется вместе с выбранной нейросетью
      $view.querySelectorAll('input[name=variant]').forEach((r) => r.addEventListener('change', () => {
        ctl.setCost(state.me.tools[key].variants[r.value].cost);
      }));
    },
  });
}

function bindForm(extra, fields, initialCost) {
  const f = $view.querySelector('#f');
  let cost = initialCost;
  // превью выбранных файлов прямо в ячейке
  f.querySelectorAll('.slot-box input').forEach((inp) => inp.addEventListener('change', () => {
    const box = inp.parentElement;
    box.classList.remove('missing');
    box.querySelector('img,video')?.remove();
    const file = inp.files[0];
    box.classList.toggle('filled', !!file);
    box.querySelector('.slot-empty').hidden = !!file;
    if (!file) return;
    const el = document.createElement(file.type.startsWith('video') ? 'video' : 'img');
    el.src = URL.createObjectURL(file);
    if (el.tagName === 'VIDEO') Object.assign(el, { muted: true, autoplay: true, loop: true, playsInline: true });
    box.prepend(el);
    haptic('soft');
  }));

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.me.user.balance < cost) { haptic('medium'); openTopup(cost - state.me.user.balance); return; }
    const fd = new FormData(f);
    for (const fl of fields) {
      const v = fd.get(fl.name);
      const empty = fl.type === 'file' ? !(v && v.size) : !String(v || '').trim();
      if (empty && !fl.optional) {
        tg?.HapticFeedback?.notificationOccurred?.('error');
        const box = f.querySelector(`[data-slot="${fl.name}"]`);
        if (box) { box.classList.remove('missing'); void box.offsetWidth; box.classList.add('missing'); box.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        return toast(fl.type === 'file' ? 'Добавьте все фото' : 'Заполните описание');
      }
      if (fl.type === 'file' && !(v && v.size)) fd.delete(fl.name);
    }
    Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
    const btn = f.querySelector('#cta');
    btn.disabled = true;
    btn.textContent = 'Отправляем…';
    try {
      const r = await api('/api/generate', { method: 'POST', body: fd });
      state.me.user.balance = r.balance;
      tg?.HapticFeedback?.notificationOccurred?.('success');
      toast('Пошла генерация! Ролик придёт сюда и в чат с ботом');
      setTab('history');
    } catch (err) {
      tg?.HapticFeedback?.notificationOccurred?.('error');
      btn.disabled = false;
      if (err.code === 'NO_BALANCE') { await loadMe().catch(() => {}); updatePaybar(cost); toast('Недостаточно средств — пополните баланс'); return; }
      toast(err.message);
      btn.textContent = 'Попробовать ещё раз';
    }
  });
  return { setCost(c) { cost = c; updatePaybar(c); } };
}

/* ---------- Пополнение ---------- */
function openTopup(need = 0) {
  push({ topup: true, render: () => renderTopup(need) });
}

function renderTopup(need) {
  const pay = state.me.payments;
  const how = [pay.card && 'карта, СБП, T-Pay, SberPay', pay.stars && 'Telegram Stars'].filter(Boolean).join(' или ');
  $view.innerHTML = `
    ${backHtml()}
    <h1>Пополнить баланс</h1>
    <p class="lead">${need > 0 ? `Для этой генерации не хватает ${rub(need)}. ` : ''}${how ? `Оплата: ${how}.` : ''}</p>
    <div class="amounts">${state.me.packages.map((p) => `
      <div class="amount">
        ${p.badge ? `<span class="tag">${esc(p.badge)}</span>` : ''}
        <b>${rub(p.credits)}</b><small>на баланс</small>
        <div class="amount-pay">
          ${pay.card ? `<button class="main" data-card="${p.id}">Картой · ${rub(p.rub)}</button>` : ''}
          ${pay.stars ? `<button class="${pay.card ? '' : 'main'}" data-stars="${p.id}">Stars · ${p.stars}</button>` : ''}
        </div>
      </div>`).join('')}</div>
    <div class="section-title">Сколько стоит</div>
    <div class="price-list">${Object.entries(state.me.tools).filter(([k]) => TOOL_FORMS[k]).map(([k, t]) => `<div class="row"><span>${esc(TOOL_FORMS[k].title)}</span><span>${t.variants ? 'от ' : ''}${rub(t.cost)}</span></div>`).join('')}
      <div class="row"><span>Шаблоны</span><span>цена на карточке</span></div></div>`;
  bindCommon();
  const post = (url, pkg) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ package: pkg }) });

  $view.querySelectorAll('[data-card]').forEach((b) => b.onclick = async () => {
    haptic();
    b.disabled = true;
    try {
      const { link } = await post('/api/pay/card', b.dataset.card);
      tg?.openLink ? tg.openLink(link) : window.open(link, '_blank');
      toast('После оплаты деньги зачислятся автоматически');
      waitForBalance();
    } catch (e) { toast(e.message); }
    b.disabled = false;
  });

  $view.querySelectorAll('[data-stars]').forEach((b) => b.onclick = async () => {
    haptic();
    try {
      const { link } = await post('/api/pay/stars', b.dataset.stars);
      if (!tg?.openInvoice) return window.open(link, '_blank');
      tg.openInvoice(link, (status) => { if (status === 'paid') { toast('Оплата прошла!'); waitForBalance(); } });
    } catch (e) { toast(e.message); }
  });
}

// После оплаты несколько минут проверяем баланс и обновляем экран, когда деньги придут
function waitForBalance() {
  const before = state.me.user.balance;
  let tries = 0;
  const tick = async () => {
    if (++tries > 60) return;
    try {
      await loadMe();
      if (state.me.user.balance !== before) {
        toast(`Баланс пополнен: ${rub(state.me.user.balance)}`);
        // с экрана пополнения возвращаемся туда, откуда пришли (например, к шаблону)
        if (state.stack[state.stack.length - 1]?.topup) pop(); else render();
        return;
      }
    } catch { /* сеть */ }
    setTimeout(tick, 5000);
  };
  setTimeout(tick, 3000);
}

/* ---------- Мои работы ---------- */
function workMedia(j) {
  if (j.status === 'queued') return '<div class="art"><div class="spinner"></div></div>';
  if (j.status === 'failed') return `<div class="art">${icons.alert}</div>`;
  if (j.kind === 'audio') return `<div class="art">${icons.wave}</div>`;
  if (isImg(j.result_url)) return `<img src="${esc(j.result_url)}" alt="" loading="lazy">`;
  return `<video src="${esc(j.result_url)}#t=0.1" muted playsinline preload="metadata"></video>`;
}

async function renderWorks() {
  if (!$view.querySelector('.works')) $view.innerHTML = '<h1>Мои работы</h1><div class="empty"><div class="spinner" style="margin:auto"></div></div>';
  let data;
  try { data = await api('/api/history'); } catch (e) { $view.innerHTML = `<h1>Мои работы</h1><div class="empty">${esc(e.message)}</div>`; return; }
  if (state.tab !== 'history' || state.stack.length) return;
  state.me.user.balance = data.balance;
  document.getElementById('walletSum').textContent = rub(data.balance);
  const labels = { queued: 'Создаётся…', done: 'Готово', failed: 'Ошибка · деньги вернули' };
  $view.innerHTML = `
    <h1>Мои работы</h1>
    <p class="lead">Готовые ролики хранятся здесь — нажмите, чтобы посмотреть и скачать.</p>
    ${data.jobs.length ? `<div class="works">${data.jobs.map((j) => `
      <button class="work" data-job="${j.id}">
        ${workMedia(j)}<span class="pill ${j.status}">${labels[j.status]}</span>
        <span class="work-info"><b>${esc(j.title)}</b><small>${new Date(j.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${rub(j.cost)}</small></span>
      </button>`).join('')}</div>` : `<div class="empty">Здесь появятся ваши ролики.<br><br><button class="btn" data-go="home">Выбрать шаблон</button></div>`}`;
  bindCommon();
  $view.querySelectorAll('[data-job]').forEach((el) => el.onclick = () => {
    const j = data.jobs.find((x) => x.id === Number(el.dataset.job));
    if (j.status === 'done') showResult(j);
    else if (j.status === 'queued') toast('Ещё создаётся — обычно 3–10 минут');
    else toast(j.error ? `Не получилось: ${j.error}`.slice(0, 160) : 'Не получилось, деньги вернули на баланс');
  });
  if (data.jobs.some((j) => j.status === 'queued')) state.pollTimer = setTimeout(renderWorks, 4000);
}

function showResult(j) {
  const wrap = document.createElement('div');
  wrap.className = 'viewer';
  const media = j.kind === 'audio' ? `<audio src="${esc(j.result_url)}" controls autoplay></audio>`
    : isImg(j.result_url) ? `<img src="${esc(j.result_url)}" alt="">`
      : `<video src="${esc(j.result_url)}" controls autoplay loop playsinline></video>`;
  wrap.innerHTML = `<div class="viewer-media">${media}</div><button class="btn wide" data-dl>Скачать</button><button class="btn ghost wide" data-close>Закрыть</button>`;
  wrap.querySelector('[data-close]').onclick = () => wrap.remove();
  wrap.querySelector('[data-dl]').onclick = () => {
    if (tg?.downloadFile) tg.downloadFile({ url: j.result_url, file_name: `kvq-${j.id}${isImg(j.result_url) ? '.png' : j.kind === 'audio' ? '.mp3' : '.mp4'}` }, () => {});
    else tg?.openLink ? tg.openLink(j.result_url) : window.open(j.result_url, '_blank');
  };
  document.body.appendChild(wrap);
}

/* ---------- Профиль ---------- */
function renderProfile() {
  const u = state.me.user;
  $view.innerHTML = `
    <h1>Профиль</h1>
    <div class="me">
      <div class="avatar">${esc((u.first_name || '?')[0])}</div>
      <div><b>${esc(u.first_name || '')}</b><br><small>${u.username ? '@' + esc(u.username) + ' · ' : ''}ID ${u.id}</small></div>
    </div>
    <div class="menu">
      <div class="row"><span>Баланс</span><span>${rub(u.balance)}</span></div>
      <button class="row" id="topupBtn"><span>Пополнить баланс</span>${icons.chev}</button>
      <button class="row" data-go="history"><span>Мои работы</span>${icons.chev}</button>
      ${state.me.support ? `<button class="row" id="support"><span>Написать в поддержку</span>${icons.chev}</button>` : ''}
    </div>
    ${inviteHtml()}`;
  bindCommon();
  bindInvite();
  $view.querySelector('#topupBtn').onclick = () => openTopup();
  $view.querySelector('#support')?.addEventListener('click', () => {
    const url = `https://t.me/${state.me.support}`;
    tg?.openTelegramLink ? tg.openTelegramLink(url) : window.open(url, '_blank');
  });
}

/* ---------- Приглашения ---------- */
function inviteHtml() {
  const r = state.me.ref;
  if (!r?.link) return '';
  return `
    <div class="invite">
      <h2>Зовите друзей</h2>
      <p>Вам — ${r.percent}% от каждого их пополнения. Навсегда.</p>
      <div class="invite-stats">
        <div><b>${r.invited}</b><small>пришли</small></div>
        <div><b>${r.paying}</b><small>пополнили</small></div>
        <div><b>${rub(r.earned)}</b><small>ваш доход</small></div>
      </div>
      <div class="invite-link" id="refCopy" title="Скопировать">${esc(r.link)}</div>
      <button class="btn wide" id="refShare">Отправить приглашение</button>
    </div>`;
}

function bindInvite() {
  const r = state.me.ref;
  $view.querySelector('#refCopy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(r.link); toast('Ссылка скопирована'); } catch { toast(r.link); }
  });
  $view.querySelector('#refShare')?.addEventListener('click', () => {
    const text = 'Делаю AI-ролики из своих фото — попробуй, новичкам бонус на баланс!';
    const url = `https://t.me/share/url?url=${encodeURIComponent(r.link)}&text=${encodeURIComponent(text)}`;
    tg?.openTelegramLink ? tg.openTelegramLink(url) : window.open(url, '_blank');
  });
}

/* ---------- старт ---------- */
async function loadMe() {
  state.me = await api('/api/me');
}

(async () => {
  try {
    [state.me, state.templates] = await Promise.all([api('/api/me'), api('/api/templates')]);
    render();
  } catch (e) {
    $view.innerHTML = `<div class="empty">${e.status === 401 ? 'Откройте приложение из Telegram — через кнопку в боте.' : esc(e.message)}</div>`;
  }
})();
