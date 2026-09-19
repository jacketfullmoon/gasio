/* Data layer. Uses Firebase (Auth + Firestore) when configured.
   On localhost without a config it falls back to a fake in-browser backend so the
   game can be tested with two tabs (each tab = a different signed-in player). */

// ── PASTE YOUR FIREBASE CONFIG HERE ──────────────────────────────────
// Firebase Console → Project settings → Your apps → Web app → SDK setup and configuration
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAkTiVh-E2qCvyZMHXCm2qWopWszFeRwQE',
  authDomain: 'anderune-5e8b5.firebaseapp.com',
  projectId: 'anderune-5e8b5',
  storageBucket: 'anderune-5e8b5.firebasestorage.app',
  messagingSenderId: '984261615581',
  appId: '1:984261615581:web:a1c408636a9dce7452a034',
};
// Usernames become fake emails behind the scenes (same trick as the gas app), so nobody needs a real email.
const EMAIL_DOMAIN = '@questmap.local';

// Apply a patch (supports "a.b" paths and inc/union ops) to a plain object.
function applyPatch(obj, patch) {
  for (const [key, val] of Object.entries(patch)) {
    const parts = key.split('.');
    let o = obj;
    for (const p of parts.slice(0, -1)) { if (typeof o[p] !== 'object' || o[p] === null) o[p] = {}; o = o[p]; }
    const k = parts[parts.length - 1];
    if (val && val.__op === 'inc') o[k] = (o[k] || 0) + val.n;
    else if (val && val.__op === 'union') { const a = Array.isArray(o[k]) ? o[k] : []; val.v.forEach((x) => { if (!a.some((y) => JSON.stringify(y) === JSON.stringify(x))) a.push(x); }); o[k] = a; }
    else o[k] = val === undefined ? null : JSON.parse(JSON.stringify(val));
  }
  return obj;
}

