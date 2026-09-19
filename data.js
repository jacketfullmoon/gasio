// Game data: items, treasure spots and shops. Players come from the database.

// Accounts that act as "Anderune masters" (case-insensitive character names).
const ADMIN_NAMES = ['zack'];

const START = { lat: 34.0155, lng: -118.4945, label: 'Santa Monica' }; // near 3rd St Promenade
const CLAIM_RADIUS_M = 60;   // how close you must be to open a chest
const NEARBY_RADIUS_M = 500; // how close another player must be to battle (friends can chat from anywhere)
const ONLINE_WINDOW_MS = 10 * 60 * 1000; // players seen within this window show on the map

// Every item in the game. slot = where it goes on your avatar (or 'use' for consumables).
const ITEMS = {
  // Treasure-only cosmetics
  crown:       { name: 'Hollywood Crown',     ico: '👑', slot: 'hat',  rarity: 'Legendary', atk: 3, desc: 'From the summit behind the Hollywood Sign.' },
  telescope:   { name: 'Star Goggles',        ico: '🥽', slot: 'face', rarity: 'Epic',      def: 2, desc: 'Found on the Griffith Observatory lawn.' },
  bandana:     { name: 'Trail Bandana',       ico: '🧣', slot: 'neck', rarity: 'Rare',      def: 1, desc: 'Tied to a post at the top of Runyon Canyon.' },
  pirate:      { name: 'Pier Pirate Hat',     ico: '🏴‍☠️', slot: 'hat',  rarity: 'Rare',      atk: 2, desc: 'Washed up at the end of Santa Monica Pier.' },
  flower:      { name: 'Waterfall Lei',       ico: '🌺', slot: 'neck', rarity: 'Rare',      def: 1, desc: 'Left beside the Temescal Canyon falls.' },
  wizard:      { name: 'Ridge Wizard Hat',    ico: '🧙', slot: 'hat',  rarity: 'Epic',      atk: 2, def: 1, desc: 'Guarded at Parker Mesa Overlook.' },
  lantern:     { name: 'Echo Lantern',        ico: '🏮', slot: 'neck', rarity: 'Epic',      atk: 1, def: 2, desc: 'From the ruins on Echo Mountain.' },
  // Shop cosmetics
  shades:      { name: 'Beach Shades',        ico: '🕶️', slot: 'face', rarity: 'Common',    atk: 1, price: 80,  desc: 'Look cool, hit slightly harder.' },
  cap:         { name: 'Dodger-Blue Cap',     ico: '🧢', slot: 'hat',  rarity: 'Common',    def: 1, price: 60,  desc: 'Classic LA headwear.' },
  scarf:       { name: 'Marine Layer Scarf',  ico: '🧶', slot: 'neck', rarity: 'Common',    def: 1, price: 50,  desc: 'For June gloom.' },
  // Consumables
  potion:      { name: 'Electrolyte Drink',   ico: '🧃', slot: 'use',  rarity: 'Common',    heal: 15, price: 25, desc: 'Restores 15 HP.' },
  bigpotion:   { name: 'Açaí Bowl',           ico: '🥣', slot: 'use',  rarity: 'Uncommon',  heal: 40, price: 55, desc: 'Fully restores HP.' },
  sunscreen:   { name: 'SPF 50',              ico: '🧴', slot: 'use',  rarity: 'Common',    heal: 8,  price: 15, desc: 'Restores 8 HP. Protects your skin IRL too.' },
  map:         { name: 'Local Tip Map',       ico: '🗺️', slot: 'use',  rarity: 'Uncommon',  price: 40, desc: 'Reveals a hint about a hidden treasure.' },
};

// Hidden treasure chests at hard-to-reach LA spots.
const TREASURES = [
  { id: 't_lee',     item: 'crown',     name: 'Mt. Lee Summit',            lat: 34.13426, lng: -118.32138, coins: 150, hint: 'Hike behind the Hollywood Sign via Brush Canyon — ~6 mi round trip.' },
  { id: 't_griff',   item: 'telescope', name: 'Griffith Observatory',      lat: 34.11842, lng: -118.30039, coins: 80,  hint: 'Take the Charlie Turner Trail up from the Greek Theatre.' },
  { id: 't_runyon',  item: 'bandana',   name: 'Runyon Canyon Top',         lat: 34.11206, lng: -118.35053, coins: 60,  hint: 'Take the steep east ridge to the bench at the top.' },
  { id: 't_pier',    item: 'pirate',    name: 'End of Santa Monica Pier',  lat: 34.00827, lng: -118.49985, coins: 40,  hint: 'Walk all the way to the end, past the fishermen.' },
  { id: 't_temescal',item: 'flower',    name: 'Temescal Canyon Falls',     lat: 34.06305, lng: -118.53232, coins: 70,  hint: 'Loop trail from Sunset Blvd, ~3 mi with a small waterfall.' },
  { id: 't_parker',  item: 'wizard',    name: 'Parker Mesa Overlook',      lat: 34.05484, lng: -118.55942, coins: 110, hint: 'Long fire road climb from Paseo Miramar with views of the whole bay.' },
  { id: 't_echo',    item: 'lantern',   name: 'Echo Mountain Ruins',       lat: 34.21259, lng: -118.12658, coins: 120, hint: 'Sam Merrill Trail in Altadena — steep switchbacks to old railway ruins.' },
];

