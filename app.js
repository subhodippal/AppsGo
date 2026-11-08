// AppsGo: a library of my web apps and games. Search, favourite and launch them.
// Everything personal (favourites, recently used, theme, sort) is kept in this browser's localStorage.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const KEY = 'appsGo.';
  const THEME_KEY = KEY + 'theme';
  const RECENT_MAX = 12;
  const HOME_LIMIT = 4; // rows per section on Home before "See all"

  // ---------- storage (fails quietly in private mode / blocked storage) ----------

  const store = {
    get(k, fallback) {
      try {
        const v = localStorage.getItem(KEY + k);
        return v == null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(KEY + k, JSON.stringify(v));
      } catch {}
    },
  };

  // ---------- catalog ----------

  // The list lives in apps.json (edit that file to add, change or hide apps). Loaded by loadCatalog().
  let APPS = [];
  let byId = new Map();
  let catalogError = '';

  const HOSTS = [
    [/\.github\.io$/, 'GitHub Pages'],
    [/\.(web\.app|firebaseapp\.com)$/, 'Firebase'],
    [/\.vercel\.app$/, 'Vercel'],
    [/\.netlify\.app$/, 'Netlify'],
  ];

  /** Fill in everything an entry leaves out, so a bare { "url": "…" } is enough. */
  function normalize(raw) {
    if (!raw || typeof raw.url !== 'string') return null;
    let u;
    try {
      u = new URL(raw.url);
    } catch {
      return null;
    }
    // https://subhodippal.github.io/NotesGo/ → "NotesGo"; https://my-app.web.app → "my-app"
    const slug = decodeURIComponent(u.pathname.split('/').filter(Boolean)[0] || u.hostname.split('.')[0]);
    const type = raw.type === 'game' ? 'game' : 'app';
    return {
      id: String(raw.id || slug).toLowerCase(),
      name: raw.name || slug,
      type,
      category: raw.category || (type === 'game' ? 'Game' : 'App'),
      emoji: raw.emoji || (type === 'game' ? '🎮' : '📱'),
      colors: Array.isArray(raw.colors) && raw.colors.length === 2 ? raw.colors : ['#0f766e', '#0891b2'],
      icon: raw.icon || '',
      description: raw.description || '',
      tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
      repo: raw.repo || '',
      updated: raw.updated || '',
      host: raw.host || HOSTS.find(([re]) => re.test(u.hostname))?.[1] || u.hostname,
      url: u.href,
    };
  }

  async function loadCatalog() {
    try {
      const res = await fetch('apps.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`apps.json: ${res.status} ${res.statusText}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.apps;
      if (!Array.isArray(list)) throw new Error('apps.json needs an "apps" list');
      const seen = new Set();
      APPS = [];
      for (const raw of list) {
        if (raw?.hidden) continue; // kept in the file, not shown
        const app = normalize(raw);
        if (!app) console.warn('AppsGo: skipped an entry without a valid "url"', raw);
        else if (seen.has(app.id)) console.warn(`AppsGo: skipped duplicate id "${app.id}"`, raw);
        else {
          seen.add(app.id);
          APPS.push(app);
        }
      }
      catalogError = '';
    } catch (e) {
      console.error(e);
      APPS = [];
      catalogError = location.protocol === 'file:'
        ? 'Browsers block reading apps.json from a file opened on disk. Run node server.js and open http://localhost:3000.'
        : `Couldn't load the app list (${e.message}).`;
    }
    byId = new Map(APPS.map((a) => [a.id, a]));
    // Forget favourites / history of apps that were removed from the list.
    state.favs = state.favs.filter((id) => byId.has(id));
    state.recent = state.recent.filter((r) => byId.has(r.id));
  }

  // ---------- state ----------

  const state = {
    favs: store.get('favs', []), // newest first
    recent: store.get('recent', []), // [{ id, at }], newest first
    opens: store.get('opens', {}), // { id: count }
    sort: store.get('sort', 'az'),
    cat: '', // category filter on Apps / Games (not saved)
    query: '',
    route: 'home',
  };

  const isFav = (id) => state.favs.includes(id);
  const lastUsed = (id) => state.recent.find((r) => r.id === id)?.at ?? 0;

  function toggleFav(id) {
    const on = !isFav(id);
    state.favs = on ? [id, ...state.favs] : state.favs.filter((f) => f !== id);
    store.set('favs', state.favs);
    toast(on ? `❤️ Added ${byId.get(id).name} to favourites` : `Removed ${byId.get(id).name} from favourites`);
    return on;
  }

  function launch(id) {
    const app = byId.get(id);
    if (!app) return;
    state.recent = [{ id, at: Date.now() }, ...state.recent.filter((r) => r.id !== id)].slice(0, RECENT_MAX);
    state.opens[id] = (state.opens[id] || 0) + 1;
    store.set('recent', state.recent);
    store.set('opens', state.opens);
    if (!navigator.onLine) toast("📴 You're offline, so it may not open");
    if (app.open === 'browser') openInBrowser(app);
    else openPlayer(app.id); // inside AppsGo (iframe); "open": "browser" in apps.json skips this
    render();
  }

  /**
   * Open the app outside AppsGo. `ownWindow` (the player's maximize button) asks for a separate window
   * on computers; phones open a new tab either way.
   * (No 'noopener' in the features: with it window.open() always returns null, so a blocked pop-up
   * can't be told apart. The opener link is cut by hand instead.)
   */
  function openInBrowser(app, { ownWindow = false } = {}) {
    const features = ownWindow
      ? `popup,width=${Math.min(screen.availWidth, 1280)},height=${Math.min(screen.availHeight, 900)}`
      : '';
    const win = window.open(app.url, '_blank', features);
    if (win) win.opener = null;
    else location.href = app.url; // pop-up blocked (some in-app browsers): open it here instead
  }

  // ---------- player: runs apps inside AppsGo ----------
  //
  // EXPERIMENTAL multitasking: ⌄ minimizes an app and keeps it running; the "Running" dock above the
  // tabs (and ⧉ in the player bar) switch between running apps; ✕ closes one.
  // Set MULTITASK = false to go back to one app at a time, closed when you leave it.
  const MULTITASK = true;
  const MAX_RUNNING = 4; // opening a 5th closes the one used longest ago

  const sessions = new Map(); // id → { app, frame, loaded, slow, slowTimer, at }
  let activeId = null;
  let playerPushed = false; // we added #/play/<id> to history, so Back leaves the player
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const themeDefault = themeMeta.content;

  function openPlayer(id, { push = true } = {}) {
    const app = byId.get(id);
    if (!app) return;
    const player = $('player');
    if (activeId === id && player.open) return;

    if (player.open) {
      // Switching apps inside the player: same history entry, new id.
      history.replaceState(null, '', `#/play/${encodeURIComponent(id)}`);
    } else if (push) {
      // From the details sheet: swap its #/app/<id> entry for #/play/<id>, so Back from the
      // player goes to where the sheet was opened from, not back into the sheet.
      if (location.hash.startsWith('#/app/')) {
        history.replaceState(null, '', `#/play/${encodeURIComponent(id)}`);
        playerPushed = sheetPushed;
        sheetPushed = false;
      } else if (!location.hash.startsWith('#/play/')) {
        history.pushState(null, '', `#/play/${encodeURIComponent(id)}`);
        playerPushed = true;
      }
    }
    if ($('app-sheet').open) closeSheet($('app-sheet'));
    if ($('switch-sheet').open) closeSheet($('switch-sheet'));

    if (!MULTITASK) for (const other of [...sessions.keys()]) if (other !== id) endSession(other);
    if (!sessions.has(id)) {
      if (sessions.size >= MAX_RUNNING) {
        const oldest = [...sessions.values()].sort((x, y) => x.at - y.at)[0];
        endSession(oldest.app.id);
        toast(`Closed ${oldest.app.name} to make room`);
      }
      startSession(app);
    }
    showSession(id);
    if (!player.open) player.showModal();
    document.documentElement.classList.add('playing'); // no page scroll behind the player
    renderDock();
  }

  function startSession(app) {
    const frame = document.createElement('iframe');
    frame.className = 'pl-frame';
    frame.title = app.name;
    frame.allow = 'fullscreen; autoplay; clipboard-read; clipboard-write; web-share; gamepad; screen-wake-lock; accelerometer; gyroscope';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.hidden = true;
    const sess = { app, frame, loaded: false, slow: false, slowTimer: 0, at: Date.now() };
    frame.addEventListener('load', () => {
      clearTimeout(sess.slowTimer);
      sess.loaded = true;
      if (activeId === app.id) renderLoading();
    });
    sessions.set(app.id, sess);
    $('pl-stage').append(frame); // never moved afterwards: moving an iframe reloads it
    loadSession(sess);
  }

  function loadSession(sess) {
    sess.loaded = false;
    sess.slow = false;
    clearTimeout(sess.slowTimer);
    // e.g. a site that refuses to be framed never finishes loading
    sess.slowTimer = setTimeout(() => {
      sess.slow = true;
      if (activeId === sess.app.id) renderLoading();
    }, 8000);
    sess.frame.src = sess.app.url;
    if (activeId === sess.app.id) renderLoading();
  }

  function renderLoading() {
    const sess = sessions.get(activeId);
    $('pl-loading').hidden = !sess || sess.loaded;
    $('pl-slow').hidden = !sess?.slow;
  }

  /** Bring a running app to the front; the others stay loaded but hidden. */
  function showSession(id) {
    const sess = sessions.get(id);
    activeId = id;
    sess.at = Date.now();
    for (const [sid, s] of sessions) s.frame.hidden = sid !== id;
    const app = sess.app;
    $('pl-icon').innerHTML = iconHTML(app, 'sm');
    $('pl-name').textContent = app.name;
    $('pl-host').textContent = new URL(app.url).host;
    $('player').style.setProperty('--c1', app.colors[0]);
    $('player').style.setProperty('--c2', app.colors[1]);
    themeMeta.content = app.colors[0];
    $('pl-min').hidden = !MULTITASK;
    $('pl-switch').hidden = !MULTITASK;
    $('pl-switch').setAttribute('aria-label', `${sessions.size} running ${sessions.size === 1 ? 'app' : 'apps'}: switch`);
    $('pl-switch-count').textContent = sessions.size;
    renderLoading();
  }

  /** Stop one app for good (its sounds, timers…). */
  function endSession(id) {
    const sess = sessions.get(id);
    if (!sess) return;
    clearTimeout(sess.slowTimer);
    sess.frame.remove();
    sessions.delete(id);
  }

  /** Leave the player. With MULTITASK the apps keep running (minimized); without, they're closed. */
  function hidePlayer({ fromRoute = false } = {}) {
    const player = $('player');
    if (!player.open) return;
    if ($('switch-sheet').open) $('switch-sheet').close();
    player.close();
    document.documentElement.classList.remove('playing');
    themeMeta.content = themeDefault;
    if (!MULTITASK) endSession(activeId);
    else if (activeId) sessions.get(activeId).frame.hidden = true;
    activeId = null;
    if (!fromRoute && location.hash.startsWith('#/play/')) {
      if (playerPushed) history.back();
      else history.replaceState(null, '', `#/${state.route === 'home' ? '' : state.route}`);
    }
    playerPushed = false;
    renderDock();
  }

  /** ✕ in the player: close the app you're looking at. */
  function closeActive() {
    const id = activeId;
    hidePlayer();
    endSession(id);
    renderDock();
  }

  // The "Running" dock above the tabs: tap an app to go back to it.
  function renderDock() {
    const show = MULTITASK && sessions.size > 0 && !$('player').open;
    $('dock').hidden = !show;
    document.body.classList.toggle('has-dock', show);
    if (!show) return;
    const list = [...sessions.values()].sort((x, y) => y.at - x.at);
    $('dock-apps').innerHTML = list
      .map((s) => `<button class="dock-app" type="button" data-resume="${esc(s.app.id)}" title="Back to ${esc(s.app.name)}" aria-label="Back to ${esc(s.app.name)}">${iconHTML(s.app, 'sm')}</button>`)
      .join('');
    $('dock-label').textContent = `${sessions.size} running`;
  }

  // ⧉ in the player bar: the running apps, to switch to or close.
  function openSwitcher() {
    const list = [...sessions.values()].sort((x, y) => y.at - x.at);
    $('sw-list').innerHTML = list
      .map((s) => {
        const on = s.app.id === activeId;
        return `<li class="sw-row ${on ? 'is-on' : ''}">
          <button class="sw-main" type="button" data-sw-open="${esc(s.app.id)}">
            ${iconHTML(s.app, 'lg')}
            <span class="sw-text"><strong>${esc(s.app.name)}</strong><span class="muted small">${on ? 'Showing now' : 'Tap to switch'}</span></span>
          </button>
          <button class="sw-close" type="button" data-sw-close="${esc(s.app.id)}" aria-label="Close ${esc(s.app.name)}" title="Close">✕</button>
        </li>`;
      })
      .join('');
    openSheet($('switch-sheet'));
  }

  // ---------- helpers ----------

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  /** Every word of the query must appear in the name, category, type, description or tags. */
  function matches(app, q) {
    if (!q) return true;
    const hay = norm([app.name, app.category, app.type, app.type === 'game' ? 'games' : 'apps', app.description, ...app.tags].join(' '));
    return norm(q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  }

  /** Rank: name starts with the query > name contains it > the rest. */
  function score(app, q) {
    const n = norm(app.name);
    const qq = norm(q.trim());
    return n.startsWith(qq) ? 0 : n.includes(qq) ? 1 : 2;
  }

  /** Escape `text`, wrapping the parts that match the query's words in <mark>. */
  function highlight(text, q) {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return esc(text);
    const n = norm(text);
    const marks = new Array(text.length).fill(false);
    for (const w of words) {
      for (let i = n.indexOf(w); i !== -1; i = n.indexOf(w, i + 1)) marks.fill(true, i, i + w.length);
    }
    let out = '';
    let open = false;
    for (let i = 0; i < text.length; i++) {
      if (marks[i] !== open) {
        out += marks[i] ? '<mark>' : '</mark>';
        open = marks[i];
      }
      out += esc(text[i]);
    }
    return out + (open ? '</mark>' : '');
  }

  const SORTS = {
    az: { label: 'A–Z', fn: (a, b) => a.name.localeCompare(b.name) },
    used: { label: 'Most used', fn: (a, b) => (state.opens[b.id] || 0) - (state.opens[a.id] || 0) || lastUsed(b.id) - lastUsed(a.id) || a.name.localeCompare(b.name) },
    new: { label: 'Newest', fn: (a, b) => String(b.updated || '').localeCompare(String(a.updated || '')) || a.name.localeCompare(b.name) },
  };
  if (!SORTS[state.sort]) state.sort = 'az';

  const monthYear = (iso) => {
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  };
  const typeLabel = (app) => (app.type === 'game' ? 'Game' : 'App');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // ---------- pieces of HTML ----------

  function iconHTML(app, size = '') {
    const [c1, c2] = app.colors;
    const img = app.icon ? `<img src="${esc(app.icon)}" alt="" loading="lazy" decoding="async" />` : '';
    return `<span class="app-icon ${size}" style="--c1:${esc(c1)};--c2:${esc(c2)}" aria-hidden="true"><span class="app-emoji">${esc(app.emoji)}</span>${img}</span>`;
  }

  function rowHTML(app, q = '') {
    return `
      <article class="app-row card">
        <button class="app-row-main" type="button" data-act="details" data-id="${esc(app.id)}" aria-label="${esc(app.name)} details">
          ${iconHTML(app)}
          <span class="app-text">
            <span class="app-name">${highlight(app.name, q)}</span>
            <span class="app-meta"><span class="badge ${app.type === 'game' ? 'badge-game' : ''}">${typeLabel(app)}</span>${esc(app.category)}</span>
            ${app.description ? `<span class="app-desc">${highlight(app.description, q)}</span>` : ''}
          </span>
        </button>
        <div class="app-row-side">
          <button class="open-btn" type="button" data-act="open" data-id="${esc(app.id)}" aria-label="Open ${esc(app.name)}">Open</button>
        </div>
      </article>`;
  }

  const tileHTML = (app) => `
    <button class="rail-tile" type="button" data-act="open" data-id="${esc(app.id)}" title="Open ${esc(app.name)}">
      ${iconHTML(app, 'lg')}<span class="rail-name">${esc(app.name)}</span>
    </button>`;

  const emptyHTML = (icon, title, text, action = '') => `
    <div class="card empty-card"><span class="empty-icon" aria-hidden="true">${icon}</span><strong>${title}</strong><p class="muted">${text}</p>${action}</div>`;

  // ---------- views ----------

  const ROUTES = {
    home: { title: 'AppsGo' },
    apps: { title: '📱 Apps', filter: (a) => a.type !== 'game', noun: ['app', 'apps'] },
    games: { title: '🎮 Games', filter: (a) => a.type === 'game', noun: ['game', 'games'] },
    favorites: { title: '❤️ Favourites', filter: (a) => isFav(a.id), noun: ['favourite', 'favourites'] },
  };

  function render() {
    const searching = state.query.trim() !== '';
    const route = state.route;
    const listMode = route !== 'home' || searching;

    // Header: big on Home, compact elsewhere.
    $('hero').classList.toggle('compact', route !== 'home');
    $('page-title').textContent = ROUTES[route].title;
    document.title = route === 'home' ? 'AppsGo' : `${ROUTES[route].title.replace(/^\S+\s/, '')} · AppsGo`;

    for (const a of document.querySelectorAll('[data-nav]')) {
      const on = a.dataset.nav === route;
      a.classList.toggle('is-on', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    $('fav-count').hidden = !state.favs.length;
    $('fav-count').textContent = state.favs.length;
    $('q-clear').hidden = !state.query;

    if (catalogError) {
      $('view-home').hidden = false;
      $('view-list').hidden = true;
      for (const id of ['home-recent', 'home-apps', 'home-games']) $(id).innerHTML = '';
      $('home-favs').innerHTML = emptyHTML('⚠️', "Couldn't load the apps", esc(catalogError),
        '<button class="btn btn-gradient btn-sm" type="button" data-act="retry">↻ Try again</button>');
      return;
    }

    $('view-home').hidden = listMode;
    $('view-list').hidden = !listMode;
    if (listMode) renderList(route, searching);
    else renderHome();
  }

  function renderHome() {
    const favs = state.favs.map((id) => byId.get(id));
    $('home-favs').innerHTML = favs.length
      ? `<section class="section">
          <div class="section-head"><h2 class="section-title"><span aria-hidden="true">❤️</span> Favourites</h2><a class="section-link" href="#/favorites">See all ›</a></div>
          <p class="muted small section-sub">Tap to open.</p>
          <div class="rail">${favs.map(tileHTML).join('')}</div>
        </section>`
      : `<div class="card hint-card"><span aria-hidden="true">♡</span><span>Tap any app or game, then ♡ Favourite, to keep it here for one-tap opening.</span></div>`;

    const recent = state.recent.map((r) => byId.get(r.id));
    $('home-recent').innerHTML = recent.length
      ? `<section class="section">
          <div class="section-head"><h2 class="section-title"><span aria-hidden="true">🕘</span> Recently used</h2><button class="section-link" type="button" data-act="clear-recent">Clear</button></div>
          <div class="rail">${recent.map(tileHTML).join('')}</div>
        </section>`
      : '';

    const section = (route, icon, title) => {
      const items = APPS.filter(ROUTES[route].filter).sort(SORTS.az.fn);
      if (!items.length) return '';
      const more = items.length > HOME_LIMIT ? `<a class="section-link" href="#/${route}">See all ${items.length} ›</a>` : '';
      return `<section class="section">
          <div class="section-head"><h2 class="section-title"><span aria-hidden="true">${icon}</span> ${title}</h2>${more}</div>
          <div class="app-list">${items.slice(0, HOME_LIMIT).map((a) => rowHTML(a)).join('')}</div>
        </section>`;
    };
    $('home-apps').innerHTML = section('apps', '📱', 'Apps');
    $('home-games').innerHTML = section('games', '🎮', 'Games');
  }

  function renderList(route, searching) {
    const q = state.query.trim();
    // Searching from Home searches everything; elsewhere it searches within that page.
    const base = route === 'home' ? APPS : APPS.filter(ROUTES[route].filter);

    // Category pills (Apps / Games pages only, when there's more than one category).
    const cats = route === 'apps' || route === 'games' ? [...new Set(base.map((a) => a.category))].sort() : [];
    if (!cats.includes(state.cat)) state.cat = '';
    $('cats').hidden = cats.length < 2;
    $('cats').innerHTML = cats.length < 2 ? '' : [['', 'All', base.length], ...cats.map((c) => [c, c, base.filter((a) => a.category === c).length])]
      .map(([v, label, n]) => `<button class="pill ${state.cat === v ? 'is-on' : ''}" type="button" role="radio" aria-checked="${state.cat === v}" data-act="cat" data-cat="${esc(v)}">${esc(label)}<span class="pill-count">${n}</span></button>`)
      .join('');

    $('sort').innerHTML = Object.entries(SORTS)
      .map(([k, s]) => `<button type="button" role="radio" aria-checked="${state.sort === k}" class="${state.sort === k ? 'is-on' : ''}" data-act="sort" data-sort="${k}">${s.label}</button>`)
      .join('');

    let items = base.filter((a) => (!state.cat || a.category === state.cat) && matches(a, q));
    items.sort(SORTS[state.sort].fn);
    if (searching) items.sort((a, b) => score(a, q) - score(b, q)); // stable: keeps the chosen sort within each rank

    const [one, many] = ROUTES[route].noun || ['result', 'results'];
    $('list-count').textContent = searching ? `${plural(items.length, 'result', 'results')} for “${q}”` : plural(items.length, one, many);

    if (items.length) {
      $('list').innerHTML = items.map((a) => rowHTML(a, q)).join('');
    } else if (searching) {
      $('list').innerHTML = emptyHTML('🔎', 'Nothing found', `No ${route === 'home' ? 'apps or games' : many} match “${esc(q)}”. Try another word.`,
        '<button class="btn btn-ghost btn-sm" type="button" data-act="clear-search">Clear search</button>');
    } else if (route === 'favorites') {
      $('list').innerHTML = emptyHTML('♡', 'No favourites yet', 'Tap any app or game, then ♡ Favourite. It shows up here and at the top of Home.',
        '<a class="btn btn-gradient btn-sm" href="#/">Browse apps</a>');
    } else {
      $('list').innerHTML = emptyHTML('📭', `No ${many} yet`, 'Add them to apps.json.');
    }
  }

  // ---------- details sheet ----------

  let sheetApp = null;
  let sheetPushed = false; // we added #/app/<id> to history, so Back closes the sheet

  function openDetails(id, { push = true } = {}) {
    const app = byId.get(id);
    if (!app) return;
    sheetApp = app;
    fillDetails();
    if (push && !location.hash.startsWith('#/app/')) {
      history.pushState({ sheet: id }, '', `#/app/${encodeURIComponent(id)}`);
      sheetPushed = true;
    }
    openSheet($('app-sheet'));
  }

  function fillDetails() {
    const app = sheetApp;
    const fav = isFav(app.id);
    const [c1, c2] = app.colors;
    $('as-banner').style.setProperty('--c1', c1);
    $('as-banner').style.setProperty('--c2', c2);
    $('as-mark').textContent = app.emoji;
    $('as-icon').innerHTML = iconHTML(app, 'xl');
    $('as-name').textContent = app.name;
    const updated = app.updated && monthYear(app.updated);
    $('as-meta').innerHTML =
      `<span class="badge ${app.type === 'game' ? 'badge-game' : ''}">${typeLabel(app)}</span>` +
      `<span class="as-chip">${esc(app.category)}</span>` +
      (updated ? `<span class="as-chip">Updated ${esc(updated)}</span>` : '');
    $('as-desc').textContent = app.description || '';
    $('as-desc').hidden = !app.description;
    $('as-fav-icon').textContent = fav ? '♥' : '♡';
    $('as-fav').classList.toggle('is-fav', fav);
    $('as-fav').setAttribute('aria-pressed', fav);
    $('as-fav').setAttribute('aria-label', fav ? 'Remove from favourites' : 'Add to favourites');
  }

  // ---------- share ----------

  /** The AppsGo link that opens this app's details, e.g. https://…/AppsGo/#/app/carromgo */
  const shareLink = (app) => `${location.origin}${location.pathname}#/app/${encodeURIComponent(app.id)}`;
  const shareText = (app) => `${app.type === 'game' ? '🎮' : '📱'} ${app.name}${app.description ? ` – ${app.description}` : ''}`;

  let shareTarget = null;

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Older browsers / http pages without clipboard access.
      const ta = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
      ta.style.cssText = 'position:fixed;opacity:0;top:0';
      document.body.append(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {}
      ta.remove();
      return ok;
    }
  }

  async function copyShareLink() {
    if (!shareTarget) return;
    const ok = await copyText(shareLink(shareTarget));
    toast(ok ? '🔗 Link copied' : 'Select the link and copy it');
    $('sh-copy').textContent = ok ? '✓ Copied' : 'Copy';
    $('sh-copy').classList.toggle('is-done', ok);
    if (!ok) $('sh-url').select();
  }

  function shareApp(app) {
    if (!app) return;
    shareTarget = app;
    const link = shareLink(app);
    $('sh-icon').innerHTML = iconHTML(app, 'lg');
    $('sh-title').textContent = app.name;
    $('sh-url').value = link;
    $('sh-whatsapp').href = `https://wa.me/?text=${encodeURIComponent(`${shareText(app)}\n${link}`)}`;
    $('sh-more').hidden = !navigator.share;
    $('sh-copy').textContent = 'Copy';
    $('sh-copy').classList.remove('is-done');
    openSheet($('share-sheet'));
    copyShareLink(); // copied straight away, so one tap is enough
  }

  async function shareMore() {
    if (!shareTarget) return;
    try {
      await navigator.share({ title: shareTarget.name, text: shareText(shareTarget), url: shareLink(shareTarget) });
      closeSheet($('share-sheet'));
    } catch {}
  }

  // ---------- bottom sheets (same behaviour as myExpenses) ----------

  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function openSheet(sheet) {
    sheet.classList.remove('closing');
    if (!sheet.open) sheet.showModal();
  }

  /** Slide the sheet down, then close it; `value` becomes sheet.returnValue. */
  function closeSheet(sheet, value = '') {
    if (!sheet.open || sheet.classList.contains('closing')) return;
    if (reducedMotion()) return sheet.close(value);
    sheet.classList.add('closing');
    sheet.addEventListener(
      'animationend',
      () => {
        sheet.classList.remove('closing');
        sheet.close(value);
      },
      { once: true },
    );
  }

  /** Close on Esc, on a tap outside the sheet, and via any [data-close] button inside it. */
  function wireSheet(sheet) {
    sheet.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeSheet(sheet);
    });
    sheet.addEventListener('click', (e) => {
      const r = sheet.getBoundingClientRect();
      const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (e.target === sheet && outside) closeSheet(sheet);
    });
    for (const b of sheet.querySelectorAll('[data-close]')) b.addEventListener('click', () => closeSheet(sheet, b.dataset.close));
    wireSheetDrag(sheet);
  }

  /** Pull a sheet down to close it (only when nothing under the finger is scrolled). */
  function wireSheetDrag(sheet) {
    let drag = null;
    const scrolled = (el) => {
      for (; el && el !== sheet.parentNode; el = el.parentNode) if (el.scrollTop > 0) return true;
      return false;
    };
    const reset = () => {
      sheet.style.transition = sheet.style.transform = '';
    };
    sheet.addEventListener('close', () => sheet.classList.remove('dragging', 'drag-closing'));
    sheet.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1 || sheet.classList.contains('closing') || scrolled(e.target)) return;
      drag = { y0: e.touches[0].clientY, t0: Date.now(), dy: 0, active: false };
    }, { passive: true });
    sheet.addEventListener('touchmove', (e) => {
      if (!drag) return;
      const dy = e.touches[0].clientY - drag.y0;
      if (!drag.active) {
        if (dy < -4) { drag = null; return; } // pushing up = normal scrolling
        if (dy < 8) return;
        drag.active = true;
        sheet.classList.add('dragging');
        sheet.style.transition = 'none';
      }
      e.preventDefault();
      drag.dy = Math.max(0, dy - 8);
      sheet.style.transform = `translateY(${drag.dy}px)`;
    }, { passive: false });
    const end = () => {
      if (!drag) return;
      const { dy, t0, active } = drag;
      drag = null;
      if (!active) return;
      const fling = dy > 40 && dy / (Date.now() - t0) > 0.6;
      if (dy > sheet.offsetHeight * 0.25 || dy > 140 || fling) {
        if (reducedMotion()) { reset(); return sheet.close(''); }
        sheet.style.transition = 'transform 0.2s ease-in';
        sheet.style.transform = 'translateY(100%)';
        sheet.classList.add('drag-closing');
        setTimeout(() => {
          sheet.close('');
          reset();
        }, 200);
      } else {
        sheet.style.transition = 'transform 0.2s ease';
        sheet.style.transform = '';
        setTimeout(reset, 200);
      }
    };
    sheet.addEventListener('touchend', end);
    sheet.addEventListener('touchcancel', () => { drag = null; reset(); });
  }

  function askSheet({ icon = '⚠️', title, message = '', confirmText = 'OK' }) {
    const sheet = $('confirm-sheet');
    $('confirm-icon').textContent = icon;
    $('confirm-title').textContent = title;
    $('confirm-message').textContent = message;
    $('confirm-ok').textContent = confirmText;
    sheet.returnValue = '';
    openSheet(sheet);
    return new Promise((resolve) => sheet.addEventListener('close', () => resolve(sheet.returnValue === 'ok'), { once: true }));
  }

  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2200);
  }

  // ---------- theme ----------

  const systemTheme = () => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const currentTheme = () => document.documentElement.dataset.theme || systemTheme();

  function renderThemeButton() {
    const dark = currentTheme() === 'dark';
    $('theme-btn').textContent = dark ? '☀️' : '🌙';
    $('theme-btn').title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  }

  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
    renderThemeButton();
  }

  // ---------- online status ----------

  function renderStatus() {
    $('status').hidden = navigator.onLine;
    $('status').textContent = '📴 Offline';
  }

  // ---------- install ----------

  let installPrompt = null;
  let installed = false; // installed during this visit
  const ua = navigator.userAgent;
  const isIOS = () => /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = () => /Android/.test(ua);
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isHosted = () => /^https?:$/.test(location.protocol);

  function renderInstall() {
    $('install-btn').hidden = isStandalone() || installed; // already running as the installed app
  }

  async function onInstallClick() {
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      installPrompt = null;
      if (outcome === 'accepted') installed = true;
      renderInstall();
      return;
    }
    showInstallHelp();
  }

  function showInstallHelp() {
    let html;
    if (!isHosted()) {
      html = `<p>Apps can't be installed from a file opened on disk. Run <code>node server.js</code> and open <code>http://localhost:3000</code>, or use the GitHub Pages link on your phone.</p>`;
    } else if (isIOS()) {
      html = `<ol><li>Tap the <b>Share</b> button (square with an arrow) in Safari</li><li>Scroll down and tap <b>Add to Home Screen</b></li><li>Tap <b>Add</b></li></ol>`;
    } else if (isAndroid()) {
      html = `<ol><li>Open the browser menu <b>⋮</b> (top right)</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b></li><li>Confirm with <b>Install</b></li></ol>`;
    } else if (/Edg\//.test(ua)) {
      html = `<ol><li>Click the <b>App available</b> icon in the address bar, <b>or</b></li><li>Open the menu <b>⋯</b> → <b>Apps</b> → <b>Install this site as an app</b></li></ol>`;
    } else if (/Chrome\//.test(ua)) {
      html = `<ol><li>Click the <b>Install</b> icon at the right end of the address bar, <b>or</b></li><li>Open the menu <b>⋮</b> → <b>Cast, save and share</b> → <b>Install page as app…</b></li></ol>`;
    } else {
      html = `<p>This browser can't install web apps. Open AppsGo in <b>Chrome</b>, <b>Edge</b> or <b>Safari</b> and tap <b>Install app</b> again.</p>`;
    }
    $('install-steps').innerHTML = html;
    openSheet($('install-dialog'));
  }

  // ---------- routing ----------

  function onRoute() {
    const [r, rawId] = location.hash.replace(/^#\/?/, '').split('/');
    if (r === 'play') {
      const id = decodeURIComponent(rawId || '');
      if (!byId.has(id)) return void history.replaceState(null, '', '#/');
      render();
      openPlayer(id, { push: false });
      return;
    }
    if ($('player').open) hidePlayer({ fromRoute: true }); // Back button while an app is open: minimize it
    if (r === 'app') {
      const id = decodeURIComponent(rawId || '');
      if (!byId.has(id)) return void history.replaceState(null, '', '#/');
      render(); // keep whatever page is under the sheet
      if (!$('app-sheet').open || sheetApp?.id !== id) openDetails(id, { push: false });
      return;
    }
    if ($('app-sheet').open) closeSheet($('app-sheet')); // Back button while the sheet is open
    sheetPushed = false;
    const route = ROUTES[r] ? r : 'home';
    if (route !== state.route) {
      state.route = route;
      state.cat = '';
      scrollTo({ top: 0 });
    }
    render();
  }

  // ---------- events ----------

  function onAction(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const { act, id } = el.dataset;
    if (act === 'open') launch(id);
    else if (act === 'details') openDetails(id);
    else if (act === 'fav') {
      toggleFav(id);
      render();
      // re-rendered: find the new heart to animate it
      document.querySelector(`.heart[data-id="${CSS.escape(id)}"]`)?.classList.add('pop');
    } else if (act === 'share') {
      shareApp(byId.get(id));
    } else if (act === 'sort') {
      state.sort = el.dataset.sort;
      store.set('sort', state.sort);
      render();
    } else if (act === 'cat') {
      state.cat = el.dataset.cat;
      render();
    } else if (act === 'retry') {
      loadCatalog().then(onRoute);
    } else if (act === 'clear-search') {
      setQuery('');
      $('q').focus();
    } else if (act === 'clear-recent') {
      askSheet({ icon: '🕘', title: 'Clear recently used?', message: 'Your favourites stay. Open counts are reset too.', confirmText: 'Clear' }).then((ok) => {
        if (!ok) return;
        state.recent = [];
        state.opens = {};
        store.set('recent', []);
        store.set('opens', {});
        render();
        toast('🧹 History cleared');
      });
    }
  }

  function setQuery(q) {
    state.query = q;
    $('q').value = q;
    render();
  }

  function start() {
    renderThemeButton();
    renderStatus();
    renderInstall();

    $('theme-btn').addEventListener('click', toggleTheme);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderThemeButton);
    $('install-btn').addEventListener('click', onInstallClick);
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); // show our own "Install app" button instead of the browser's mini-bar
      installPrompt = e;
      renderInstall();
    });
    window.addEventListener('appinstalled', () => {
      installPrompt = null;
      installed = true;
      renderInstall();
      toast('🎉 App installed');
    });
    addEventListener('online', renderStatus);
    addEventListener('offline', renderStatus);

    document.querySelector('main').addEventListener('click', onAction);

    // A remote icon that fails to load: drop it so the emoji tile shows.
    document.addEventListener('error', (e) => {
      if (e.target instanceof HTMLImageElement && e.target.closest('.app-icon')) e.target.remove();
    }, true);

    // Search
    $('q').addEventListener('input', () => {
      state.query = $('q').value;
      render();
    });
    $('q').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.target.blur(); // done typing: closes the phone keyboard
      if (e.key === 'Escape' && state.query) {
        e.preventDefault();
        setQuery('');
      }
    });
    $('q-clear').addEventListener('click', () => {
      setQuery('');
      $('q').focus();
    });
    // "/" focuses search (desktop)
    addEventListener('keydown', (e) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== 'INPUT' && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        $('q').focus();
      }
    });
    // Tapping the current tab again scrolls back up.
    for (const a of document.querySelectorAll('[data-nav]')) {
      a.addEventListener('click', () => {
        if (a.classList.contains('is-on')) scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    // Details sheet
    const sheet = $('app-sheet');
    wireSheet(sheet);
    wireSheet($('confirm-sheet'));
    wireSheet($('install-dialog'));
    wireSheet($('share-sheet'));
    $('sh-copy').addEventListener('click', copyShareLink);
    $('sh-copy-big').addEventListener('click', copyShareLink);
    $('sh-more').addEventListener('click', shareMore);
    $('sh-url').addEventListener('focus', (e) => e.target.select());
    sheet.addEventListener('close', () => {
      // Closed by a button / swipe / Esc: take #/app/<id> off the address bar too.
      if (location.hash.startsWith('#/app/')) {
        if (sheetPushed) history.back();
        else history.replaceState(null, '', `#/${state.route === 'home' ? '' : state.route}`);
      }
      sheetPushed = false;
    });
    $('as-open').addEventListener('click', () => sheetApp && launch(sheetApp.id));

    // Player
    $('player').addEventListener('cancel', (e) => {
      e.preventDefault(); // Esc
      hidePlayer();
    });
    $('pl-min').addEventListener('click', () => hidePlayer());
    $('pl-close').addEventListener('click', closeActive);
    $('pl-reload').addEventListener('click', () => activeId && loadSession(sessions.get(activeId)));
    $('pl-browser').addEventListener('click', () => {
      if (!activeId) return;
      const app = sessions.get(activeId).app;
      openInBrowser(app, { ownWindow: true }); // first, while the tap still counts as a user action
      closeActive();
    });
    $('pl-switch').addEventListener('click', openSwitcher);
    wireSheet($('switch-sheet'));
    $('sw-list').addEventListener('click', (e) => {
      const open = e.target.closest('[data-sw-open]');
      const close = e.target.closest('[data-sw-close]');
      if (open) openPlayer(open.dataset.swOpen);
      else if (close) {
        const id = close.dataset.swClose;
        if (id === activeId) {
          closeSheet($('switch-sheet'));
          closeActive();
        } else {
          endSession(id);
          showSession(activeId); // updates the ⧉ count
          if (sessions.size < 2) closeSheet($('switch-sheet'));
          else openSwitcher();
        }
      }
    });
    $('sw-home').addEventListener('click', () => hidePlayer());
    $('dock').addEventListener('click', (e) => {
      const b = e.target.closest('[data-resume]');
      if (b) openPlayer(b.dataset.resume);
    });
    $('dock-close').addEventListener('click', () => {
      for (const id of [...sessions.keys()]) endSession(id);
      renderDock();
      toast('Closed all apps');
    });
    $('as-fav').addEventListener('click', () => {
      if (!sheetApp) return;
      toggleFav(sheetApp.id);
      fillDetails();
      render();
      $('as-fav-icon').classList.remove('pop');
      void $('as-fav-icon').offsetWidth; // restart the animation
      $('as-fav-icon').classList.add('pop');
    });
    $('as-share').addEventListener('click', () => sheetApp && shareApp(sheetApp));

    addEventListener('hashchange', onRoute);
    // Coming back from a launched app (or another tab): refresh "Recently used" / "opened … ago".
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        render();
        if (sheet.open && sheetApp) fillDetails();
      }
    });
    loadCatalog().then(onRoute);

    if ('serviceWorker' in navigator && isHosted()) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  start();
})();
