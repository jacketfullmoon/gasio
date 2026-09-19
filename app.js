/* Quest — real-world location LARP. Multiplayer via backend.js (Firebase). */

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function distM(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
function ago(t) { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; }

// ---------- backend + state ----------
const B = Backend;
const COL = { names: 'qm_usernames', players: 'qm_players', req: 'qm_requests', battles: 'qm_battles', chats: 'qm_chats', quests: 'qm_quests' };
let ME = null;       // my uid
let S = null;        // my player doc
let others = {};     // uid -> other player docs
let myPos = null;
let realGps = false;
let unsubs = [];

const newPlayer = (name) => ({
  name, look: { skin: '#f1c27d', hair: 'short', hairColor: '#4a2a12', shirt: '#3b82f6', bg: '#cfe8ff' },
  equipped: { hat: null, face: null, neck: null }, bag: { potion: 2 },
  coins: 120, hp: 34, lvl: 5, xp: 0, claimed: [], friends: [],
  stats: { battles: 0, wins: 0, treasures: 0, quests: 0 }, medals: [], quest: null,
  photo: null, lat: null, lng: null, seen: Date.now(), created: Date.now(),
});
function gear(p, k) { return Object.values(p.equipped || {}).reduce((t, id) => t + ((id && ITEMS[id] && ITEMS[id][k]) || 0), 0); }
const statsFor = (p) => ({ atk: 5 + Math.floor(p.lvl / 2) + gear(p, 'atk'), def: 1 + Math.floor(p.lvl / 3) + gear(p, 'def'), max: 24 + p.lvl * 2, lvl: p.lvl });
const maxHp = () => 24 + S.lvl * 2;
const count = (id, p = S) => (p && p.bag && p.bag[id]) || 0;
const isFriend = (uid) => !!(S && S.friends && S.friends.includes(uid));
const isAdmin = (p) => !!(p && p.name && ADMIN_NAMES.includes(p.name.toLowerCase()));
const myAvatar = () => portrait(S);
const avatarOf = (p) => portrait(p);

// Apply locally right away, then save.
function upd(patch) { applyPatch(S, patch); onMyChange(); return B.update(COL.players, ME, patch).catch((e) => console.warn(e)); }

// ---------- map ----------
// Same vector basemap as the gas app. At night we keep the style and tint the canvas dark,
// because OpenFreeMap's own dark style drops almost all the streets and labels.
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const map = new maplibregl.Map({
  container: 'map', style: MAP_STYLE,
  center: [START.lng, START.lat], zoom: 14.5, attributionControl: { compact: true },
});
map.dragRotate.disable();
map.touchZoomRotate.disableRotation();
// Small helpers so the rest of the code can keep thinking in {lat, lng}.
const LL = (p) => [p.lng, p.lat];
const panTo = (p) => map.easeTo({ center: LL(p), duration: 600 });
const jumpTo = (p, zoom) => map.jumpTo({ center: LL(p), zoom: zoom ?? map.getZoom() });
const flyTo = (p, zoom) => map.flyTo({ center: LL(p), zoom: zoom ?? map.getZoom(), duration: 1500 });
// Build a DOM marker.
function marker(html, p, opts = {}) {
  const el = document.createElement('div');
  el.innerHTML = html;
  el.style.cursor = opts.onClick ? 'pointer' : '';
  if (opts.onClick) el.addEventListener('click', (e) => { e.stopPropagation(); opts.onClick(); });
  const m = new maplibregl.Marker({ element: el, anchor: 'center', draggable: !!opts.draggable });
  m.setLngLat(LL(p)).addTo(map);
  if (opts.onDragEnd) m.on('dragend', () => { const ll = m.getLngLat(); opts.onDragEnd({ lat: ll.lat, lng: ll.lng }); });
  return m;
}

// A player shows as their character icon (or uploaded photo) with 👣 footprints trailing behind.
function colorFor(uid) {
  let h = 0; for (const c of String(uid)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { solid: `hsl(${h} 72% 45%)`, light: `hsl(${h} 72% 60%)` };
}
function bearing(a, b) {
  const y = (b.lng - a.lng) * Math.cos(a.lat * Math.PI / 180), x = b.lat - a.lat;
  return (Math.atan2(y, x) * 180) / Math.PI;
}
// Face for a player: uploaded photo if they have one, otherwise their character.
function portrait(p) {
  if (p && p.monster) return monsterSVG(p.monster);
  return p && p.photo ? `<img class="pic" src="${p.photo}" alt="">` : avatarSVG((p && p.look) || {}, (p && p.equipped) || {});
}
function trailLayer(uid, p, opts) {
  const col = opts.me ? { solid: '#2f6fff', light: '#5b8dff' } : colorFor(uid);
  const markers = [];
  const pts = (p.trail || []).slice(-8);
  const path = pts.concat([{ lat: p.lat, lng: p.lng }]);
  for (let i = 0; i < pts.length; i++) {
    const op = (0.22 + 0.6 * (i / Math.max(1, pts.length - 1))).toFixed(2);
    const rot = bearing(path[i], path[i + 1]).toFixed(0);
    markers.push(marker(`<div class="foot" style="opacity:${op};transform:rotate(${rot}deg)">👣</div>`, pts[i]));
  }
  markers.push(marker(
    `<div class="mk ${opts.me ? 'mk-me' : ''} ${opts.friend ? 'mk-friend' : ''}" style="--c:${col.solid};--cl:${col.light}">
      <div class="mk-avatar">${portrait(p)}</div><div class="mk-label">${esc(p.name)}</div></div>`,
    p, { onClick: opts.onClick, draggable: opts.draggable, onDragEnd: opts.onDragEnd }));
  return { markers, head: markers[markers.length - 1], remove() { markers.forEach((m) => m.remove()); } };
}

// Dark map after 7pm, back to daylight at 6am.
let isNight = null;
function updateNight() {
  const h = new Date().getHours(), night = h >= 19 || h < 6;
  if (night === isNight) return;
  isNight = night;
  document.body.classList.toggle('night', night);
}
updateNight();
setInterval(updateNight, 60000);

let meLayer = null, meKey = '';
function renderMe() {
  if (!S || !myPos) return;
  const p = { ...S, lat: myPos.lat, lng: myPos.lng, trail: myTrail };
  const key = JSON.stringify([myPos, myTrail.length, S.name, S.look, S.equipped, S.photo, realGps]);
  if (meLayer && key === meKey) return;
  meKey = key;
  if (meLayer) meLayer.remove();
  meLayer = trailLayer(ME, p, { me: true, draggable: !realGps, onClick: openProfile,
    onDragEnd: (q) => setPos(q, false) });
}

let lastPush = { t: 0, p: null };
let myTrail = [];
function pushPos(force) {
  if (!ME || !myPos) return;
  const moved = !lastPush.p || distM(lastPush.p, myPos) > 15;
  if (!force && !moved && Date.now() - lastPush.t < 60000) return;
  if (!force && Date.now() - lastPush.t < 5000) return;
  lastPush = { t: Date.now(), p: myPos };
  const tail = myTrail[myTrail.length - 1];
  if (!tail || distM(tail, myPos) > 20) {
    myTrail = [...myTrail, { lat: myPos.lat, lng: myPos.lng, t: Date.now() }].slice(-8);
  }
  B.update(COL.players, ME, { lat: myPos.lat, lng: myPos.lng, seen: Date.now(), trail: myTrail }).catch(() => {});
}
setInterval(() => pushPos(false), 20000);

function setPos(p, pan = true) {
  myPos = { lat: p.lat, lng: p.lng };
  pushPos(false);
  renderMe();
  if (pan) panTo(p);
  checkProximity();
}

// treasures & shops
const treasureMarkers = {};
const chestHtml = (t) => `<div class="mk-poi chest ${S && (S.claimed || []).includes(t.id) ? 'claimed' : ''}">${CHEST_SVG}</div>`;
TREASURES.forEach((t) => { treasureMarkers[t.id] = marker(chestHtml(t), t, { onClick: () => openTreasure(t) }); });
let claimedKey = '';
function renderChests() {
  const k = (S.claimed || []).join();
  if (k === claimedKey) return; claimedKey = k;
  TREASURES.forEach((t) => { treasureMarkers[t.id].getElement().innerHTML = chestHtml(t); });
}
SHOPS.forEach((s) => marker(`<div class="mk-poi">${s.ico}</div>`, s, { onClick: () => openShop(s) }));

// other players
const playerMarkers = {};
function renderOthers() {
  const now = Date.now();
  for (const [uid, p] of Object.entries(others)) {
    const show = p.lat != null && now - (p.seen || 0) < ONLINE_WINDOW_MS;
    const m = playerMarkers[uid];
    if (!show) { if (m) { m.layer.remove(); delete playerMarkers[uid]; } continue; }
    const key = JSON.stringify([p.lat, p.lng, p.trail, p.name, p.look, p.equipped, p.photo, isFriend(uid)]);
    if (m && m.key === key) continue;
    if (m) m.layer.remove();
    const layer = trailLayer(uid, p, { friend: isFriend(uid), onClick: () => openPlayer(uid) });
    playerMarkers[uid] = { layer, key };
  }
  for (const uid of Object.keys(playerMarkers)) if (!others[uid]) { playerMarkers[uid].layer.remove(); delete playerMarkers[uid]; }
}
setInterval(() => ME && renderOthers(), 30000);

// ---------- GPS ----------
const locStatus = $('#loc-status');
let watchId = null;
function setStatus(txt) { locStatus.textContent = txt; locStatus.classList.toggle('hidden', !txt); }
function startGps(fromTap) {
  if (!navigator.geolocation || !window.isSecureContext) { setStatus('📍 Location unavailable — drag yourself to move'); return; }
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  setStatus('Finding you…');
  watchId = navigator.geolocation.watchPosition((p) => {
    const first = !realGps;
    realGps = true; setStatus('');
    setPos({ lat: p.coords.latitude, lng: p.coords.longitude }, first);
    if (first) jumpTo({ lat: p.coords.latitude, lng: p.coords.longitude }, 16);
  }, (e) => {
    if (realGps && e.code !== e.PERMISSION_DENIED) return;
    navigator.geolocation.clearWatch(watchId); watchId = null;
    realGps = false; renderMe();
    setStatus('📍 Location off — drag yourself to move');
    if (e.code === e.PERMISSION_DENIED) {
      if (fromTap) showLocationHelp();
      else toast('📍 Location is blocked, so others can\'t see where you really are.', [['How to fix', 'primary', showLocationHelp], ['Later', '', null]]);
    } else if (fromTap) toast(e.code === e.TIMEOUT ? 'Location timed out. Try again outside.' : "Couldn't find your location.");
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}
$('#locate-btn').onclick = () => { if (realGps && myPos) map.easeTo({ center: LL(myPos), zoom: 16 }); else startGps(true); };
function showLocationHelp() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  openSheet(`
    <h2>📍 Location is blocked</h2>
    <p>Your ${ios ? 'iPhone' : 'browser'} is blocking this site from using your location. To turn it on:</p>
    ${ios ? `<ol style="padding-left:20px;line-height:1.6;font-size:14px;margin:0 0 12px">
      <li><b>Settings → Privacy &amp; Security → Location Services</b>: make sure it's <b>On</b>.</li>
      <li>On that same screen, scroll to <b>Safari Websites</b> (or <b>Chrome</b>) → <b>While Using the App</b>, and turn on <b>Precise Location</b>.</li>
      <li>In Safari, tap the <b>page menu</b> icon next to the address bar → <b>Website Settings</b> → <b>Location</b> → <b>Allow</b>.</li>
      <li>Reload this page.</li></ol>`
    : `<p>Click the icon next to the address bar, set <b>Location</b> to <b>Allow</b>, then reload.</p>`}
    <div class="btns"><button class="btn primary" id="reload">Reload page</button><button class="btn" id="stay">Not now</button></div>
  `, 'lochelp');
  $('#reload').onclick = () => location.reload();
  $('#stay').onclick = closeSheet;
}

// ---------- HUD ----------
function renderHud() {
  $('#btn-profile').innerHTML = myAvatar();
  $('#hud-coins').textContent = S.coins;
  const pct = Math.max(0, Math.min(100, S.hp / maxHp() * 100));
  $('#hud-hp').style.width = pct + '%';
  $('#hud-hp').style.background = pct < 25 ? '#ef4444' : pct < 50 ? '#f5b82e' : '';
}
$('#btn-profile').onclick = openProfile;
$('#btn-bag').onclick = openBag;
$('#btn-friends').onclick = openFriends;
$('#btn-search').onclick = openSearch;
$('#btn-stats').onclick = openStats;
$('#btn-quests').onclick = openQuests;
setInterval(() => { if (S && !inBattle && S.hp < maxHp()) upd({ hp: B.inc(1) }); }, 30000);

// ---------- toasts ----------
function toast(html, buttons, ttl = 4500) {
  const el = document.createElement('div');
  el.className = 'toast'; el.innerHTML = html;
  if (buttons) {
    const b = document.createElement('div'); b.className = 'btns';
    buttons.forEach(([label, cls, fn]) => {
      const btn = document.createElement('button'); btn.className = 'btn ' + cls; btn.textContent = label;
      btn.onclick = () => { el.remove(); fn && fn(); }; b.appendChild(btn);
    });
    el.appendChild(b);
  }
  $('#toasts').appendChild(el);
  if (ttl) setTimeout(() => el.remove(), buttons ? ttl * 2 : ttl);
  return el;
}

// ---------- sheet ----------
const sheet = $('#sheet'), sheetBody = $('#sheet-body'), backdrop = $('#sheet-backdrop');
let sheetKind = null, sheetRefresh = null, sheetCleanup = null;
function openSheet(html, kind, refresh) {
  if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
  const same = !sheet.classList.contains('hidden') && sheetBody.dataset.kind === kind, y = sheet.scrollTop;
  sheetKind = kind; sheetRefresh = refresh || null;
  sheetBody.dataset.kind = kind; sheetBody.innerHTML = html;
  sheet.classList.remove('hidden'); backdrop.classList.remove('hidden');
  sheet.scrollTop = same ? y : 0;
}
function closeSheet() {
  sheet.classList.add('hidden'); backdrop.classList.add('hidden');
  sheetKind = null; sheetRefresh = null; sheetBody.dataset.kind = '';
  if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
}
backdrop.onclick = closeSheet;

// ---------- auth (same flow as the gas app) ----------
function validateUsername(name) {
  if (name.length < 3) return 'Too short — at least 3 characters';
  if (name.length > 20) return 'Too long — max 20 characters';
  if (!/^[a-zA-Z0-9_]+$/.test(name)) return 'Only letters, numbers, and underscores';
  return null;
}
let justCreated = false;
(function setupAuth() {
  const modal = $('#auth-modal'), usernameIn = $('#username-input'), passwordIn = $('#password-input'), hintIn = $('#hint-input');
  const hint = $('#username-hint'), btn = $('#auth-submit'), disclaimer = $('#password-disclaimer');
  const tabCreate = $('#tab-create'), tabLogin = $('#tab-login'), forgotBtn = $('#forgot-btn'), hintReveal = $('#hint-reveal');
  let mode = 'create';
  const fail = (msg) => { hint.textContent = msg; hint.classList.add('error'); };
  function setMode(m) {
    mode = m;
    tabCreate.classList.toggle('active', m === 'create'); tabLogin.classList.toggle('active', m === 'login');
    $('#auth-title').textContent = m === 'create' ? 'Create your character' : 'Welcome back';
    btn.textContent = m === 'create' ? 'Create Account' : 'Log In';
    disclaimer.hidden = m !== 'create';
    hintIn.style.display = m === 'create' ? '' : 'none';
    forgotBtn.style.display = m === 'login' ? 'block' : 'none';
    hintReveal.classList.remove('visible'); hintReveal.textContent = '';
    hint.classList.remove('error');
    hint.textContent = m === 'create' ? '3–20 characters, letters/numbers/underscores only' : '';
    passwordIn.autocomplete = m === 'create' ? 'new-password' : 'current-password';
  }
  tabCreate.onclick = () => setMode('create');
  tabLogin.onclick = () => setMode('login');
  setMode('create');

  forgotBtn.onclick = async () => {
    const val = usernameIn.value.trim();
    if (!val) return fail('Enter your character name first');
    forgotBtn.textContent = 'Looking up…'; forgotBtn.disabled = true;
    try {
      const d = await B.get(COL.names, val.toLowerCase());
      hintReveal.textContent = !d ? 'No account found with that name.' : d.password_hint ? 'Your hint: ' + d.password_hint : 'No hint was saved for this account.';
    } catch { hintReveal.textContent = 'Could not look up your hint — try again.'; }
    hintReveal.classList.add('visible');
    forgotBtn.textContent = 'Forgot password? Show my hint'; forgotBtn.disabled = false;
  };

  async function attemptCreate() {
    const val = usernameIn.value.trim(), pass = passwordIn.value;
    const err = validateUsername(val); if (err) return fail(err);
    if (pass.length < 6) return fail('Password must be at least 6 characters');
    btn.disabled = true; btn.textContent = 'Creating…'; hint.classList.remove('error'); hint.textContent = '';
    try {
      const key = val.toLowerCase();
      if (await B.get(COL.names, key)) return fail('That name is taken — try another');
      justCreated = true;
      const uid = await B.signUp(val, pass);
      const h = hintIn.value.trim();
      await B.set(COL.names, key, { uid, name: val, created: Date.now(), ...(h ? { password_hint: h } : {}) });
      await B.set(COL.players, uid, newPlayer(val));
    } catch (e) {
      justCreated = false;
      fail(e.code === 'auth/email-already-in-use' ? 'That name is taken — try another' : e.message || 'Something went wrong — try again');
    } finally { btn.disabled = false; btn.textContent = mode === 'create' ? 'Create Account' : 'Log In'; }
  }
  async function attemptLogin() {
    const val = usernameIn.value.trim(), pass = passwordIn.value;
    if (!val) return fail('Enter your character name');
    if (!pass) return fail('Enter your password');
    btn.disabled = true; btn.textContent = 'Logging in…'; hint.classList.remove('error'); hint.textContent = '';
    try { await B.logIn(val, pass); }
    catch (e) {
      fail(['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials'].includes(e.code)
        ? 'Name or password is incorrect' : e.message || 'Login failed');
    } finally { btn.disabled = false; btn.textContent = mode === 'create' ? 'Create Account' : 'Log In'; }
  }
  btn.onclick = () => (mode === 'create' ? attemptCreate() : attemptLogin());
  usernameIn.onkeydown = (e) => { if (e.key === 'Enter') passwordIn.focus(); };
  passwordIn.onkeydown = (e) => { if (e.key === 'Enter') { if (mode === 'create') hintIn.focus(); else attemptLogin(); } };
  hintIn.onkeydown = (e) => { if (e.key === 'Enter') attemptCreate(); };

  if (B.mode === 'unconfigured') { modal.classList.add('hidden'); $('#setup-modal').classList.remove('hidden'); return; }
  B.onAuth((uid) => {
    if (uid) { modal.classList.add('hidden'); startSession(uid); }
    else { endSession(); modal.classList.remove('hidden'); }
  });
})();

// ---------- session ----------
let firstLoad = true;
function startSession(uid) {
  if (ME === uid) return;
  endSession();
  ME = uid; firstLoad = true;
  unsubs.push(B.watchDoc(COL.players, uid, (d) => {
    if (!d) return; // still being created
    S = d;
    if (firstLoad) {
      firstLoad = false;
      ['#side-btns', '#stat-pill', '#locate-btn'].forEach((s) => $(s).classList.remove('hidden'));
      myPos = S.lat != null ? { lat: S.lat, lng: S.lng } : { lat: START.lat, lng: START.lng };
      myTrail = Array.isArray(S.trail) ? S.trail : [];
      renderMe(); jumpTo(myPos, 16);
      pushPos(true);
      startGps(false);
      if (justCreated) { justCreated = false; openProfile(); toast(`👋 Welcome, ${esc(S.name)}! Style your character, then go explore.`, null, 7000); }
    }
    onMyChange();
  }));
  unsubs.push(B.watchAll(COL.players, (list) => {
    others = {}; list.forEach((p) => { if (p.id !== ME) others[p.id] = p; });
    renderOthers();
    if ((sheetKind === 'friends' || sheetKind === 'player') && sheetRefresh) sheetRefresh();
  }));
  unsubs.push(B.watchWhere(COL.req, 'to', uid, onIncoming));
  unsubs.push(B.watchAll(COL.quests, (list) => {
    dbQuests = {}; list.forEach((q) => { if (!q.deleted) dbQuests[q.id] = q; });
    if (sheetKind === 'quests' && sheetRefresh) sheetRefresh();
  }));
}
function endSession() {
  unsubs.forEach((u) => u && u()); unsubs = [];
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null; ME = null; S = null; others = {}; realGps = false; incoming = [];
  Object.values(playerMarkers).forEach((m) => m.layer.remove());
  for (const k in playerMarkers) delete playerMarkers[k];
  if (meLayer) { meLayer.remove(); meLayer = null; meKey = ''; }
  myTrail = [];
  ['#side-btns', '#stat-pill', '#locate-btn'].forEach((s) => $(s).classList.add('hidden'));
  Object.values(reqToasts).forEach((el) => el.remove());
  setStatus(''); closeSheet();
}
let leveling = false;
function onMyChange() {
  if (!S) return;
  // Keep data tidy: level up at 100 XP, unequip items you no longer own.
  if (S.xp >= 100 && !leveling) {
    leveling = true; const lv = S.lvl + Math.floor(S.xp / 100);
    toast(`⭐ Level up! You're now Lv${lv}.`);
    upd({ xp: S.xp % 100, lvl: lv, hp: 24 + lv * 2 }); leveling = false;
  }
  for (const [slot, id] of Object.entries(S.equipped || {})) if (id && count(id) <= 0) upd({ ['equipped.' + slot]: null });
  renderHud(); renderMe(); renderChests(); renderQuestMarker();
  if (['bag', 'shop', 'treasure'].includes(sheetKind) && sheetRefresh) sheetRefresh();
}

// ---------- treasure ----------
function openTreasure(t) {
  if (!S) return;
  const d = distM(myPos, t), inRange = d <= CLAIM_RADIUS_M, claimed = (S.claimed || []).includes(t.id), it = ITEMS[t.item];
  openSheet(`
    <div class="row"><div style="font-size:42px">${claimed ? '📭' : '🧰'}</div>
      <div><h2>${esc(t.name)}</h2>
      <span class="pill ${inRange ? 'ok' : 'far'}">${inRange ? 'You are here!' : fmtDist(d) + ' away'}</span>
      <span class="pill">${claimed ? 'Opened' : it.rarity + ' chest'}</span></div></div>
    <p>${claimed ? `You already found the <b>${it.ico} ${esc(it.name)}</b> here.` : esc(t.hint)}</p>
    ${claimed ? '' : `<p class="sub">Reward: ${it.rarity} item + ${t.coins} coins. Get within ${CLAIM_RADIUS_M} m to open it.</p>`}
    <div class="btns">
      ${claimed ? '' : `<button class="btn primary" id="claim" ${inRange ? '' : 'disabled'}>Open chest</button>`}
      <a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${t.lat},${t.lng}&travelmode=walking">Directions</a>
    </div>
  `, 'treasure', () => openTreasure(t));
  const c = $('#claim'); if (c) c.onclick = () => claimTreasure(t);
}
function claimTreasure(t) {
  if ((S.claimed || []).includes(t.id) || distM(myPos, t) > CLAIM_RADIUS_M) return;
  const it = ITEMS[t.item];
  closeSheet();
  upd({ claimed: B.union(t.id), ['bag.' + t.item]: B.inc(1), coins: B.inc(t.coins), xp: B.inc(40), 'stats.treasures': B.inc(1) });
  openSheet(`
    <div style="text-align:center">
      <div style="font-size:64px;margin:8px 0">${it.ico}</div>
      <h2>You found ${esc(it.name)}!</h2>
      <p>${esc(it.desc)}<br><b>+${t.coins} coins</b> · ${statLine(it)}</p>
      <div class="btns"><button class="btn primary" id="eq">Wear it now</button><button class="btn" id="later">Put in bag</button></div>
    </div>`, 'reward');
  $('#eq').onclick = () => { upd({ ['equipped.' + it.slot]: t.item }); openProfile(); };
  $('#later').onclick = closeSheet;
}
function statLine(it) {
  const s = [];
  if (it.atk) s.push(`+${it.atk} ATK`); if (it.def) s.push(`+${it.def} DEF`); if (it.heal) s.push(`+${it.heal} HP`);
  return s.join(' · ') || it.rarity;
}
const nudged = new Set();
function checkProximity() {
  if (!S || sheetKind || inBattle) return;
  checkQuestStep();
  TREASURES.forEach((t) => {
    if (!(S.claimed || []).includes(t.id) && distM(myPos, t) <= CLAIM_RADIUS_M && !nudged.has(t.id)) {
      nudged.add(t.id);
      toast(`🧰 You're at <b>${esc(t.name)}</b>! A chest is here.`, [['Open it', 'primary', () => openTreasure(t)], ['Later', '', null]]);
    }
  });
}

// ---------- shop ----------
const SHOP_RADIUS_M = 80;
function openShop(s) {
  if (!S) return;
  const d = distM(myPos, s), here = d <= SHOP_RADIUS_M;
  openSheet(`
    <div class="row"><div style="font-size:42px">${s.ico}</div><div><h2>${esc(s.name)}</h2>
      <span class="pill ${here ? 'ok' : 'far'}">${here ? 'Open — you are here' : fmtDist(d) + ' away'}</span></div></div>
    <p>${esc(s.blurb)}</p>
    <div class="list">${s.stock.map((id) => { const it = ITEMS[id]; return `
      <div class="item"><div class="ico">${it.ico}</div><div class="grow"><b>${esc(it.name)}</b><span class="sub">${esc(it.desc)} ${statLine(it)}</span></div>
      <button class="btn gold" data-buy="${id}" ${here && S.coins >= it.price ? '' : 'disabled'}>🪙 ${it.price}</button></div>`; }).join('')}
    </div>
    ${here ? '' : '<p class="sub" style="margin-top:12px">Visit in person to buy.</p>'}
  `, 'shop', () => openShop(s));
  sheetBody.querySelectorAll('[data-buy]').forEach((b) => (b.onclick = () => {
    const it = ITEMS[b.dataset.buy];
    if (S.coins < it.price) return;
    upd({ coins: B.inc(-it.price), ['bag.' + b.dataset.buy]: B.inc(1) });
    toast(`Bought ${it.ico} ${esc(it.name)}`, null, 2000);
  }));
}

// ---------- bag ----------
function openBag() {
  const ids = Object.keys(S.bag || {}).filter((id) => count(id) > 0 && ITEMS[id]);
  openSheet(`
    <h2>🎒🍗 Bag &amp; items</h2>
    <p class="sub">Treasures found: ${(S.claimed || []).length}/${TREASURES.length} · Tap to wear or use.</p>
    ${ids.length ? `<div class="grid">${ids.map((id) => { const it = ITEMS[id]; const on = Object.values(S.equipped || {}).includes(id); return `
      <button class="slot ${on ? 'equipped' : ''}" data-id="${id}"><span class="ico">${it.ico}</span>${esc(it.name)}<small>${it.slot === 'use' ? '×' + count(id) : statLine(it)}</small></button>`; }).join('')}</div>`
      : '<div class="empty">Empty. Find chests or visit a shop.</div>'}
  `, 'bag', openBag);
  sheetBody.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => useOrEquip(b.dataset.id)));
}
function useOrEquip(id) {
  const it = ITEMS[id];
  if (it.slot !== 'use') return upd({ ['equipped.' + it.slot]: S.equipped[it.slot] === id ? null : id });
  if (id === 'map') {
    const left = TREASURES.filter((t) => !(S.claimed || []).includes(t.id));
    if (!left.length) return toast('No hidden treasures left!');
    const t = left.sort((a, b) => distM(myPos, a) - distM(myPos, b))[0];
    upd({ ['bag.' + id]: B.inc(-1) });
    toast(`🗺️ Nearest chest: <b>${esc(t.name)}</b> (${fmtDist(distM(myPos, t))}). ${esc(t.hint)}`, null, 8000);
    flyTo(t, 15); closeSheet(); return;
  }
  if (S.hp >= maxHp()) return toast('HP is already full.');
  upd({ hp: Math.min(maxHp(), S.hp + it.heal), ['bag.' + id]: B.inc(-1) });
  toast(`${it.ico} +${it.heal} HP`, null, 2000);
}

// ---------- profile / character creator ----------
// Shrink an uploaded photo to a small square so it fits in the database and loads fast.
function pickPhoto() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 128, c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = c.getContext('2d');
        const side = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        let data = c.toDataURL('image/jpeg', 0.75);
        if (data.length > 200000) data = c.toDataURL('image/jpeg', 0.5);
        upd({ photo: data });
        toast('📸 Photo set as your icon', null, 2500);
        openProfile();
      };
      img.onerror = () => toast("Couldn't read that image.");
      img.src = reader.result;
    };
    reader.onerror = () => toast("Couldn't read that file.");
    reader.readAsDataURL(file);
  };
  input.click();
}