const Backend = (() => {
  const configured = FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY';
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const inc = (n) => ({ __op: 'inc', n });
  const union = (...v) => ({ __op: 'union', v });
  const emailFor = (name) => name.toLowerCase() + EMAIL_DOMAIN;

  // On localhost use the fake backend so test accounts never touch the real database.
  // Add ?live to the URL to talk to Firebase from localhost anyway.
  const wantsLive = new URLSearchParams(location.search).has('live');
  if (local && !wantsLive) return mockBackend();
  if (configured && typeof firebase !== 'undefined') return firebaseBackend();
  return { mode: 'unconfigured', inc, union };

  // ───────────────────────── Firebase ─────────────────────────
  function firebaseBackend() {
    firebase.initializeApp(FIREBASE_CONFIG);
    const auth = firebase.auth(), db = firebase.firestore();
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    const FV = firebase.firestore.FieldValue;
    const conv = (patch) => {
      const out = {};
      for (const [k, v] of Object.entries(patch)) {
        out[k] = v && v.__op === 'inc' ? FV.increment(v.n) : v && v.__op === 'union' ? FV.arrayUnion(...v.v) : v;
      }
      return out;
    };
    const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const ref = (col, id) => db.collection(col).doc(id);
    return {
      mode: 'firebase', inc, union,
      onAuth: (cb) => auth.onAuthStateChanged((u) => cb(u ? u.uid : null)),
      async signUp(name, pass) { return (await auth.createUserWithEmailAndPassword(emailFor(name), pass)).user.uid; },
      async logIn(name, pass) { return (await auth.signInWithEmailAndPassword(emailFor(name), pass)).user.uid; },
      logOut: () => auth.signOut(),
      async get(col, id) { const d = await ref(col, id).get(); return d.exists ? d.data() : null; },
      set: (col, id, data, merge = false) => ref(col, id).set(conv(data), { merge }),
      update: (col, id, patch) => ref(col, id).update(conv(patch)),
      async add(col, data) { return (await db.collection(col).add(conv(data))).id; },
      batch(ops) { const b = db.batch(); ops.forEach((o) => b.update(ref(o.col, o.id), conv(o.patch))); return b.commit(); },
      watchDoc: (col, id, cb) => ref(col, id).onSnapshot((d) => cb(d.exists ? d.data() : null), (e) => console.warn(e)),
      watchWhere: (col, field, val, cb) => db.collection(col).where(field, '==', val).onSnapshot((s) => cb(docs(s)), (e) => console.warn(e)),
      watchAll: (col, cb) => db.collection(col).onSnapshot((s) => cb(docs(s)), (e) => console.warn(e)),
      // fn(data) returns null (abort) or { patch, extra: [{col,id,patch}] }
      tx: (col, id, fn) => db.runTransaction(async (t) => {
        const d = await t.get(ref(col, id));
        const r = fn(d.exists ? d.data() : null);
        if (!r) return false;
        t.update(ref(col, id), conv(r.patch));
        (r.extra || []).forEach((o) => t.update(ref(o.col, o.id), conv(o.patch)));
        return true;
      }),
    };
  }

  // ───────────────────────── Local fake ─────────────────────────
  function mockBackend() {
    const DBK = 'qm_mock_db', AUTHK = 'qm_mock_auth';
    const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } };
    const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
    const listeners = new Set();
    const fire = () => listeners.forEach((l) => l());
    window.addEventListener('storage', (e) => { if (e.key === DBK) fire(); });
    const mutate = (fn) => { const db = read(DBK); fn(db); write(DBK, db); setTimeout(fire, 0); };
    const col = (db, c) => (db[c] = db[c] || {});
    const err = (code) => Object.assign(new Error(code), { code });
    const listen = (compute, cb) => {
      let last;
      const l = () => { const v = compute(read(DBK)); const j = JSON.stringify(v); if (j !== last) { last = j; cb(v); } };
      listeners.add(l); setTimeout(l, 0);
      return () => listeners.delete(l);
    };
    let authCb = () => {};
    const setUid = (uid) => { uid ? sessionStorage.setItem('qm_mock_uid', uid) : sessionStorage.removeItem('qm_mock_uid'); authCb(uid); };
    return {
      mode: 'mock', inc, union,
      onAuth(cb) { authCb = cb; setTimeout(() => cb(sessionStorage.getItem('qm_mock_uid')), 0); },
      async signUp(name, pass) {
        const a = read(AUTHK), e = emailFor(name);
        if (a[e]) throw err('auth/email-already-in-use');
        const uid = 'u' + Math.random().toString(36).slice(2, 10);
        a[e] = { uid, pass }; write(AUTHK, a); setUid(uid); return uid;
      },
      async logIn(name, pass) {
        const a = read(AUTHK)[emailFor(name)];
        if (!a || a.pass !== pass) throw err('auth/invalid-credential');
        setUid(a.uid); return a.uid;
      },
      async logOut() { setUid(null); },
      async get(c, id) { return col(read(DBK), c)[id] || null; },
      async set(c, id, data, merge = false) { mutate((db) => { const cc = col(db, c); cc[id] = applyPatch(merge ? cc[id] || {} : {}, data); }); },
      async update(c, id, patch) { mutate((db) => { const cc = col(db, c); if (!cc[id]) throw err('not-found'); applyPatch(cc[id], patch); }); },
      async add(c, data) { const id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); await this.set(c, id, data); return id; },
      async batch(ops) { mutate((db) => ops.forEach((o) => applyPatch(col(db, o.col)[o.id] = col(db, o.col)[o.id] || {}, o.patch))); },
      watchDoc: (c, id, cb) => listen((db) => col(db, c)[id] || null, cb),
      watchWhere: (c, f, v, cb) => listen((db) => Object.entries(col(db, c)).filter(([, d]) => d[f] === v).map(([id, d]) => ({ id, ...d })), cb),
      watchAll: (c, cb) => listen((db) => Object.entries(col(db, c)).map(([id, d]) => ({ id, ...d })), cb),
      async tx(c, id, fn) {
        let ok = false;
        mutate((db) => {
          const cur = col(db, c)[id]; const r = fn(cur ? JSON.parse(JSON.stringify(cur)) : null);
          if (!r) return; ok = true;
          applyPatch(cur, r.patch);
          (r.extra || []).forEach((o) => applyPatch(col(db, o.col)[o.id] = col(db, o.col)[o.id] || {}, o.patch));
        });
        return ok;
      },
    };
  }
})();