// Real-world places that act as in-game shops.
const SHOPS = [
  { id: 's_pharm',  name: 'Promenade Pharmacy',  ico: '🏪', lat: 34.01648, lng: -118.49628, stock: ['potion', 'bigpotion', 'sunscreen'],
    blurb: 'A drugstore on 3rd St Promenade. In the real product, partner stores (think a Rite Aid or CVS) could be sponsored shops.' },
  { id: 's_surf',   name: 'Pier Surf Shack',     ico: '🏄', lat: 34.00960, lng: -118.49700, stock: ['shades', 'cap', 'sunscreen'],
    blurb: 'Beach gear by the Santa Monica Pier.' },
  { id: 's_trail',  name: 'Trailhead Outfitters',ico: '⛺', lat: 34.10390, lng: -118.34900, stock: ['scarf', 'potion', 'map'],
    blurb: 'Stock up before hitting Runyon Canyon.' },
  { id: 's_market', name: 'Main St Market',      ico: '🛒', lat: 34.00200, lng: -118.48660, stock: ['bigpotion', 'map', 'cap'],
    blurb: 'Snacks and supplies on Main Street.' },
];

const AVATAR_OPTIONS = {
  skin: ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e'],
  hair: ['short', 'buzz', 'fade', 'side', 'messy', 'spiky', 'waves', 'curly', 'afro', 'bob', 'long', 'wavy', 'bun', 'pony', 'pigtails', 'braids', 'bald'],
  hairColor: ['#1b1b1b', '#4a2a12', '#8b4513', '#e6b422', '#d9534f', '#6d28d9', '#e5e7eb'],
  shirt: ['#3b82f6', '#ff5a4e', '#2fbf71', '#f59e0b', '#8b5cf6', '#06b6d4', '#1d1d27', '#ec4899'],
  // the circle behind your character
  bg: ['#cfe8ff', '#d7f5e3', '#ffe0cc', '#ece0ff', '#ffd9ec', '#f7edcd', '#a8e6e2', '#ffd6d6', '#dfe3ea', '#2b2450'],
};

// Ready-made quest lines. Players can also write their own (those live in the database).
const BUILTIN_QUESTS = [
  {
    id: 'q_deli', title: 'The Bay Cities Key', level: 3, byName: 'Anderune', builtin: true,
    blurb: 'A courier job across the Westside. Pick up a package in Santa Monica, then open what it unlocks at Century City.',
    steps: [
      { type: 'go', name: 'Third Street Promenade', lat: 34.01600, lng: -118.49620,
        text: 'Meet your contact by the dinosaur topiary fountains. They point you east.' },
      { type: 'go', name: 'Bay Cities Italian Deli', lat: 34.01855, lng: -118.48645, grant: 'Brass Deli Key',
        text: 'Ask for the package held under the counter. You walk out with a heavy brass key.' },
      { type: 'boss', name: 'Eataly, Century City', lat: 34.05830, lng: -118.41770, requires: 'Brass Deli Key',
        text: 'The key opens a cellar door behind the pasta counter. Something down there is awake.',
        boss: { name: 'The Pantry Wyrm', lvl: 8, hp: 44, atk: 8, def: 3 } },
    ],
    reward: { medal: '🐉 Wyrm of the West', coins: 200, xp: 60 },
  },
  {
    id: 'q_pier', title: 'Pier Patrol', level: 1, byName: 'Anderune', builtin: true,
    blurb: 'A short one for new travelers. Walk the bluffs, then deal with whatever is stealing chips on the pier.',
    steps: [
      { type: 'go', name: 'Palisades Park', lat: 34.02160, lng: -118.50480,
        text: 'Watch the sunset line up over the water. A lifeguard tells you about the thefts.' },
      { type: 'go', name: 'Pier Carousel', lat: 34.00970, lng: -118.49700, grant: 'Bag of Boardwalk Chips',
        text: 'You buy bait: one bag of chips, still warm.' },
      { type: 'boss', name: 'End of the Pier', lat: 34.00827, lng: -118.49985, requires: 'Bag of Boardwalk Chips',
        text: 'You hold the bag out over the railing. The flock goes quiet, and their king lands.',
        boss: { name: 'The Seagull King', lvl: 4, hp: 26, atk: 5, def: 1 } },
    ],
    reward: { medal: '🪶 Crown of Feathers', coins: 80, xp: 35 },
  },
  {
    id: 'q_summit', title: 'Sign of the Hills', level: 5, byName: 'Anderune', builtin: true,
    blurb: 'A long climb for experienced travelers. Bring water — this one is a real hike.',
    steps: [
      { type: 'go', name: 'Griffith Observatory', lat: 34.11842, lng: -118.30039, grant: 'Star Chart Fragment',
        text: 'A docent slips you half a star chart and points north toward the ridge.' },
      { type: 'go', name: 'Brush Canyon Trailhead', lat: 34.13190, lng: -118.31470,
        text: 'The fire road starts here. It is longer than it looks.' },
      { type: 'boss', name: 'Mt. Lee Summit', lat: 34.13426, lng: -118.32138, requires: 'Star Chart Fragment',
        text: 'Behind the letters, the chart fragment glows. Something built from old transmitters stands up.',
        boss: { name: 'The Broadcast Giant', lvl: 12, hp: 60, atk: 11, def: 5 } },
    ],
    reward: { medal: '📡 Voice of the Hills', coins: 350, xp: 90 },
  },
];