function openProfile() {
  if (!S) return;
  const opt = (key, vals, swatch) => vals.map((v) => swatch
    ? `<button class="swatch ${S.look[key] === v ? 'sel' : ''}" style="background:${v}" data-k="${key}" data-v="${v}" aria-label="${v}"></button>`
    : `<button class="opt ${S.look[key] === v ? 'sel' : ''}" data-k="${key}" data-v="${v}">${key === 'hair' && HAIR_STYLES[v] ? HAIR_STYLES[v].label : v}</button>`).join('');
  const gearOpts = ['hat', 'face', 'neck'].map((slot) => {
    const owned = Object.keys(S.bag || {}).filter((id) => ITEMS[id] && ITEMS[id].slot === slot && count(id) > 0);
    return `<button class="opt ${!S.equipped[slot] ? 'sel' : ''}" data-slot="${slot}" data-item="">No ${slot}</button>` +
      owned.map((id) => `<button class="opt ${S.equipped[slot] === id ? 'sel' : ''}" data-slot="${slot}" data-item="${id}">${ITEMS[id].ico} ${esc(ITEMS[id].name)}</button>`).join('');
  }).join('');
  const st = statsFor(S);
  openSheet(`
    <div class="row">
      <div class="big-avatar" id="av">${S.photo ? myAvatar() : `
        <div class="av-layer av-back">${avatarSVG(S.look, S.equipped, { hair: 'back' })}</div>
        <div class="av-layer av-head">${avatarSVG(S.look, S.equipped, { hair: 'none' })}</div>
        <div class="av-layer av-front">${avatarSVG(S.look, S.equipped, { hair: 'front' })}</div>`}</div>
      <div><h2>${esc(S.name)}</h2>
        <div class="sub">Lv${S.lvl} · XP ${S.xp}/100</div>
        <div class="sub">HP ${S.hp}/${st.max} · ATK ${st.atk} · DEF ${st.def}</div>
        <div class="sub">🪙 ${S.coins} · 🤝 ${(S.friends || []).length} friends</div>
        ${isAdmin(S) ? '<div style="margin-top:4px"><span class="pill">⭐ Anderune master</span></div>' : ''}</div>
    </div>
    <label class="field">Icon</label>
    <div class="photo-row">
      <button class="btn" id="photo-btn">📸 ${S.photo ? 'Change photo' : 'Use a photo'}</button>
      ${S.photo ? '<button class="btn" id="photo-clear">Use my character</button>' : ''}
    </div>
    <p class="sub" style="margin-top:8px">${S.photo ? 'Your photo is your map icon and battle portrait. Everyone playing can see it.' : 'Or build a character below.'}</p>
    <label class="field">Skin</label><div class="opts">${opt('skin', AVATAR_OPTIONS.skin, true)}</div>
    <label class="field">Hair</label><div class="opts">${opt('hair', AVATAR_OPTIONS.hair)}</div>
    <label class="field">Hair color</label><div class="opts">${opt('hairColor', AVATAR_OPTIONS.hairColor, true)}</div>
    <label class="field">Outfit</label><div class="opts">${opt('shirt', AVATAR_OPTIONS.shirt, true)}</div>
    <label class="field">Icon background</label><div class="opts">${opt('bg', AVATAR_OPTIONS.bg, true)}</div>
    <label class="field">Gear (from treasures &amp; shops)</label><div class="opts">${gearOpts}</div>
    ${myParty().length ? `<p class="sub" style="margin-top:12px">🧑‍🤝‍🧑 In a party with <b>${myParty().map((u) => esc(others[u].name)).join(', ')}</b> until midnight — you fight together.
      <button class="sub" id="leave-party" style="text-decoration:underline">Leave party</button></p>` : ''}
    <div class="btns"><button class="btn primary" id="done">Done</button></div>
    <div class="btns"><button class="btn" id="logout">Log out</button></div>
  `, 'profile');
  sheetBody.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.k, v = b.dataset.v;
    if (S.look[k] === v) return;
    const nextLook = { ...S.look, [k]: v };
    if (!S.photo && (k === 'hair' || k === 'hairColor')) swapHair(nextLook);
    upd({ ['look.' + k]: v });
    // Update the picker in place so the avatar animation isn't cut off by a re-render.
    sheetBody.querySelectorAll(`[data-k="${k}"]`).forEach((o) => o.classList.toggle('sel', o.dataset.v === v));
    const head = $('#av') && $('#av').querySelector('.av-head');
    if (head && (k === 'skin' || k === 'shirt' || k === 'bg')) head.innerHTML = avatarSVG(nextLook, S.equipped, { hair: 'none' });
  }));
  sheetBody.querySelectorAll('[data-slot]').forEach((b) => (b.onclick = () => { upd({ ['equipped.' + b.dataset.slot]: b.dataset.item || null }); openProfile(); }));
  const lp2 = $('#leave-party'); if (lp2) lp2.onclick = () => leaveParty();
  $('#photo-btn').onclick = pickPhoto;
  const pc = $('#photo-clear'); if (pc) pc.onclick = () => { upd({ photo: null }); openProfile(); };
  $('#done').onclick = closeSheet;
  $('#logout').onclick = () => { closeSheet(); B.logOut(); };
}

