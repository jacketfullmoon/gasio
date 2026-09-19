# Quest

A real-world, location-based LARP game. Your GPS dot is your character. Walk to hard-to-reach spots around LA to open treasure chests, meet other players in person to battle, chat or trade, and shop at real locations.

Plain HTML/CSS/JS — no build step. Map: MapLibre GL with OpenFreeMap's vector basemap (OpenStreetMap data, no API key), the same map the gas app uses. Multiplayer runs on Firebase (Auth + Firestore).

## Accounts

Sign up with a **character name + password + optional password hint**. No email, same as the gas app: the name becomes a hidden fake address (`name@questmap.local`). On the Log In tab, "Forgot password? Show my hint" looks the hint up by name.

## What's in it

- **Character creator** — skin, hair, hair color, outfit, plus gear you find or buy. Your character is your map marker and battle portrait. You can also upload a photo to use as your icon instead; it's cropped square and shrunk to 128px (a few KB) before saving, and everyone playing can see it.
- **Footprint trails** — 👣 emoji follow behind each player along the way they walked, fading out with age. Your icon stays at your current spot.
- **Night map** — the map darkens from 7pm to 6am on the player's own clock.
- **Local testing** — on localhost the app uses a fake in-browser backend so test accounts never touch the real database. Add `?live` to the URL to hit Firebase from localhost.
- **Treasure chests** at 7 real LA spots (Mt. Lee summit, Griffith Observatory, top of Runyon Canyon, end of Santa Monica Pier, Temescal Canyon falls, Parker Mesa Overlook, Echo Mountain). A chest opens only within 60 m. Each gives coins and a wearable item that changes your ATK/DEF.
- **Live players** — everyone signed in shows on the map with their avatar while their location is fresh (10 min). Friends get a green ring.
- **Requests** — ⚔️ battle or 💬 talk (within 500 m), 🤝 friend (any distance). The other person accepts or declines.
- **Battles** — real turn-based PvP between two phones: **Attack / Defend / Act / Run**. Act covers Truce (end it early, both must agree), Praise (lowers their attack), Pay 30 coins, and Use item. Lose and you forfeit 25% of your coins to the winner.
- **Parties** — ask a nearby player to join your party ("Zack asked if you want to join their party"). You stay partied until midnight, and you fight together: a challenge becomes 2-on-1. If the solo player wins they collect 25% from *both* losers (double); if the party wins they split the single loser's 25% evenly.
- **Quests** — walk a story line between real places, pick up key items, and finish with an AI boss fight. Three are built in; players can write their own with the quest builder (tap the map to place each stop, invent a monster, name the medal) and invite friends.
- **Accomplishments** — battles fought, battles won, treasures found, quests finished, medals earned, plus leaderboards.
- **Search** — find any player by character name.
- **Talk** — live chat, item trades (both sides confirm), add friend.
- **Shops** at real places; you must be there in person to buy.

## Home-screen icon

`icons/icon-180.png` is the Apple touch icon (📜 scroll with a 🎮 controller on top, on the app's purple gradient); 192 and 512 versions are listed in `manifest.json` for Android. On iPhone: open the site in Safari → Share → **Add to Home Screen**. It installs as "Anderune" and opens full screen with no browser chrome. To redraw the icons, re-run the Pillow script in the commit history (it renders the real Apple emoji from the system font).

## Admins

`ADMIN_NAMES` in `data.js` lists the character names that count as "Anderune masters" (case-insensitive). They get a badge and can delete any player-written quest.

## Firebase setup (one time)

1. Go to https://console.firebase.google.com/ and create a project (free Spark plan).
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
3. **Build → Firestore Database → Create database** (production mode, any region).
4. In Firestore → **Rules**, paste this and Publish:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Name → hint lookup must work before login
    match /qm_usernames/{name} {
      allow read: if true;
      allow create: if request.auth != null;
    }
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

5. **Project settings → Your apps → Web app (`</>`)** → register an app → copy the `firebaseConfig` values into `FIREBASE_CONFIG` at the top of `backend.js`.
6. Redeploy.

Note: any signed-in player can write any player's data (that's how coins move at the end of a battle). Fine for playing with friends; a public launch would need server-side rules or Cloud Functions.

## Run locally

```bash
npx http-server . -p 5173
```

Without a Firebase config, localhost falls back to a fake in-browser backend so you can test with two tabs (each tab is a separate player). GPS needs https or localhost.

## Deploy

Static site. Import the repo into Vercel with no framework and default settings, or run `npx vercel --prod`.

## Privacy and safety notes for a real launch

- Player locations are visible to everyone signed in while the app is open. A real version needs friends-only visibility, fuzzed positions, block/report, and age gating.
- GPS spoof protection, and rules so chests can't be claimed from a moving car.
- Check treasure spots for trail conditions, closures and heat warnings.
- Partnerships if real store brands are used as shops.
