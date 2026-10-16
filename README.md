# MCG II Playtester

Digital hotseat playtester for The Monster Card Game II.

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://127.0.0.1:5173`).

Saved decks are stored in the browser (local storage). They stay after a reload, after you close the tab, and after you visit other sites, as long as you come back in the same browser. A different browser or computer starts with an empty save list.

## Test

```bash
npm test
```

## Play

1. Each player starts on a themed deck (Ember and Frost). Load Tide or Gloom, or search the catalog and click cards to build your own.
2. Save a deck to reuse it in this browser. Delete only removes a saved deck, not a starter.
3. Choose the monster that starts on top of the deck.
4. Start the match, then pass the device at the handoff screen so hands stay hidden.
5. Follow the turn phases: draw → ability/play → withdraw/advance → energy → end.