// One clean motion: the old hair slides off, the new style slides in behind it.
function swapHair(look) {
  const av = $('#av'); if (!av) return;
  const oldLayers = [...av.querySelectorAll('.av-back, .av-front')];
  const mk = (cls, html) => { const d = document.createElement('div'); d.className = `av-layer ${cls} av-anim av-in`; d.innerHTML = html; return d; };
  const back = mk('av-back', avatarSVG(look, S.equipped, { hair: 'back' }));
  const front = mk('av-front', avatarSVG(look, S.equipped, { hair: 'front' }));
  av.insertBefore(back, av.firstChild); // behind the head
  av.appendChild(front);
  oldLayers.forEach((el) => el.classList.add('av-anim'));
  void av.offsetWidth; // flush styles so both layers start from their off-screen position
  requestAnimationFrame(() => {
    oldLayers.forEach((el) => el.classList.add('av-out'));
    [back, front].forEach((el) => el.classList.remove('av-in'));
  });
  setTimeout(() => { oldLayers.forEach((el) => el.remove()); [back, front].forEach((el) => el.classList.remove('av-anim')); }, 520);
}

// ---------- players & friends ----------
const online = (p) => p.lat != null && Date.now() - (p.seen || 0) < ONLINE_WINDOW_MS;
function openPlayer(uid) {
  const p = others[uid]; if (!p) return;
  const d = online(p) && myPos ? distM(myPos, p) : Infinity, near = d <= NEARBY_RADIUS_M, friend = isFriend(uid);
  const pendingFriend = incoming.find((r) => r.from === uid && r.kind === 'friend' && r.status === 'pending');
  const inMyParty = myParty().includes(uid);
  openSheet(`
    <div class="row"><div class="big-avatar" style="width:90px;height:90px">${avatarOf(p)}</div>
      <div><h2>${esc(p.name)}</h2><div class="sub">Lv${p.lvl} · ${online(p) ? fmtDist(d) + ' away' : 'last seen ' + ago(p.seen || 0)}</div>
      <div style="margin-top:6px">${isAdmin(p) ? '<span class="pill">⭐ Anderune master</span>' : ''}${inMyParty ? '<span class="pill party-pill">In your party</span>' : ''}${friend ? '<span class="pill ok">Friend</span>' : ''}<span class="pill ${near ? 'ok' : 'far'}">${near ? 'Nearby' : online(p) ? 'Too far to battle' : 'Offline'}</span></div></div></div>
    <p>${near ? 'Send a request. They choose whether to accept.' : friend ? `Friends can chat from anywhere. Get within ${NEARBY_RADIUS_M} m to battle.` : `Get within ${NEARBY_RADIUS_M} m to battle or talk.`}</p>
    <div class="btns">
      <button class="btn primary" id="rq-battle" ${near ? '' : 'disabled'}>⚔️ Battle?</button>
      <button class="btn blue" id="rq-talk" ${near || friend ? '' : 'disabled'}>💬 Talk?</button>
    </div>
    ${friend ? '' : pendingFriend ? '<div class="btns"><button class="btn" id="acc-friend">🤝 Accept friend request</button></div>'
      : '<div class="btns"><button class="btn" id="rq-friend">🤝 Add friend</button></div>'}
    ${inMyParty ? '<div class="btns"><button class="btn" id="leave-party">🧑‍🤝‍🧑 Leave party</button></div>'
      : `<div class="btns"><button class="btn" id="rq-party" ${near ? '' : 'disabled'}>🧑‍🤝‍🧑 Ask to join party</button></div>`}
  `, 'player', () => openPlayer(uid));
  $('#rq-battle').onclick = () => sendRequest(uid, 'battle');
  $('#rq-talk').onclick = () => sendRequest(uid, 'talk');
  const f = $('#rq-friend'); if (f) f.onclick = () => sendRequest(uid, 'friend');
  const a = $('#acc-friend'); if (a) a.onclick = () => { closeSheet(); acceptRequest(pendingFriend); };
  const pt = $('#rq-party'); if (pt) pt.onclick = () => sendRequest(uid, 'party');
  const lp = $('#leave-party'); if (lp) lp.onclick = () => leaveParty();
}
function openFriends() {
  const row = (p) => {
    const on = online(p), d = on && myPos ? distM(myPos, p) : null;
    return `<div class="item" data-see="${p.id}"><div class="mini">${avatarOf(p)}</div><div class="grow"><b>${esc(p.name)}</b>
      <span class="sub">Lv${p.lvl} · ${on ? '🟢 ' + fmtDist(d) : '⚪ ' + ago(p.seen || 0)}${myParty().includes(p.id) ? ' · 🧑‍🤝‍🧑 in your party' : ''}</span></div><button class="btn">View</button></div>`;
  };
  const all = Object.values(others);
  const friends = all.filter((p) => isFriend(p.id)).sort((a, b) => (b.seen || 0) - (a.seen || 0));
  const nearby = all.filter((p) => !isFriend(p.id) && online(p)).sort((a, b) => distM(myPos, a) - distM(myPos, b));
  const reqs = incoming.filter((r) => r.kind === 'friend' && r.status === 'pending');
  openSheet(`
    ${reqs.length ? `<h2>📨 Friend requests</h2><div class="list">${reqs.map((r) => `
      <div class="item"><div class="mini">${others[r.from] ? avatarOf(others[r.from]) : ''}</div><div class="grow"><b>${esc(r.fromName)}</b><span class="sub">wants to be friends</span></div>
      <button class="btn primary" data-acc="${r.id}">Accept</button><button class="btn" data-dec="${r.id}">✕</button></div>`).join('')}</div>` : ''}
    <h2>🤝 Friends</h2>
    ${friends.length ? `<div class="list">${friends.map(row).join('')}</div>` : '<div class="empty">No friends yet. Tap a player on the map and add them.</div>'}
    <h3>📡 Players online</h3>
    ${nearby.length ? `<div class="list">${nearby.map(row).join('')}</div>` : '<div class="empty">Nobody else is online right now. Send your friends the link!</div>'}
    <div class="btns"><button class="btn blue" id="share">🔗 Invite friends</button></div>
  `, 'friends', openFriends);
  sheetBody.querySelectorAll('[data-see]').forEach((b) => (b.onclick = () => { const p = others[b.dataset.see]; if (online(p)) panTo(p); openPlayer(p.id); }));
  sheetBody.querySelectorAll('[data-acc]').forEach((b) => (b.onclick = () => acceptRequest(incoming.find((r) => r.id === b.dataset.acc))));
  sheetBody.querySelectorAll('[data-dec]').forEach((b) => (b.onclick = () => B.update(COL.req, b.dataset.dec, { status: 'declined' })));
  $('#share').onclick = async () => {
    const url = location.origin;
    try { if (navigator.share) await navigator.share({ title: 'Quest', text: 'Play Quest with me: make a character and find treasure around LA!', url }); else { await navigator.clipboard.writeText(url); toast('Link copied!', null, 2000); } } catch {}
  };
}

