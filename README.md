# MCG II Playtester

Digital playtester for The Monster Card Game II: hotseat on one device, or solo against a fair computer opponent.

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

1. Each player starts on a themed deck (Ember and Frost). Load Tide, Gloom, Foundry, or Through the Portal w. Wizrobes, or search the catalog and click cards to build your own.
2. Save a deck to reuse it in this browser. Delete only removes a saved deck, not a starter.
3. Choose the monster that starts on top of the deck.
4. For hotseat: start the match, then pass the device at the handoff screen so hands stay hidden.
5. For a computer opponent: check **Play against the computer**, optionally **Computer goes first**, build both decks, then start. Pass-the-device covers are skipped; the computer plays fair (no peeking at your hand, deck order, or upcoming dice).
6. Follow the turn phases: draw → ability/play → withdraw/advance → energy → end.
