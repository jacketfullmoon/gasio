// Character drawing: builds an SVG avatar from a look + equipped gear.
// Hair has a "back" layer (drawn behind the head) and a "front" layer (drawn over it).
const HAIR_STYLES = {
  bald:     { label: 'Bald',       back: () => '', front: () => '' },
  buzz:     { label: 'Buzz',       back: () => '',
    front: (c) => `<path d="M19 27 Q19 15 32 15 Q45 15 45 27 Q39 21 32 21.5 Q25 21 19 27Z" fill="${c}"/>` },
  fade:     { label: 'Fade',       back: () => '',
    front: (c) => `<path d="M19 26 Q19 12 32 12 Q45 12 45 26 Q40 18 32 19 Q24 18 19 26Z" fill="${c}"/>
      <path d="M19 26 Q24 22 32 22 Q40 22 45 26 Q40 24 32 24 Q24 24 19 26Z" fill="${c}" opacity=".45"/>` },
  short:    { label: 'Short',      back: () => '',
    front: (c) => `<path d="M18 27 Q17 12 32 12 Q47 12 46 27 Q40 18 32 19 Q24 18 18 27Z" fill="${c}"/>` },
  side:     { label: 'Side part',  back: () => '',
    front: (c) => `<path d="M18 27 Q17 11 32 11 Q47 11 46 26 Q42 17 26 20 Q21 21 18 27Z" fill="${c}"/>
      <path d="M26 20 Q34 15 44 18 Q36 13 27 15Z" fill="${c}"/>` },
  messy:    { label: 'Messy',      back: () => '',
    front: (c) => `<path d="M17 27 Q16 11 32 11 Q48 11 47 27 Q44 20 40 22 Q37 15 32 19 Q27 14 24 21 Q20 19 17 27Z" fill="${c}"/>` },
  spiky:    { label: 'Spiky',      back: () => '',
    front: (c) => `<path d="M18 27 L15 13 L23 17 L25 7 L30 14 L34 5 L37 14 L42 8 L43 17 L50 13 L46 27 Q32 17 18 27Z" fill="${c}"/>` },
  curly:    { label: 'Curly',      back: () => '',
    front: (c) => [[19, 21], [25, 15], [32, 13], [39, 15], [45, 21]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6.5" fill="${c}"/>`).join('') },
  afro:     { label: 'Afro',       back: (c) => `<circle cx="32" cy="24" r="19" fill="${c}"/>`,
    front: (c) => `<path d="M18 25 Q20 15 32 15 Q44 15 46 25 Q40 19 32 19.5 Q24 19 18 25Z" fill="${c}"/>` },
  waves:    { label: 'Waves',      back: () => '',
    front: (c) => `<path d="M18 26 Q18 12 32 12 Q46 12 46 26 Q40 19 32 20 Q24 19 18 26Z" fill="${c}"/>
      <path d="M21 22 Q26 19 32 21 Q38 19 43 22" stroke="#000" stroke-opacity=".18" stroke-width="1.4" fill="none"/>` },
  bun:      { label: 'Top bun',    back: () => '',
    front: (c) => `<circle cx="32" cy="8" r="6" fill="${c}"/><path d="M18 27 Q17 12 32 12 Q47 12 46 27 Q40 18 32 19 Q24 18 18 27Z" fill="${c}"/>` },
  bob:      { label: 'Bob',        back: (c) => `<path d="M16 30 Q16 11 32 11 Q48 11 48 30 L48 40 L16 40Z" fill="${c}"/>`,
    front: (c) => `<path d="M16 30 Q16 11 32 11 Q48 11 48 30 Q46 22 42 23 Q32 18 22 23 Q18 22 16 30Z" fill="${c}"/>
      <path d="M16 28 L16 41 Q19 37 19 28Z" fill="${c}"/><path d="M48 28 L48 41 Q45 37 45 28Z" fill="${c}"/>` },
  long:     { label: 'Long',       back: (c) => `<path d="M16 30 Q16 9 32 9 Q48 9 48 30 L49 52 L15 52Z" fill="${c}"/>`,
    front: (c) => `<path d="M16 29 Q16 10 32 10 Q48 10 48 29 Q44 19 40 21 Q32 16 24 21 Q20 19 16 29Z" fill="${c}"/>
      <path d="M16 27 L15 50 L21 50 L21 27Z" fill="${c}"/><path d="M48 27 L49 50 L43 50 L43 27Z" fill="${c}"/>` },
  wavy:     { label: 'Long wavy',  back: (c) => `<path d="M16 30 Q16 9 32 9 Q48 9 48 30 Q52 40 47 52 Q32 56 17 52 Q12 40 16 30Z" fill="${c}"/>`,
    front: (c) => `<path d="M16 29 Q16 10 32 10 Q48 10 48 29 Q43 20 38 22 Q32 17 26 22 Q21 20 16 29Z" fill="${c}"/>
      <path d="M16 28 Q12 40 18 51 L23 49 Q19 38 21 28Z" fill="${c}"/><path d="M48 28 Q52 40 46 51 L41 49 Q45 38 43 28Z" fill="${c}"/>` },
  pony:     { label: 'Ponytail',   back: (c) => `<path d="M44 20 Q56 24 54 38 Q52 48 46 50 Q52 40 48 30 Q46 24 42 22Z" fill="${c}"/>`,
    front: (c) => `<path d="M18 27 Q17 11 32 11 Q47 11 46 27 Q42 18 32 19 Q24 18 18 27Z" fill="${c}"/>
      <circle cx="45" cy="21" r="3.4" fill="${c}"/>` },
  pigtails: { label: 'Pigtails',   back: (c) => `<circle cx="14" cy="32" r="7" fill="${c}"/><circle cx="50" cy="32" r="7" fill="${c}"/>`,
    front: (c) => `<path d="M17 28 Q16 11 32 11 Q48 11 47 28 Q42 19 32 20 Q22 19 17 28Z" fill="${c}"/>` },
  braids:   { label: 'Braids',     back: (c) => `<path d="M17 26 L13 50 L20 50 L22 26Z" fill="${c}"/><path d="M47 26 L51 50 L44 50 L42 26Z" fill="${c}"/>`,
    front: (c) => `<path d="M17 28 Q16 10 32 10 Q48 10 47 28 Q42 18 32 19 Q22 18 17 28Z" fill="${c}"/>
      <circle cx="16" cy="36" r="2.4" fill="#fff" opacity=".7"/><circle cx="48" cy="36" r="2.4" fill="#fff" opacity=".7"/>
      <circle cx="15" cy="45" r="2.4" fill="#fff" opacity=".7"/><circle cx="49" cy="45" r="2.4" fill="#fff" opacity=".7"/>` },
};

// opts.hair: 'all' (default), 'none' (no hair), 'back' or 'front' (that hair layer only,
// on a transparent canvas — used for the swipe animation in the character creator).
function avatarSVG(look, eq = {}, opts = {}) {
  const part = opts.hair || 'all';
  const hat = eq.hat, face = eq.face, neck = eq.neck;
  const hc = look.hairColor || '#4a2a12';
  const style = HAIR_STYLES[look.hair] || HAIR_STYLES.short;
  const hats = {
    cap: `<path d="M17 23 Q17 9 32 9 Q47 9 47 23Z" fill="#1e40af"/><path d="M40 21 L56 23 Q50 26 44 25Z" fill="#1e3a8a"/><text x="30" y="21" font-size="8" font-family="Arial" font-weight="900" fill="#fff" text-anchor="middle">LA</text>`,
    crown: `<polygon points="19,21 18,7 25,14 32,5 39,14 46,7 45,21" fill="#f5b82e" stroke="#9a6a00" stroke-width="1.5"/><circle cx="32" cy="15" r="2.2" fill="#ef4444"/><circle cx="24" cy="17" r="1.6" fill="#3b82f6"/><circle cx="40" cy="17" r="1.6" fill="#3b82f6"/>`,
    pirate: `<path d="M9 22 Q32 -2 55 22 Q32 15 9 22Z" fill="#111"/><circle cx="32" cy="12" r="3" fill="#fff"/><path d="M29 16 L35 16" stroke="#fff" stroke-width="1.5"/>`,
    wizard: `<polygon points="19,21 45,21 36,-4" fill="#6d28d9"/><ellipse cx="32" cy="21" rx="17" ry="3.5" fill="#5b21b6"/><text x="34" y="14" font-size="8" text-anchor="middle" fill="#fde047">★</text>`,
  };
  const faces = {
    shades: `<rect x="20" y="25" width="10" height="6" rx="2" fill="#111"/><rect x="34" y="25" width="10" height="6" rx="2" fill="#111"/><path d="M30 27 L34 27" stroke="#111" stroke-width="1.5"/>`,
    telescope: `<path d="M17 28 L47 28" stroke="#78350f" stroke-width="2.5"/><circle cx="26" cy="28" r="5" fill="#7dd3fc" stroke="#92400e" stroke-width="2"/><circle cx="38" cy="28" r="5" fill="#7dd3fc" stroke="#92400e" stroke-width="2"/>`,
  };
  const necks = {
    bandana: `<path d="M21 42 L43 42 L32 53Z" fill="#dc2626"/><circle cx="29" cy="45" r="1" fill="#fff"/><circle cx="35" cy="45" r="1" fill="#fff"/>`,
    scarf: `<rect x="20" y="40" width="24" height="6" rx="3" fill="#a78bfa"/><rect x="36" y="44" width="5" height="11" rx="2" fill="#8b5cf6"/>`,
    flower: [20, 25, 30, 35, 40, 45].map((x, i) => `<circle cx="${x - 1}" cy="${43 + (i % 2) * 2}" r="3" fill="${['#f472b6', '#fbbf24', '#fb7185'][i % 3]}"/>`).join(''),
    lantern: `<path d="M32 42 L32 47" stroke="#444" stroke-width="1.5"/><rect x="27" y="47" width="10" height="11" rx="2" fill="#f59e0b" stroke="#7c2d12" stroke-width="1.5"/><circle cx="32" cy="52.5" r="2.5" fill="#fef08a"/>`,
  };
  // Hats cover the top of the head, so skip the front hair (the back layer still shows).
  const hidesHair = hat === 'cap' || hat === 'pirate' || hat === 'wizard';
  const wrap = (inner) => `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  if (part === 'back') return wrap(style.back(hc));
  if (part === 'front') return wrap(hidesHair ? '' : style.front(hc));
  return wrap(`
    <rect x="0" y="0" width="64" height="64" fill="${look.bg || '#cfe8ff'}"/>
    <path d="M11 64 Q11 43 32 43 Q53 43 53 64Z" fill="${look.shirt || '#3b82f6'}"/>
    <rect x="28" y="37" width="8" height="8" fill="${look.skin || '#f1c27d'}"/>
    ${part === 'all' ? style.back(hc) : ''}
    <circle cx="32" cy="28" r="14" fill="${look.skin || '#f1c27d'}"/>
    ${part === 'all' && !hidesHair ? style.front(hc) : ''}
    <circle cx="27" cy="29" r="2" fill="#1d1d27"/><circle cx="37" cy="29" r="2" fill="#1d1d27"/>
    <circle cx="23" cy="33" r="2" fill="#f87171" opacity=".35"/><circle cx="41" cy="33" r="2" fill="#f87171" opacity=".35"/>
    <path d="M28.5 34.5 Q32 37.5 35.5 34.5" stroke="#1d1d27" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    ${(face && faces[face]) || ''}${(neck && necks[neck]) || ''}${(hat && hats[hat]) || ''}`);
}

const CHEST_SVG = `<svg viewBox="0 0 32 32" width="34" height="34"><rect x="4" y="13" width="24" height="14" rx="2" fill="#a0522d" stroke="#3b1d0e" stroke-width="2"/><path d="M4 14 Q4 5 16 5 Q28 5 28 14Z" fill="#c2692f" stroke="#3b1d0e" stroke-width="2"/><rect x="4" y="13" width="24" height="3" fill="#f5b82e" stroke="#3b1d0e" stroke-width="1"/><rect x="13.5" y="12" width="5" height="8" rx="1" fill="#f5b82e" stroke="#3b1d0e" stroke-width="1.5"/></svg>`;

// Quest bosses are AI monsters, not players — draw one from its name.
function monsterSVG(name) {
  let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  const body = `hsl(${h} 62% 42%)`, dark = `hsl(${h} 62% 28%)`, glow = `hsl(${(h + 40) % 360} 90% 65%)`;
  const horns = `<path d="M18 20 L14 6 L26 16Z" fill="${dark}"/><path d="M46 20 L50 6 L38 16Z" fill="${dark}"/>`;
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="32" cy="42" rx="22" ry="18" fill="${body}"/>
    ${horns}
    <ellipse cx="32" cy="30" rx="19" ry="16" fill="${body}"/>
    <ellipse cx="32" cy="46" rx="13" ry="9" fill="${dark}" opacity=".45"/>
    <circle cx="25" cy="28" r="5" fill="#fff"/><circle cx="39" cy="28" r="5" fill="#fff"/>
    <circle cx="25.5" cy="29" r="2.6" fill="#111"/><circle cx="38.5" cy="29" r="2.6" fill="#111"/>
    <path d="M22 39 Q32 47 42 39 Q38 42 32 42 Q26 42 22 39Z" fill="#2b0a0a"/>
    <path d="M24 39 L26 43 L28 39Z" fill="#fff"/><path d="M36 39 L38 43 L40 39Z" fill="#fff"/>
    <circle cx="14" cy="22" r="2.4" fill="${glow}"/><circle cx="50" cy="22" r="2.4" fill="${glow}"/>
  </svg>`;
}