// ---------- requests ----------
const KIND = { battle: ['⚔️', 'battle'], talk: ['💬', 'talk'], friend: ['🤝', 'be friends'], trade: ['🔁', 'trade'], quest: ['📜', 'join a quest'], party: ['🧑‍🤝‍🧑', 'join their party'] };
async function sendRequest(uid, kind, extra = {}) {
  const p = others[uid]; if (!p) return;
  if (kind === 'battle' && S.hp < 6) return toast('You\'re too hurt to battle. Drink something from your bag first.');
  if (!(kind === 'trade' && sheetKind === 'talk')) closeSheet();
  const id = await B.add(COL.req, { from: ME, fromName: S.name, to: uid, toName: p.name, kind, status: 'pending', created: Date.now(), ...extra });
  if (kind === 'friend') toast(`🤝 Friend request sent to ${esc(p.name)}`, null, 2500);
  const w = kind === 'friend' ? null : toast(`${KIND[kind][0]} Asked <b>${esc(p.name)}</b> to ${KIND[kind][1]}… waiting`, [['Cancel', '', () => B.update(COL.req, id, { status: 'cancelled' })]], 0);
  const timer = kind === 'friend' ? null : setTimeout(() => B.update(COL.req, id, { status: 'expired' }).catch(() => {}), 60000);
  let un = null, done = false;
  un = B.watchDoc(COL.req, id, (r) => {
    if (!r || r.status === 'pending' || done) return;
    done = true; setTimeout(() => un && un(), 0); clearTimeout(timer); w && w.remove();
    if (r.status === 'accepted') {
      if (kind === 'battle') openBattle(r.battleId);
      else if (kind === 'talk') openTalk(uid);
      else if (kind === 'friend') toast(`🤝 ${esc(p.name)} accepted your friend request!`);
      else if (kind === 'party') toast(`🧑‍🤝‍🧑 ${esc(p.name)} joined your party! You fight together until midnight.`);
      else if (kind === 'trade') toast(`🔁 ${esc(p.name)} accepted the trade!`);
    } else if (r.status === 'declined') toast(`${esc(p.name)} said no this time.`);
    else if (r.status === 'expired') toast(`${esc(p.name)} didn't answer.`);
  });
}

let incoming = [];
const reqToasts = {};
function onIncoming(list) {
  incoming = list;
  const pending = list.filter((r) => r.status === 'pending');
  $('#friends-dot').classList.toggle('hidden', !pending.some((r) => r.kind === 'friend'));
  for (const [id, el] of Object.entries(reqToasts)) if (!pending.some((r) => r.id === id)) { el.remove(); delete reqToasts[id]; }
  // A party member just needs to be dropped into the same fight.
  pending.filter((r) => r.kind === 'joinbattle').forEach((r) => {
    B.update(COL.req, r.id, { status: 'accepted' });
    if (!inBattle) openBattle(r.battleId);
  });
  pending.forEach((r) => {
    if (reqToasts[r.id] || r.shown || r.kind === 'joinbattle') return;
    if (r.kind !== 'friend' && Date.now() - r.created > 90000) return;
    if (inBattle && r.kind === 'battle') return;
    const from = esc(r.fromName);
    const msg = r.kind === 'trade'
      ? `🔁 <b>${from}</b> offers ${ITEMS[r.give].ico} ${esc(ITEMS[r.give].name)} for your ${ITEMS[r.want].ico} ${esc(ITEMS[r.want].name)}`
      : r.kind === 'friend' ? `🤝 <b>${from}</b> sent you a friend request`
      : r.kind === 'quest' ? `📜 <b>${from}</b> invited you to the quest "${esc((questById(r.questId) || {}).title || 'a quest')}"`
      : r.kind === 'party' ? `🧑‍🤝‍🧑 <b>${from}</b> asked if you want to join their party.`
      : `${KIND[r.kind][0]} <b>${from}</b> wants to ${KIND[r.kind][1]}!`;
    const yes = r.kind === 'party' ? 'Yes' : 'Accept', no = r.kind === 'party' ? 'No' : 'Decline';
    reqToasts[r.id] = toast(msg, [[yes, 'primary', () => { delete reqToasts[r.id]; acceptRequest(r); }],
      [no, '', () => { delete reqToasts[r.id]; B.update(COL.req, r.id, { status: 'declined' }); }]], 0);
    if (r.kind === 'friend') B.update(COL.req, r.id, { shown: true }).catch(() => {}); // pop up once; it stays in the Friends list
  });
  if (sheetKind === 'friends' && sheetRefresh) sheetRefresh();
}
async function acceptRequest(r) {
  if (!r) return;
  const cur = await B.get(COL.req, r.id);
  if (!cur || cur.status !== 'pending') return toast('That request is no longer active.');
  const opp = others[r.from] || (await B.get(COL.players, r.from));
  if (!opp) return;
  if (r.kind === 'battle') {
    if (S.hp < 6) { B.update(COL.req, r.id, { status: 'declined' }); return toast('You\'re too hurt to battle — heal first.'); }
    const id = await createBattle(r.from, opp);
    await B.update(COL.req, r.id, { status: 'accepted', battleId: id });
    openBattle(id);
  } else if (r.kind === 'talk') {
    await B.update(COL.req, r.id, { status: 'accepted' });
    openTalk(r.from);
  } else if (r.kind === 'friend') {
    await B.batch([
      { col: COL.players, id: ME, patch: { friends: B.union(r.from) } },
      { col: COL.players, id: r.from, patch: { friends: B.union(ME) } },
      { col: COL.req, id: r.id, patch: { status: 'accepted' } },
    ]);
    toast(`🤝 You and ${esc(r.fromName)} are now friends!`);
  } else if (r.kind === 'party') {
    const until = endOfDay();
    await B.batch([
      { col: COL.players, id: ME, patch: { party: { with: [r.from], until } } },
      { col: COL.players, id: r.from, patch: { party: { with: [ME], until } } },
      { col: COL.req, id: r.id, patch: { status: 'accepted' } },
    ]);
    toast(`🧑‍🤝‍🧑 You joined ${esc(r.fromName)}'s party. You fight together until midnight.`, null, 6000);
  } else if (r.kind === 'quest') {
    await B.update(COL.req, r.id, { status: 'accepted' });
    const q = questById(r.questId);
    if (!q) return toast('That quest is gone.');
    startQuest(q);
  } else if (r.kind === 'trade') {
    // r.give = what they give me, r.want = what they get from me
    if (count(r.want) <= 0) { B.update(COL.req, r.id, { status: 'declined' }); return toast(`You don't have a ${esc(ITEMS[r.want].name)} anymore.`); }
    if (count(r.give, opp) <= 0) { B.update(COL.req, r.id, { status: 'declined' }); return toast(`${esc(r.fromName)} doesn't have that item anymore.`); }
    await B.batch([
      { col: COL.players, id: ME, patch: { ['bag.' + r.want]: B.inc(-1), ['bag.' + r.give]: B.inc(1) } },
      { col: COL.players, id: r.from, patch: { ['bag.' + r.give]: B.inc(-1), ['bag.' + r.want]: B.inc(1) } },
      { col: COL.req, id: r.id, patch: { status: 'accepted' } },
    ]);
    chatSay(r.from, `Trade done: ${ITEMS[r.want].ico} ${ITEMS[r.want].name} ↔ ${ITEMS[r.give].ico} ${ITEMS[r.give].name}`, true);
    toast(`🔁 Trade done! You got ${ITEMS[r.give].ico} ${esc(ITEMS[r.give].name)}.`);
  }
}

// ---------- talk / trade ----------
const pairId = (a, b) => [a, b].sort().join('_');
function chatSay(uid, text, sys = false) {
  return B.set(COL.chats, pairId(ME, uid), { users: [ME, uid].sort(), msgs: B.union({ from: sys ? 'sys' : ME, text, t: Date.now() }) }, true);
}
function openTalk(uid) {
  const p = others[uid]; if (!p) return;
  const near = online(p) && distM(myPos, p) <= NEARBY_RADIUS_M;
  openSheet(`
    <div class="row"><div class="mini" style="width:48px;height:48px;border-radius:50%;overflow:hidden;background:#cfe8ff">${avatarOf(p)}</div>
      <div><h2 style="margin:0">${esc(p.name)}</h2><span class="sub">Lv${p.lvl}${isFriend(uid) ? ' · Friend' : ''}</span></div></div>
    <div class="chat" id="chat"><div class="msg sys">Say hi 👋</div></div>
    <div class="chips">
      <button class="chip" id="c-trade">🔁 Trade</button>
      ${isFriend(uid) ? '' : '<button class="chip" id="c-friend">🤝 Add friend</button>'}
      ${near ? '<button class="chip" id="c-battle">⚔️ Battle</button>' : ''}
    </div>
    <div id="trade-box"></div>
    <div class="row" style="margin-top:10px"><input class="text" id="say" placeholder="Say something…" maxlength="300" style="margin:0"><button class="btn blue" id="send" style="flex:none;min-width:0">Send</button></div>
  `, 'talk');
  const chat = $('#chat');
  sheetCleanup = B.watchDoc(COL.chats, pairId(ME, uid), (d) => {
    const msgs = ((d && d.msgs) || []).slice().sort((a, b) => a.t - b.t).slice(-80);
    if (!msgs.length) return;
    chat.innerHTML = msgs.map((m) => `<div class="msg ${m.from === 'sys' ? 'sys' : m.from === ME ? 'me' : 'them'}">${esc(m.text)}</div>`).join('');
    chat.scrollTop = chat.scrollHeight;
  });
  const send = () => { const v = $('#say').value.trim(); if (!v) return; $('#say').value = ''; chatSay(uid, v); };
  $('#send').onclick = send;
  $('#say').onkeydown = (e) => { if (e.key === 'Enter') send(); };
  const f = $('#c-friend'); if (f) f.onclick = () => { f.remove(); sendRequest(uid, 'friend'); };
  const bt = $('#c-battle'); if (bt) bt.onclick = () => sendRequest(uid, 'battle');
  $('#c-trade').onclick = () => {
    const pp = others[uid] || p;
    const mine = Object.keys(S.bag || {}).filter((id) => count(id) > 0 && ITEMS[id]);
    const theirs = Object.keys(pp.bag || {}).filter((id) => count(id, pp) > 0 && ITEMS[id]);
    const opts = (ids, owner) => ids.map((id) => `<option value="${id}">${ITEMS[id].ico} ${esc(ITEMS[id].name)} (×${count(id, owner)})</option>`).join('');
    $('#trade-box').innerHTML = !mine.length || !theirs.length
      ? `<p class="sub" style="margin-top:10px">${!mine.length ? 'Your bag is empty.' : `${esc(pp.name)}'s bag is empty.`}</p>`
      : `<label class="field">You give</label><select class="text" id="t-give">${opts(mine, S)}</select>
         <label class="field">You get</label><select class="text" id="t-get">${opts(theirs, pp)}</select>
         <div class="btns"><button class="btn primary" id="t-send">Propose trade</button></div>`;
    const ts = $('#t-send'); if (ts) ts.onclick = () => {
      const give = $('#t-give').value, want = $('#t-get').value;
      $('#trade-box').innerHTML = '';
      chatSay(uid, `${S.name} offered ${ITEMS[give].ico} ${ITEMS[give].name} for ${ITEMS[want].ico} ${ITEMS[want].name}`, true);
      sendRequest(uid, 'trade', { give, want });
    };
  };
}

// ---------- battle (1-on-1, or a party fighting together) ----------
let inBattle = false, battleId = null, battleUnsub = null, curB = null, shownSeq = 0, animChain = Promise.resolve(), animating = false, waitTimer = null, acting = false;
const bt = { text: $('#bt-text'), menu: $('#bt-menu') };
const alive = (b, u) => b.hp[u] > 0;
const teamOf = (b, u) => b.teams[u];
const foesOf = (b, u) => b.p.filter((x) => teamOf(b, x) !== teamOf(b, u) && alive(b, x));
const matesOf = (b, u) => b.p.filter((x) => x !== u && teamOf(b, x) === teamOf(b, u));
const teamAlive = (b, t) => b.p.some((u) => teamOf(b, u) === t && alive(b, u));

// Everyone in a party fights together. Party lasts until the end of the day.
const partyOf = (p) => (p && p.party && p.party.until > Date.now() ? (p.party.with || []) : []);
const myParty = () => partyOf(S).filter((u) => others[u]);
const endOfDay = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); };

async function createBattle(oppId, opp) {
  // Side 1 = whoever asked for the fight (plus their party). Side 2 = me (plus mine).
  const side1 = [oppId, ...partyOf(opp).filter((u) => u !== ME && others[u] && online(others[u]))].slice(0, 2);
  const side2 = [ME, ...myParty().filter((u) => !side1.includes(u) && online(others[u]))].slice(0, 2);
  const order = [side1[0], side2[0], side1[1], side2[1]].filter(Boolean);
  const dataOf = (u) => (u === ME ? S : others[u] || opp);
  const b = {
    p: order, teams: {}, names: {}, looks: {}, st: {}, hp: {}, def: {},
    status: 'active', created: Date.now(), updated: Date.now(),
    turn: order[0], truce: null, seq: 1, fx: null, result: null, lines: [],
  };
  order.forEach((u) => {
    const d = dataOf(u), st = statsFor(d);
    b.teams[u] = side1.includes(u) ? 1 : 2;
    b.names[u] = d.name; b.st[u] = st;
    b.looks[u] = { look: d.look, equipped: d.equipped, photo: d.photo || null };
    b.hp[u] = Math.max(1, Math.min(d.hp, st.max)); b.def[u] = false;
  });
  const names = (t) => order.filter((u) => b.teams[u] === t).map((u) => b.names[u]).join(' and ');
  b.lines = [`${names(1)} vs ${names(2)}!`, `${b.names[order[0]]} goes first.`];
  const id = await B.add(COL.battles, b);
  // Party members need to know which battle to open.
  order.filter((u) => u !== ME && u !== oppId).forEach((u) =>
    B.add(COL.req, { from: ME, fromName: S.name, to: u, kind: 'joinbattle', battleId: id, status: 'pending', created: Date.now() }));
  return id;
}

function openBattle(id) {
  closeSheet();
  if (battleId && battleId !== id) exitBattle();
  inBattle = true; battleId = id; curB = null; shownSeq = 0; animChain = Promise.resolve();
  bt.text.textContent = 'Loading battle…'; bt.menu.innerHTML = '';
  $('#foes').innerHTML = ''; $('#mine').innerHTML = '';
  $('#battle').classList.remove('hidden'); document.body.classList.add('in-battle');
  battleUnsub = B.watchDoc(COL.battles, id, onBattle);
}
function exitBattle() {
  battleUnsub && battleUnsub(); battleUnsub = null; clearTimeout(waitTimer); localB = null;
  $('#battle').classList.add('hidden'); document.body.classList.remove('in-battle'); inBattle = false; battleId = null; curB = null;
}

function fighterHtml(b, u) {
  return `<div class="fighter" data-uid="${u}">
    <div class="bt-card">
      <div class="bt-nameline"><span>${esc(b.names[u])}</span><span class="bt-lv">Lv${b.st[u].lvl}</span></div>
      <div class="bt-bar"><div></div></div>
      <div class="bt-hpnum"></div>
    </div>
    <div class="bt-spot"><div class="platform"></div><div class="bt-sprite">${portrait(b.looks[u])}</div></div>
  </div>`;
}
function buildFighters(b) {
  const mine = [ME, ...matesOf(b, ME)], foes = foesOf(b, ME).concat(b.p.filter((u) => teamOf(b, u) !== teamOf(b, ME) && !alive(b, u)));
  $('#mine').innerHTML = mine.map((u) => fighterHtml(b, u)).join('');
  $('#foes').innerHTML = [...new Set(foes)].map((u) => fighterHtml(b, u)).join('');
  const mySprite = document.querySelector(`#mine [data-uid="${ME}"] .bt-sprite`);
  if (mySprite && !b.looks[ME].photo && mySprite.firstElementChild) mySprite.firstElementChild.style.transform = 'scaleX(-1)';
}
function renderBars(b) {
  b.p.forEach((u) => {
    const el = document.querySelector(`.fighter[data-uid="${u}"]`);
    if (!el) return;
    const pct = Math.max(0, b.hp[u] / b.st[u].max * 100);
    const bar = el.querySelector('.bt-bar div');
    bar.style.width = pct + '%'; bar.className = pct < 25 ? 'low' : pct < 50 ? 'mid' : '';
    el.querySelector('.bt-hpnum').textContent = u === ME || matesOf(b, ME).includes(u) ? `${Math.max(0, b.hp[u])}/${b.st[u].max}` : '';
    el.classList.toggle('down', b.hp[u] <= 0);
    el.classList.toggle('turn', b.status === 'active' && b.turn === u);
    if (b.hp[u] <= 0) el.querySelector('.bt-sprite').classList.add('faint');
  });
}
function applyFx(fx) {
  if (!fx) return;
  const el = document.querySelector(`.fighter[data-uid="${fx.t}"] .bt-sprite`);
  if (!el) return;
  const cls = fx.k === 'hit' ? (fx.t === ME ? 'shake' : 'flash') : 'heal';
  el.classList.remove('shake', 'flash', 'heal'); void el.offsetWidth; el.classList.add(cls);
}
function onBattle(b) {
  if (!b) return;
  const first = !curB; curB = b;
  if (first) { buildFighters(b); renderBars(b); }
  if (b.seq !== shownSeq) {
    shownSeq = b.seq;
    const snap = JSON.parse(JSON.stringify(b)), lines = snap.lines || [];
    animChain = animChain.then(async () => {
      animating = true; bt.menu.innerHTML = '';
      for (let i = 0; i < lines.length; i++) {
        await say(lines[i]);
        if (i === 0) { applyFx(snap.fx); renderBars(snap); }
      }
      renderBars(snap);
      animating = false; showMenu();
    });
  } else if (!animating) showMenu();
}
async function say(msg) {
  bt.text.textContent = '';
  for (const ch of msg) { bt.text.textContent += ch; await sleep(16); }
  await sleep(700);
}
function menu(items, wide) {
  bt.menu.className = 'bt-menu' + (wide ? ' wide' : '');
  bt.menu.innerHTML = '';
  items.forEach(([label, fn, cls, disabled]) => {
    const b = document.createElement('button'); b.textContent = label; b.className = cls || 'b-blue'; b.disabled = !!disabled;
    b.onclick = () => { if (acting) return; bt.menu.innerHTML = ''; fn(); }; bt.menu.appendChild(b);
  });
}
function showMenu() {
  const b = curB; if (!b) return;
  clearTimeout(waitTimer);
  if (b.status === 'done') {
    const r = b.result || {};
    const iWon = r.winners && r.winners.includes(ME);
    bt.text.textContent = iWon ? '🏆 You won!' : r.how === 'truce' ? '🤝 Called it a draw.' : r.winners ? 'You lost this one…' : 'The battle is over.';
    if (localB && !localB.handled) {
      localB.handled = true;
      if (iWon) setTimeout(() => finishQuest(localB.questId), 400);
      else setTimeout(() => toast('The boss is still standing. Heal up and try again.', null, 6000), 400);
    }
    return menu([['Back to map', exitBattle, 'b-blue']], true);
  }
  if (!alive(b, ME)) { bt.text.textContent = 'You are down. Your party fights on…'; bt.menu.innerHTML = ''; return; }
  if (b.turn !== ME) {
    bt.text.textContent = `Waiting for ${b.names[b.turn]}…`; bt.menu.innerHTML = '';
    waitTimer = setTimeout(() => menu([['🚪 Leave battle', () => act('leave'), 'b-gray']], true), 45000);
    return;
  }
  if (b.truce && teamOf(b, b.truce) !== teamOf(b, ME)) {
    bt.text.textContent = `${b.names[b.truce]} offers a truce. End the battle?`;
    return menu([['🤝 Accept', () => act('truce-yes'), 'b-green'], ['✊ Refuse', () => act('truce-no'), 'b-red']]);
  }
  bt.text.textContent = `What will ${b.names[ME]} do?`;
  menu([['⚔️ Attack', () => pickTarget('attack'), 'b-red'], ['🛡️ Defend', () => act('defend'), 'b-blue'],
        ['✨ Act', actMenu, 'b-gold'], ['🏃 Run', () => act('run'), 'b-gray']]);
}
// With two enemies you choose who to hit.
function pickTarget(kind) {
  const b = curB, foes = foesOf(b, ME);
  if (foes.length < 2) return act(kind, { target: foes[0] });
  bt.text.textContent = 'Who do you go for?';
  menu([...foes.map((u) => [`${b.names[u]} (${b.hp[u]} HP)`, () => act(kind, { target: u }), 'b-red']), ['↩ Back', showMenu, 'b-gray']], true);
}
function actMenu() {
  const heal = ['bigpotion', 'potion', 'sunscreen'].find((id) => count(id) > 0);
  bt.text.textContent = 'Act how?';
  menu([
    ['🤝 Truce', () => act('truce'), 'b-green'],
    ['💖 Praise', () => pickTarget('praise'), 'b-purple'],
    ['🪙 Pay 30', () => act('pay'), 'b-gold', S.coins < 30],
    [heal ? `${ITEMS[heal].ico} Use item` : '🎒 No items', () => act('item', { item: heal }), 'b-blue', !heal],
    ['↩ Back', showMenu, 'b-gray'],
  ]);
}
async function act(kind, arg) {
  if (!battleId || acting) return;
  if (localB) { acting = true; const r = resolveTurn(localB, kind, arg, ME); acting = false; return r ? applyLocal(r) : showMenu(); }
  acting = true;
  try {
    const ok = await B.tx(COL.battles, battleId, (b) => resolveTurn(b, kind, arg, ME));
    if (!ok) showMenu();
  } catch (e) { console.warn(e); toast('Connection hiccup — try again.'); showMenu(); }
  acting = false;
}
// Runs inside a transaction: returns the battle patch plus any player-doc updates.
function resolveTurn(b, kind, arg, actor) {
  const X = actor || ME;
  if (!b || b.status !== 'active') return null;
  if (kind !== 'leave' && b.turn !== X) return null;
  const n = b.names, st = b.st, hp = { ...b.hp }, def = { ...b.def }, lines = [], patch = {};
  const foes = b.p.filter((u) => b.teams[u] !== b.teams[X] && hp[u] > 0);
  const Y = (arg && arg.target && hp[arg.target] > 0) ? arg.target : foes.sort((a, c) => hp[c] - hp[a])[0];
  if (!Y) return null;
  const extra = {}; b.p.forEach((u) => (extra[u] = {}));
  let done = null, fx = null, keepTurn = false;
  switch (kind) {
    case 'attack': {
      let dmg = Math.max(1, st[X].atk + randi(-2, 3) - st[Y].def);
      const crit = Math.random() < 0.12; if (crit) dmg = Math.round(dmg * 1.6);
      const blocked = def[Y]; if (blocked) dmg = Math.max(1, Math.floor(dmg / 2));
      hp[Y] = Math.max(0, hp[Y] - dmg); def[Y] = false;
      lines.push(`${n[X]} attacked ${n[Y]}! (−${dmg} HP)`);
      if (crit) lines.push('A critical hit!');
      if (blocked) lines.push(`${n[Y]}'s guard softened the blow.`);
      fx = { t: Y, k: 'hit' };
      if (hp[Y] <= 0) lines.push(`${n[Y]} fainted!`);
      break;
    }
    case 'defend':
      def[X] = true; hp[X] = Math.min(st[X].max, hp[X] + 2);
      lines.push(`${n[X]} raised their guard! (+2 HP)`); fx = { t: X, k: 'heal' }; break;
    case 'praise': {
      const line = ['Nice outfit!', 'Your gear is sick.', 'You hike fast!', 'Cool hat!'][randi(0, 3)];
      patch[`st.${Y}.atk`] = Math.max(2, st[Y].atk - 1);
      lines.push(`${n[X]}: "${line}"`, `${n[Y]} blushed. Their attack fell!`); break;
    }
    case 'truce': patch.truce = X; lines.push(`${n[X]} offered a truce.`); break;
    case 'truce-yes': done = { how: 'truce' }; lines.push(`${n[X]} accepted the truce. Good fight!`); break;
    case 'truce-no': patch.truce = null; keepTurn = true; lines.push(`${n[X]} refused the truce!`); break;
    case 'pay':
      if (X !== ME || S.coins < 30) return null;
      done = { how: 'paid', winners: b.p.filter((u) => b.teams[u] !== b.teams[X]) };
      extra[X].coins = B.inc(-30); extra[Y].coins = B.inc(30);
      lines.push(`${n[X]} paid ${n[Y]} 30 coins to end the battle.`); break;
    case 'item': {
      const id = arg && arg.item, it = ITEMS[id];
      if (X !== ME || !it || count(id) <= 0) return null;
      hp[X] = Math.min(st[X].max, hp[X] + it.heal); extra[X]['bag.' + id] = B.inc(-1);
      lines.push(`${n[X]} used ${it.name}! (+${it.heal} HP)`); fx = { t: X, k: 'heal' }; break;
    }
    case 'run':
      if (Math.random() < 0.55) { hp[X] = 0; lines.push(`${n[X]} got away safely!`); }
      else lines.push(`${n[X]} tried to run but couldn't get away!`);
      break;
    case 'leave': hp[X] = 0; lines.push(`${n[X]} left the battle.`); break;
    default: return null;
  }
  // A side loses when everyone on it is down.
  const sideUp = (t) => b.p.some((u) => b.teams[u] === t && hp[u] > 0);
  if (!done && (!sideUp(1) || !sideUp(2))) {
    const winTeam = sideUp(1) ? 1 : 2;
    const winners = b.p.filter((u) => b.teams[u] === winTeam), losers = b.p.filter((u) => b.teams[u] !== winTeam);
    const ranAway = kind === 'run' || kind === 'leave';
    done = { how: ranAway ? 'fled' : 'ko', winners, losers };
    if (!ranAway) {
      if (b.ai) {
        const prize = b.prize || 50;
        if (winners.includes(ME)) { lines.push(`You won ${prize} coins!`); extra[ME].coins = B.inc(prize); extra[ME].xp = B.inc(40); extra[ME]['stats.wins'] = B.inc(1); }
        else { const lost = Math.floor(S.coins * 0.25); lines.push(lost ? `You dropped ${lost} coins getting away.` : 'You limped away.'); extra[ME].coins = B.inc(-lost); extra[ME].hp = Math.ceil(st[ME].max / 2); }
      } else {
        // Each loser forfeits 25% of their coins; the winning side splits the pot.
        const coinsOf = (u) => (u === ME ? S.coins : (others[u] || {}).coins || 0);
        let pot = 0;
        losers.forEach((u) => { const pay = Math.floor(coinsOf(u) * 0.25); pot += pay; extra[u].coins = B.inc(-pay); extra[u].hp = Math.ceil(st[u].max / 2); });
        const share = Math.floor(pot / winners.length);
        winners.forEach((u) => { extra[u].coins = B.inc(share); extra[u].xp = B.inc(35); extra[u]['stats.wins'] = B.inc(1); });
        const wName = winners.map((u) => n[u]).join(' and ');
        lines.push(pot ? (winners.length > 1 ? `${wName} split ${pot} coins — ${share} each!` : `${wName} won ${pot} coins!`) : `${wName} wins!`);
      }
    }
  }
  if (done) {
    patch.status = 'done'; patch.result = done;
    b.p.forEach((u) => { if (extra[u].hp === undefined) extra[u].hp = Math.max(1, hp[u]); extra[u]['stats.battles'] = B.inc(1); });
  }
  // Next living fighter in the rotation.
  let turn = X;
  if (!done && !keepTurn) {
    const i = b.p.indexOf(X);
    for (let k = 1; k <= b.p.length; k++) { const u = b.p[(i + k) % b.p.length]; if (hp[u] > 0) { turn = u; break; } }
  }
  Object.assign(patch, { hp, def, lines, fx, seq: b.seq + 1, updated: Date.now(), turn });
  const ops = b.p.filter((u) => u !== AI && Object.keys(extra[u]).length).map((u) => ({ col: COL.players, id: u, patch: extra[u] }));
  return { patch, extra: ops };
}

// ---------- search ----------
function openSearch(query = '') {
  const q = query.trim().toLowerCase();
  const hits = Object.values(others)
    .filter((p) => p.name && (!q || p.name.toLowerCase().includes(q)))
    .sort((a, b) => (online(b) - online(a)) || a.name.localeCompare(b.name))
    .slice(0, 30);
  openSheet(`
    <h2>🔍 Find a player</h2>
    <input class="text" id="q" placeholder="Search by character name…" value="${esc(query)}" autocomplete="off">
    ${hits.length ? `<div class="list">${hits.map((p) => `
      <div class="item" data-see="${p.id}"><div class="mini">${avatarOf(p)}</div><div class="grow"><b>${esc(p.name)}</b>
        <span class="sub">Lv${p.lvl} · ${online(p) ? '🟢 ' + fmtDist(distM(myPos, p)) : '⚪ ' + ago(p.seen || 0)}${isFriend(p.id) ? ' · friend' : ''}</span></div>
      <button class="btn">View</button></div>`).join('')}</div>`
      : `<div class="empty">${q ? 'Nobody by that name yet.' : 'No other players yet. Invite your friends!'}</div>`}
  `, 'search', () => openSearch($('#q') ? $('#q').value : query));
  const input = $('#q');
  input.oninput = () => { const v = input.value; clearTimeout(input._t); input._t = setTimeout(() => { openSearch(v); $('#q').focus(); }, 250); };
  sheetBody.querySelectorAll('[data-see]').forEach((b) => (b.onclick = () => { const p = others[b.dataset.see]; if (online(p)) panTo(p); openPlayer(p.id); }));
}

// ---------- accomplishments ----------
const statOf = (p, k) => ((p && p.stats) || {})[k] || 0;
function openStats() {
  const all = [{ ...S, id: ME }, ...Object.values(others)];
  const board = (k, label, ico) => {
    const top = all.filter((p) => statOf(p, k) > 0).sort((a, b) => statOf(b, k) - statOf(a, k)).slice(0, 5);
    return `<h3>${ico} ${label}</h3>${top.length ? top.map((p, i) => `
      <div class="rank"><span class="pos">${i + 1}</span><span class="mini">${avatarOf(p)}</span>
        <span>${esc(p.name)}${p.id === ME ? ' (you)' : ''}</span><span class="val">${statOf(p, k)}</span></div>`).join('')
      : '<div class="empty">Nobody yet — be the first.</div>'}`;
  };
  const medals = S.medals || [];
  openSheet(`
    <h2>🏅 Accomplishments</h2>
    <div class="row" style="gap:18px;flex-wrap:wrap">
      <div><div class="sub">Battles fought</div><b style="font-size:22px">${statOf(S, 'battles')}</b></div>
      <div><div class="sub">Battles won</div><b style="font-size:22px">${statOf(S, 'wins')}</b></div>
      <div><div class="sub">Treasures found</div><b style="font-size:22px">${statOf(S, 'treasures')}/${TREASURES.length}</b></div>
      <div><div class="sub">Quests finished</div><b style="font-size:22px">${statOf(S, 'quests')}</b></div>
    </div>
    <h3>🎖️ Medals</h3>
    ${medals.length ? `<div>${medals.map((m) => `<span class="medal">${esc(m)}</span>`).join('')}</div>`
      : '<div class="empty">Finish a quest line to earn your first medal.</div>'}
    ${board('wins', 'Most battles won', '⚔️')}
    ${board('treasures', 'Most treasures found', '🧰')}
    ${board('quests', 'Most quests finished', '📜')}
  `, 'stats', openStats);
}

// ---------- quests ----------
let dbQuests = {};
const AI = 'ai';
let localB = null, questMarker = null, questMarkerKey = '';
const allQuests = () => [...BUILTIN_QUESTS, ...Object.values(dbQuests)];
const questById = (id) => allQuests().find((q) => q.id === id);
const activeQuest = () => (S && S.quest ? questById(S.quest.id) : null);
const questStep = (q) => (q && S.quest ? q.steps[S.quest.step] : null);

function renderQuestMarker() {
  const q = activeQuest(), step = questStep(q);
  const key = step ? `${q.id}:${S.quest.step}` : '';
  if (key === questMarkerKey) return;
  questMarkerKey = key;
  if (questMarker) { questMarker.remove(); questMarker = null; }
  $('#quest-dot').classList.toggle('hidden', !step);
  if (!step) return;
  questMarker = marker(`<div class="mk mk-quest">${step.type === 'boss' ? '💀' : '🚩'}<div class="mk-label">${esc(step.name)}</div></div>`,
    step, { onClick: () => openQuests() });
}

function checkQuestStep() {
  const q = activeQuest(), step = questStep(q);
  if (!step || !myPos) return;
  if (distM(myPos, step) > CLAIM_RADIUS_M) return;
  if (nudged.has(questMarkerKey)) return;
  nudged.add(questMarkerKey);
  toast(`📜 You reached <b>${esc(step.name)}</b>`, [['Continue the quest', 'primary', () => doQuestStep()], ['Later', '', null]], 0);
}

function startQuest(q) {
  upd({ quest: { id: q.id, step: 0, items: [] } });
  closeSheet();
  toast(`📜 Quest started: <b>${esc(q.title)}</b>. First stop: ${esc(q.steps[0].name)}.`, null, 7000);
  flyTo(q.steps[0], 15);
}

function doQuestStep() {
  const q = activeQuest(), step = questStep(q);
  if (!q || !step || distM(myPos, step) > CLAIM_RADIUS_M) return;
  if (step.type === 'boss') {
    if (step.requires && !(S.quest.items || []).includes(step.requires)) {
      return toast(`You need the ${esc(step.requires)} first.`);
    }
    if (S.hp < 6) return toast('You are too hurt to fight. Heal up first.');
    return startBossBattle(q, step);
  }
  const patch = { 'quest.step': S.quest.step + 1 };
  if (step.grant) patch['quest.items'] = B.union(step.grant);
  upd(patch);
  openSheet(`
    <h2>${esc(step.name)}</h2>
    <p>${esc(step.text || '')}</p>
    ${step.grant ? `<p><span class="medal">🗝️ ${esc(step.grant)}</span><br><span class="sub">Added to your quest items.</span></p>` : ''}
    <p class="sub">Next: <b>${esc((q.steps[S.quest.step] || {}).name || 'finish the quest')}</b></p>
    <div class="btns"><button class="btn primary" id="ok">Onward</button></div>
  `, 'queststep');
  $('#ok').onclick = () => { closeSheet(); const nx = questStep(q); if (nx) flyTo(nx, 15); };
}

function finishQuest(questId) {
  const q = questById(questId) || activeQuest();
  if (!q) return;
  const r = q.reward || {};
  upd({ quest: null, medals: B.union(r.medal || '🎖️ Quest medal'), coins: B.inc(r.coins || 0), xp: B.inc(r.xp || 0), 'stats.quests': B.inc(1) });
  exitBattle();
  openSheet(`
    <div style="text-align:center">
      <div style="font-size:56px;margin:6px 0">🎖️</div>
      <h2>Quest complete!</h2>
      <p>${esc(q.title)}</p>
      <p><span class="medal">${esc(r.medal || 'Quest medal')}</span></p>
      <p class="sub">+${r.coins || 0} coins · +${r.xp || 0} XP</p>
      <div class="btns"><button class="btn primary" id="ok">Nice</button></div>
    </div>`, 'questdone');
  $('#ok').onclick = closeSheet;
}

function openQuests() {
  const q = activeQuest(), mine = allQuests().filter((x) => x.by === ME);
  const others_ = allQuests().filter((x) => x.by !== ME && (!q || x.id !== q.id));
  const card = (x) => `<div class="item" data-quest="${x.id}"><div class="ico">${x.builtin ? '📜' : '✍️'}</div>
    <div class="grow"><b>${esc(x.title)}</b><span class="sub">${x.steps.length} stops · by ${esc(x.byName || 'someone')}</span></div>
    <span class="lvl">Lv ${x.level}</span></div>`;
  openSheet(`
    <h2>📜 Quests</h2>
    ${q ? `<h3>Active</h3>
      <div class="sub" style="margin-bottom:8px">${esc(q.title)} · <span class="lvl">Lv ${q.level}</span></div>
      ${q.steps.map((st, i) => `<div class="step ${i < S.quest.step ? 'done' : i === S.quest.step ? 'now' : ''}">
        <span class="n">${i < S.quest.step ? '✓' : i + 1}</span>
        <div><b>${st.type === 'boss' ? '💀 ' : ''}${esc(st.name)}</b>
        <span class="sub">${i === S.quest.step ? fmtDist(distM(myPos, st)) + ' away' : esc(st.text || '')}</span></div></div>`).join('')}
      ${(S.quest.items || []).length ? `<p class="sub">Quest items: ${(S.quest.items || []).map((i) => `<span class="medal">🗝️ ${esc(i)}</span>`).join('')}</p>` : ''}
      <div class="btns"><button class="btn primary" id="show">Show next stop</button><button class="btn" id="invite">Invite a friend</button></div>
      <div class="btns"><button class="btn" id="abandon">Abandon quest</button></div>`
    : '<p class="sub">Pick a quest line, walk it in real life, and fight what waits at the end.</p>'}
    <h3>Quest lines</h3>
    <div class="list">${others_.map(card).join('') || '<div class="empty">None yet.</div>'}</div>
    ${mine.length ? `<h3>Written by you</h3><div class="list">${mine.map(card).join('')}</div>` : ''}
    <div class="btns"><button class="btn blue" id="make">✍️ Write a quest</button></div>
  `, 'quests', openQuests);
  sheetBody.querySelectorAll('[data-quest]').forEach((b) => (b.onclick = () => openQuest(questById(b.dataset.quest))));
  $('#make').onclick = openQuestBuilder;
  const sh = $('#show'); if (sh) sh.onclick = () => { closeSheet(); flyTo(questStep(q), 16); };
  const ab = $('#abandon'); if (ab) ab.onclick = () => { upd({ quest: null }); openQuests(); };
  const iv = $('#invite'); if (iv) iv.onclick = () => inviteToQuest(q);
}

function openQuest(q) {
  if (!q) return;
  const active = S.quest && S.quest.id === q.id;
  openSheet(`
    <div class="row"><div style="font-size:40px">${q.builtin ? '📜' : '✍️'}</div>
      <div><h2>${esc(q.title)}</h2><span class="lvl">Lv ${q.level}</span>
      <span class="sub"> · ${q.steps.length} stops · by ${esc(q.byName || 'someone')}</span></div></div>
    <p>${esc(q.blurb || '')}</p>
    ${q.steps.map((st, i) => `<div class="step"><span class="n">${i + 1}</span><div>
      <b>${st.type === 'boss' ? '💀 ' : ''}${esc(st.name)}</b>
      <span class="sub">${fmtDist(distM(myPos, st))} away${st.grant ? ' · gives ' + esc(st.grant) : ''}${st.boss ? ' · boss: ' + esc(st.boss.name) + ' (Lv' + st.boss.lvl + ')' : ''}</span></div></div>`).join('')}
    <p class="sub">Reward: <span class="medal">${esc((q.reward || {}).medal || 'medal')}</span> +${(q.reward || {}).coins || 0} coins</p>
    <div class="btns">
      ${active ? '<button class="btn" id="drop">Abandon</button>' : `<button class="btn primary" id="start">${S.quest ? 'Switch to this quest' : 'Start quest'}</button>`}
      <button class="btn blue" id="invite">Invite a friend</button>
    </div>
    ${!q.builtin && (isAdmin(S) || q.by === ME) ? '<div class="btns"><button class="btn" id="del-quest">🗑️ Delete this quest</button></div>' : ''}
  `, 'quest');
  const dq = $('#del-quest'); if (dq) dq.onclick = async () => {
    if (!confirm(`Delete “${q.title}”?`)) return;
    await B.update(COL.quests, q.id, { deleted: true });
    delete dbQuests[q.id];
    toast('Quest deleted.', null, 2500); openQuests();
  };
  const st = $('#start'); if (st) st.onclick = () => startQuest(q);
  const dr = $('#drop'); if (dr) dr.onclick = () => { upd({ quest: null }); openQuests(); };
  $('#invite').onclick = () => inviteToQuest(q);
}

function inviteToQuest(q) {
  const friends = Object.values(others).filter((p) => isFriend(p.id));
  if (!friends.length) return toast('Add a friend first, then you can invite them.');
  openSheet(`
    <h2>Invite to “${esc(q.title)}”</h2>
    <p class="sub">They get an invite and can run the quest with you.</p>
    <div class="list">${friends.map((p) => `<div class="item"><div class="mini">${avatarOf(p)}</div>
      <div class="grow"><b>${esc(p.name)}</b><span class="sub">${online(p) ? 'online' : 'last seen ' + ago(p.seen || 0)}</span></div>
      <button class="btn primary" data-inv="${p.id}">Invite</button></div>`).join('')}</div>
  `, 'questinvite');
  sheetBody.querySelectorAll('[data-inv]').forEach((b) => (b.onclick = () => { sendRequest(b.dataset.inv, 'quest', { questId: q.id }); }));
}

// ---------- quest builder ----------
let draftSteps = [];
function openQuestBuilder() {
  openSheet(`
    <h2>✍️ Write a quest</h2>
    <p class="sub">You're the Anderune master: pick real places, add a story, and end it with a monster of your own.</p>
    <label class="field">Title</label><input class="text" id="q-title" maxlength="40" placeholder="The Bay Cities Key">
    <label class="field">What's it about?</label><input class="text" id="q-blurb" maxlength="140" placeholder="A courier job across the Westside.">
    <label class="field">Difficulty</label>
    <select class="text" id="q-level">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">Level ${n}${n === 1 ? ' — easy stroll' : n === 5 ? ' — serious hike' : ''}</option>`).join('')}</select>
    <h3>Stops (${draftSteps.length})</h3>
    ${draftSteps.length ? draftSteps.map((st, i) => `<div class="step"><span class="n">${i + 1}</span>
      <div class="grow"><b>${st.type === 'boss' ? '💀 ' : ''}${esc(st.name)}</b>
      <span class="sub">${st.grant ? 'gives ' + esc(st.grant) : st.boss ? esc(st.boss.name) + ' Lv' + st.boss.lvl : esc(st.text || '')}</span></div>
      <button class="btn" data-del="${i}">✕</button></div>`).join('') : '<div class="empty">No stops yet. Add at least two.</div>'}
    <div class="btns"><button class="btn" id="add-go">➕ Add a stop</button><button class="btn" id="add-boss">💀 Add a boss</button></div>
    <label class="field">Medal for finishing</label><input class="text" id="q-medal" maxlength="30" placeholder="🐉 Wyrm of the West">
    <div class="btns"><button class="btn primary" id="q-save">Publish quest</button><button class="btn" id="q-cancel">Cancel</button></div>
  `, 'builder');
  sheetBody.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { draftSteps.splice(+b.dataset.del, 1); openQuestBuilder(); }));
  $('#add-go').onclick = () => addStep('go');
  $('#add-boss').onclick = () => addStep('boss');
  $('#q-cancel').onclick = () => { draftSteps = []; openQuests(); };
  $('#q-save').onclick = saveQuest;
  // keep typed values across re-renders
  ['q-title', 'q-blurb', 'q-medal'].forEach((id) => { if (draft[id]) $('#' + id).value = draft[id]; $('#' + id).oninput = (e) => (draft[id] = e.target.value); });
  if (draft['q-level']) $('#q-level').value = draft['q-level'];
  $('#q-level').onchange = (e) => (draft['q-level'] = e.target.value);
}
const draft = {};

async function addStep(type) {
  const where = await pickPlace(type === 'boss' ? 'Tap the map where the boss waits' : 'Tap the map where this stop is');
  if (!where) return openQuestBuilder();
  openSheet(`
    <h2>${type === 'boss' ? '💀 Boss stop' : '📍 New stop'}</h2>
    <p class="sub">${where.lat.toFixed(5)}, ${where.lng.toFixed(5)}</p>
    <label class="field">Place name</label><input class="text" id="s-name" maxlength="40" placeholder="Bay Cities Italian Deli">
    <label class="field">What happens here?</label><input class="text" id="s-text" maxlength="160" placeholder="Ask for the package under the counter.">
    ${type === 'go'
      ? `<label class="field">Key item they get (optional)</label><input class="text" id="s-grant" maxlength="30" placeholder="Brass Deli Key">`
      : `<label class="field">Monster name</label><input class="text" id="s-boss" maxlength="30" placeholder="The Pantry Wyrm">
         <label class="field">Monster level</label><select class="text" id="s-lvl">${[2, 4, 6, 8, 10, 12, 15].map((n) => `<option value="${n}"${n === 8 ? ' selected' : ''}>Lv ${n}</option>`).join('')}</select>
         <label class="field">Key item needed to unlock it (optional)</label><input class="text" id="s-req" maxlength="30" placeholder="Brass Deli Key">`}
    <div class="btns"><button class="btn primary" id="s-add">Add stop</button><button class="btn" id="s-cancel">Cancel</button></div>
  `, 'stepform');
  $('#s-cancel').onclick = openQuestBuilder;
  $('#s-add').onclick = () => {
    const name = $('#s-name').value.trim();
    if (!name) return toast('Give the place a name.');
    const step = { type, name, lat: where.lat, lng: where.lng, text: $('#s-text').value.trim() };
    if (type === 'go') { const g = $('#s-grant').value.trim(); if (g) step.grant = g; }
    else {
      const lvl = +$('#s-lvl').value, bn = $('#s-boss').value.trim() || 'Nameless Thing';
      step.boss = { name: bn, lvl, hp: 18 + lvl * 3, atk: 3 + Math.round(lvl * 0.8), def: 1 + Math.round(lvl * 0.35) };
      const req = $('#s-req').value.trim(); if (req) step.requires = req;
    }
    draftSteps.push(step);
    openQuestBuilder();
  };
}

// Let the player tap the map to choose a place.
function pickPlace(prompt) {
  return new Promise((resolve) => {
    closeSheet();
    const banner = document.createElement('div');
    banner.id = 'pick-banner';
    banner.innerHTML = `${prompt} · <u id="pick-here">use my spot</u> · <u id="pick-cancel">cancel</u>`;
    document.body.appendChild(banner);
    const done = (v) => { banner.remove(); map.off('click', onClick); resolve(v); };
    const onClick = (e) => done({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    map.on('click', onClick);
    banner.querySelector('#pick-here').onclick = () => done(myPos ? { ...myPos } : null);
    banner.querySelector('#pick-cancel').onclick = () => done(null);
  });
}

async function saveQuest() {
  const title = (draft['q-title'] || '').trim();
  if (!title) return toast('Give your quest a title.');
  if (draftSteps.length < 2) return toast('Add at least two stops.');
  const level = +(draft['q-level'] || 3);
  const q = {
    id: 'q_' + Math.random().toString(36).slice(2, 9),
    title, level, by: ME, byName: S.name,
    blurb: (draft['q-blurb'] || '').trim(),
    steps: draftSteps,
    reward: { medal: (draft['q-medal'] || '').trim() || '🎖️ ' + title, coins: 40 * level, xp: 20 * level },
    created: Date.now(),
  };
  await B.set(COL.quests, q.id, q);
  dbQuests[q.id] = q;
  draftSteps = []; ['q-title', 'q-blurb', 'q-medal'].forEach((k) => delete draft[k]);
  toast(`📜 “${esc(title)}” published! Invite a friend to run it.`, null, 6000);
  openQuest(q);
}

// ---------- boss battle (AI) ----------
function startBossBattle(q, step) {
  const boss = step.boss, sm = statsFor(S);
  closeSheet();
  localB = {
    p: [AI, ME], teams: { [AI]: 1, [ME]: 2 }, ai: true, status: 'active', questId: q.id, prize: Math.round(((q.reward || {}).coins || 60) * 0.3), // the rest comes from finishing the quest
    names: { [AI]: boss.name, [ME]: S.name },
    looks: { [AI]: { monster: boss.name }, [ME]: { look: S.look, equipped: S.equipped, photo: S.photo || null } },
    st: { [AI]: { atk: boss.atk, def: boss.def, max: boss.hp, lvl: boss.lvl }, [ME]: sm },
    hp: { [AI]: boss.hp, [ME]: S.hp }, def: { [AI]: false, [ME]: false },
    turn: ME, truce: null, seq: 1, fx: null, result: null,
    lines: [`${step.text || ''}`.trim() || `${boss.name} blocks your way!`, `${boss.name} attacks!`],
  };
  battleId = 'local'; inBattle = true; curB = null; shownSeq = 0; animChain = Promise.resolve();
  $('#foes').innerHTML = ''; $('#mine').innerHTML = '';
  $('#battle').classList.remove('hidden'); document.body.classList.add('in-battle');
  onBattle(localB);
}
function applyLocal(r) {
  applyPatch(localB, r.patch);
  (r.extra || []).forEach((o) => { if (o.id === ME) upd(o.patch); });
  onBattle(localB);
  if (localB.status === 'active' && localB.turn === AI) setTimeout(aiMove, 300);
}
function aiMove() {
  if (!localB || localB.status !== 'active' || localB.turn !== AI) return;
  if (animating) return setTimeout(aiMove, 400);
  const lowHp = localB.hp[AI] / localB.st[AI].max < 0.3;
  const roll = Math.random();
  const kind = lowHp && roll < 0.35 ? 'defend' : roll < 0.78 ? 'attack' : roll < 0.9 ? 'defend' : 'praise';
  const r = resolveTurn(localB, kind, null, AI);
  if (r) applyLocal(r); else setTimeout(aiMove, 400);
}

// ---------- party ----------
function leaveParty() {
  const mates = myParty();
  const ops = [{ col: COL.players, id: ME, patch: { party: null } }];
  mates.forEach((u) => ops.push({ col: COL.players, id: u, patch: { party: null } }));
  B.batch(ops);
  applyPatch(S, { party: null }); onMyChange();
  toast('Party disbanded.', null, 2500);
  if (sheetKind === 'profile') openProfile(); else closeSheet();
}
