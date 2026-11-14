import { useMemo, useState } from 'react'
import {
  ALL_CARD_IDS,
  CATALOG,
  cardMatchesSearchType,
  getCard,
  MAX_PLAYERS,
  MIN_PLAYERS,
  STARTING_HAND,
  type CardSearchType,
  type DeckSetup,
  type PlayerId,
} from '../game'
import {
  DEFAULT_STARTER_IDS,
  starterById,
  type StarterDeck,
  STARTERS,
} from '../game/starters'
import type { CardKind } from '../game/types'
import { CardFace } from './CardFace'
import {
  browserStorage,
  createDeckStore,
  type DeckStore,
  type StoredDeck,
} from './deckStorage'

export type MatchStart = {
  decks: DeckSetup[]
  /** Seats controlled by the computer. Empty for full hotseat. */
  computerPlayers: PlayerId[]
}

type Props = {
  onStart: (match: MatchStart) => void
}

type DeckSource = { kind: 'starter' | 'saved'; id: string } | null

type Draft = {
  name: string
  counts: Record<string, number>
  topMonsterId: string | null
  deckName: string
  source: DeckSource
}

type KindFilter = 'all' | CardKind

const KIND_ORDER: Record<CardKind, number> = {
  monster: 0,
  effect: 1,
  equipment: 2,
  structure: 3,
}

const FILTERS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'monster', label: 'Monsters' },
  { id: 'effect', label: 'Effects' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'structure', label: 'Structures' },
]

const TYPE_FILTERS: { id: CardSearchType; label: string; group: 'Damage' | 'Family' | 'Trait' }[] = [
  { id: 'fire', label: 'Fire', group: 'Damage' },
  { id: 'water', label: 'Water', group: 'Damage' },
  { id: 'ice', label: 'Ice', group: 'Damage' },
  { id: 'poison', label: 'Poison', group: 'Damage' },
  { id: 'electric', label: 'Electric', group: 'Damage' },
  { id: 'light', label: 'Light', group: 'Damage' },
  { id: 'sonic', label: 'Sonic', group: 'Damage' },
  { id: 'blast', label: 'Blast', group: 'Damage' },
  { id: 'shadow', label: 'Shadow', group: 'Damage' },
  { id: 'wind', label: 'Wind', group: 'Damage' },
  { id: 'earth', label: 'Earth', group: 'Damage' },
  { id: 'plant', label: 'Plant', group: 'Family' },
  { id: 'woody', label: 'Woody', group: 'Family' },
  { id: 'stormling', label: 'Stormling', group: 'Family' },
  { id: 'blob', label: 'Blob', group: 'Family' },
  { id: 'dark_charge', label: 'Dark Charge', group: 'Trait' },
  { id: 'gold_affinity', label: 'Gold Affinity', group: 'Trait' },
]

function draftToSetup(draft: Draft): DeckSetup {
  const cardIds: string[] = []
  for (const id of ALL_CARD_IDS) {
    const n = draft.counts[id] ?? 0
    for (let i = 0; i < n; i++) cardIds.push(id)
  }
  const topMonsterIndex = cardIds.findIndex((id) => id === draft.topMonsterId)
  return {
    name: draft.name.trim() || 'Player',
    cardIds,
    topMonsterIndex: topMonsterIndex >= 0 ? topMonsterIndex : 0,
  }
}

function totalCards(draft: Draft): number {
  return Object.values(draft.counts).reduce((sum, n) => sum + n, 0)
}

function compareCards(a: string, b: string): number {
  const left = CATALOG[a]
  const right = CATALOG[b]
  const kind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
  if (kind !== 0) return kind
  return left.name.localeCompare(right.name)
}

function firstMonster(counts: Record<string, number>): string | null {
  return Object.keys(counts).find((id) => getCard(id).kind === 'monster') ?? null
}

function withCount(draft: Draft, id: string, nextCount: number): Draft {
  const counts = { ...draft.counts }
  if (nextCount <= 0) delete counts[id]
  else counts[id] = nextCount

  let topMonsterId = draft.topMonsterId
  if (getCard(id).kind === 'monster') {
    if (nextCount <= 0 && topMonsterId === id) topMonsterId = firstMonster(counts)
    else if (!topMonsterId && nextCount > 0) topMonsterId = id
  }

  return { ...draft, counts, topMonsterId }
}

function fromStarter(starter: StarterDeck, playerName: string): Draft {
  return {
    name: playerName,
    counts: { ...starter.counts },
    topMonsterId: starter.topMonsterId,
    deckName: starter.name,
    source: { kind: 'starter', id: starter.id },
  }
}

function fromSaved(deck: StoredDeck, playerName: string): Draft {
  return {
    name: playerName,
    counts: { ...deck.counts },
    topMonsterId: deck.topMonsterId,
    deckName: deck.name,
    source: { kind: 'saved', id: deck.id },
  }
}

function initialDraft(store: DeckStore, player: number, playerName: string): Draft {
  const starterIndex = player < DEFAULT_STARTER_IDS.length ? player : player % DEFAULT_STARTER_IDS.length
  const fallback = starterById(DEFAULT_STARTER_IDS[starterIndex]!) ?? STARTERS[0]!
  const lastId = player <= 1 ? store.getLastUsed(player as 0 | 1) : null
  if (lastId) {
    const saved = store.list().find((deck) => deck.id === lastId)
    if (saved) return fromSaved(saved, playerName)
    const starter = starterById(lastId)
    if (starter) return fromStarter(starter, playerName)
  }
  return fromStarter(fallback, playerName)
}

function blankComputerFlags(count: number): boolean[] {
  return Array.from({ length: count }, () => false)
}

export function DeckBuilder({ onStart }: Props) {
  const [store] = useState(() => createDeckStore(browserStorage()))
  const [savedDecks, setSavedDecks] = useState<StoredDeck[]>(() => store.list())
  const [playerCount, setPlayerCount] = useState(2)
  const [player, setPlayer] = useState(0)
  const [drafts, setDrafts] = useState<Draft[]>(() => [
    initialDraft(store, 0, 'Player 1'),
    initialDraft(store, 1, 'Player 2'),
  ])
  const [computerFlags, setComputerFlags] = useState<boolean[]>(() => blankComputerFlags(2))
  const [vsComputer, setVsComputer] = useState(false)
  const [computerGoesFirst, setComputerGoesFirst] = useState(false)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [cardType, setCardType] = useState<CardSearchType | 'any'>('any')
  const [loadOpen, setLoadOpen] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const isTwoSeat = playerCount === 2
  const computerSeat: 0 | 1 | null =
    isTwoSeat && vsComputer ? (computerGoesFirst ? 0 : 1) : null

  const draft = drafts[player]!

  const visibleIds = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return ALL_CARD_IDS.filter((id) => {
      const card = CATALOG[id]
      if (card.kind === 'equipment' && card.createdOnly) return false
      if (kind !== 'all' && card.kind !== kind) return false
      if (cardType !== 'any' && !cardMatchesSearchType(id, cardType)) return false
      if (needle && !card.name.toLowerCase().includes(needle)) return false
      return true
    }).sort(compareCards)
  }, [cardType, kind, query])

  const deckIds = useMemo(
    () => Object.keys(draft.counts).filter((id) => (draft.counts[id] ?? 0) > 0).sort(compareCards),
    [draft.counts],
  )

  const error = useMemo(() => {
    for (let index = 0; index < drafts.length; index++) {
      const current = drafts[index]!
      const isComputer =
        (isTwoSeat && computerSeat === index) || (!isTwoSeat && computerFlags[index])
      const label = isComputer
        ? `Computer ${index + 1}`
        : isTwoSeat && vsComputer
          ? 'You'
          : current.name.trim() || `Player ${index + 1}`
      if (!isComputer && !current.name.trim()) return `${label} needs a name.`
      if (totalCards(current) < STARTING_HAND) {
        return `${label} needs at least ${STARTING_HAND} cards.`
      }
      if (!current.topMonsterId || (current.counts[current.topMonsterId] ?? 0) < 1) {
        return `${label} must choose a monster to put on top.`
      }
      if (getCard(current.topMonsterId).kind !== 'monster') {
        return `${label} must choose a monster to put on top.`
      }
    }
    if (!isTwoSeat) {
      const humans = computerFlags.filter((flag) => !flag).length
      if (humans === 0) return 'At least one seat must be a human player.'
    }
    return null
  }, [computerFlags, computerSeat, drafts, isTwoSeat, vsComputer])

  function setSeatCount(count: number) {
    const next = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, count))
    setPlayerCount(next)
    setPlayer((prev) => Math.min(prev, next - 1))
    setDrafts((prev) => {
      const copy = prev.slice(0, next)
      while (copy.length < next) {
        const index = copy.length
        copy.push(initialDraft(store, index, `Player ${index + 1}`))
      }
      return copy
    })
    setComputerFlags((prev) => {
      const copy = prev.slice(0, next)
      while (copy.length < next) copy.push(false)
      return copy
    })
    if (next !== 2) {
      setVsComputer(false)
      setComputerGoesFirst(false)
    }
    setStatus(null)
  }

  function updateDraft(next: Draft | ((current: Draft) => Draft)) {
    setDrafts((prev) => {
      const copy = [...prev]
      copy[player] = typeof next === 'function' ? next(prev[player]!) : next
      return copy
    })
    setStatus(null)
  }

  function remember(index: number, source: DeckSource) {
    if (source && index <= 1) store.setLastUsed(index as 0 | 1, source.id)
  }

  function loadStarter(starter: StarterDeck) {
    updateDraft((current) => ({
      ...fromStarter(starter, current.name),
    }))
    remember(player, { kind: 'starter', id: starter.id })
    setLoadOpen(false)
    setStatus(`Loaded ${starter.name}.`)
  }

  function loadSaved(deck: StoredDeck) {
    updateDraft((current) => fromSaved(deck, current.name))
    remember(player, { kind: 'saved', id: deck.id })
    setLoadOpen(false)
    setStatus(`Loaded ${deck.name}.`)
  }

  function saveDeck() {
    const saved = store.save({
      id: draft.source?.kind === 'saved' ? draft.source.id : undefined,
      name: draft.deckName,
      counts: draft.counts,
      topMonsterId: draft.topMonsterId,
    })
    updateDraft((current) => ({
      ...current,
      deckName: saved.name,
      counts: { ...saved.counts },
      topMonsterId: saved.topMonsterId,
      source: { kind: 'saved', id: saved.id },
    }))
    remember(player, { kind: 'saved', id: saved.id })
    setSavedDecks(store.list())
    setStatus(
      draft.source?.kind === 'saved'
        ? `Updated ${saved.name}. It stays in this browser after you leave.`
        : `Saved ${saved.name}. It stays in this browser after you leave.`,
    )
  }

  function deleteDeck() {
    if (draft.source?.kind !== 'saved') return
    const id = draft.source.id
    if (!window.confirm(`Delete “${draft.deckName.trim() || 'this deck'}”?`)) return
    store.remove(id)
    updateDraft((current) => ({ ...current, source: null }))
    setSavedDecks(store.list())
    setStatus('Deleted saved deck.')
  }

  function clearDeck() {
    updateDraft((current) => ({
      ...current,
      counts: {},
      topMonsterId: null,
      source: null,
      deckName: '',
    }))
  }

  function copyToOther() {
    if (drafts.length < 2) return
    const other = player === 0 ? 1 : 0
    setDrafts((prev) => {
      const copy = [...prev]
      copy[other] = {
        ...prev[other]!,
        counts: { ...draft.counts },
        topMonsterId: draft.topMonsterId,
        deckName: draft.deckName,
        source: null,
      }
      return copy
    })
    setStatus(`Copied to ${drafts[other]!.name.trim() || `Player ${other + 1}`}.`)
  }

  function startMatch() {
    drafts.forEach((current, index) => remember(index, current.source))
    const setups = drafts.map((current, index) => {
      const isComputer =
        (isTwoSeat && computerSeat === index) || (!isTwoSeat && computerFlags[index])
      return draftToSetup({
        ...current,
        name: isComputer
          ? drafts.length === 2
            ? 'Computer'
            : `Computer ${index + 1}`
          : current.name,
      })
    })
    const computerPlayers: PlayerId[] = []
    if (isTwoSeat) {
      if (computerSeat !== null) computerPlayers.push(computerSeat)
    } else {
      computerFlags.forEach((flag, index) => {
        if (flag) computerPlayers.push(index as PlayerId)
      })
    }
    onStart({ decks: setups, computerPlayers })
  }

  const sourceLabel =
    draft.source?.kind === 'saved'
      ? 'Saved deck'
      : draft.source?.kind === 'starter'
        ? 'Starter'
        : 'Custom'

  return (
    <div className="setup-screen">
      <header className="app-hero">
        <h1>The Monster Card Game II</h1>
        <p>
          Build a deck, save it in this browser, pick the top monster, then play hotseat or against
          the computer. Free-for-all supports up to five players.
        </p>
      </header>

      <div className="match-mode">
        <label className="mode-check">
          Players
          <select
            value={playerCount}
            onChange={(e) => setSeatCount(Number(e.target.value))}
            aria-label="Number of players"
          >
            {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i).map(
              (count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ),
            )}
          </select>
        </label>
        {isTwoSeat && (
          <>
            <label className="mode-check">
              <input
                type="checkbox"
                checked={vsComputer}
                onChange={(e) => {
                  const on = e.target.checked
                  setVsComputer(on)
                  if (on) {
                    const seat: 0 | 1 = computerGoesFirst ? 0 : 1
                    setPlayer(seat === 0 ? 1 : 0)
                    setDrafts((prev) => {
                      const copy = [...prev]
                      copy[seat] = { ...copy[seat]!, name: 'Computer' }
                      return copy
                    })
                  }
                }}
              />
              Play against the computer
            </label>
            {vsComputer && (
              <label className="mode-check">
                <input
                  type="checkbox"
                  checked={computerGoesFirst}
                  onChange={(e) => {
                    const first = e.target.checked
                    setComputerGoesFirst(first)
                    setPlayer(first ? 1 : 0)
                    setDrafts((prev) => [
                      {
                        ...prev[0]!,
                        name: first
                          ? 'Computer'
                          : prev[0]!.name === 'Computer'
                            ? 'Player 1'
                            : prev[0]!.name,
                      },
                      {
                        ...prev[1]!,
                        name: first
                          ? prev[1]!.name === 'Computer'
                            ? 'Player 2'
                            : prev[1]!.name
                          : 'Computer',
                      },
                    ])
                  }}
                />
                Computer goes first
              </label>
            )}
          </>
        )}
      </div>

      <div className="player-tabs" role="tablist">
        {drafts.map((seatDraft, index) => {
          const isComputer =
            (isTwoSeat && computerSeat === index) || (!isTwoSeat && computerFlags[index])
          const label = isComputer
            ? isTwoSeat
              ? 'Computer'
              : `Computer ${index + 1}`
            : isTwoSeat && vsComputer
              ? 'You'
              : seatDraft.name.trim() || `Player ${index + 1}`
          return (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={player === index}
              className={player === index ? 'player-tab selected' : 'player-tab'}
              onClick={() => {
                setPlayer(index)
                setLoadOpen(false)
                setStatus(null)
              }}
            >
              <span>{label}</span>
              <span className="muted">{totalCards(seatDraft)} cards</span>
            </button>
          )
        })}
      </div>
      {!isTwoSeat && (
        <label className="mode-check">
          <input
            type="checkbox"
            checked={Boolean(computerFlags[player])}
            onChange={(e) => {
              const on = e.target.checked
              setComputerFlags((prev) => {
                const copy = [...prev]
                copy[player] = on
                return copy
              })
              if (on) {
                updateDraft((current) => ({
                  ...current,
                  name: `Computer ${player + 1}`,
                }))
              } else if (draft.name.startsWith('Computer')) {
                updateDraft((current) => ({
                  ...current,
                  name: `Player ${player + 1}`,
                }))
              }
            }}
          />
          This seat is a computer
        </label>
      )}

      <div className="builder">
        <section className="catalog-panel">
          <div className="catalog-tools">
            <input
              type="search"
              value={query}
              placeholder="Search cards"
              aria-label="Search cards"
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="type-search">
              Type
              <select
                value={cardType}
                onChange={(e) => setCardType(e.target.value as CardSearchType | 'any')}
              >
                <option value="any">Any type</option>
                {(['Damage', 'Family', 'Trait'] as const).map((group) => (
                  <optgroup key={group} label={group}>
                    {TYPE_FILTERS.filter((filter) => filter.group === group).map((filter) => (
                      <option key={filter.id} value={filter.id}>
                        {filter.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className="filter-row">
              {FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={kind === filter.id ? 'chip selected' : 'chip'}
                  onClick={() => setKind(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
          <div className="catalog-grid">
            {visibleIds.map((id) => {
              const card = CATALOG[id]
              const count = draft.counts[id] ?? 0
              return (
                <article key={id} className={`catalog-card-wrap${count > 0 ? ' in-deck' : ''}`}>
                  <button
                    type="button"
                    className={`tcg-card catalog-card kind-${card.kind}`}
                    aria-label={`Add ${card.name}`}
                    onClick={() => updateDraft((current) => withCount(current, id, (current.counts[id] ?? 0) + 1))}
                  >
                    <CardFace defId={id} />
                    {count > 0 && <span className="in-deck-badge">{count}</span>}
                  </button>
                  <div className="count-row">
                    <button
                      type="button"
                      aria-label={`Remove one ${card.name}`}
                      disabled={count === 0}
                      onClick={() => updateDraft((current) => withCount(current, id, (current.counts[id] ?? 0) - 1))}
                    >
                      −
                    </button>
                    <span>{count}</span>
                    <button
                      type="button"
                      aria-label={`Add one ${card.name}`}
                      onClick={() => updateDraft((current) => withCount(current, id, (current.counts[id] ?? 0) + 1))}
                    >
                      +
                    </button>
                  </div>
                </article>
              )
            })}
            {visibleIds.length === 0 && <p className="muted">No cards match that search.</p>}
          </div>
        </section>

        <aside className="deck-panel">
          <header className="deck-header">
            <label>
              Player name
              <input
                value={draft.name}
                onChange={(e) => {
                  const name = e.target.value
                  updateDraft((current) => ({ ...current, name }))
                }}
              />
            </label>
            <p className="muted">
              {totalCards(draft)} cards · {sourceLabel}
            </p>
            <div className="deck-actions">
              <button type="button" className="secondary" onClick={clearDeck}>
                Clear
              </button>
              <button type="button" className="secondary" onClick={copyToOther}>
                Copy to {player === 0 ? 'Player 2' : 'Player 1'}
              </button>
            </div>
          </header>

          <div className="save-row">
            <label>
              Deck name
              <input
                value={draft.deckName}
                placeholder="Name this deck"
                onChange={(e) => {
                  const deckName = e.target.value
                  updateDraft((current) => ({ ...current, deckName }))
                }}
              />
            </label>
            <div className="deck-actions">
              <button type="button" className="primary" disabled={totalCards(draft) === 0} onClick={saveDeck}>
                Save
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setLoadOpen((open) => !open)}
                aria-expanded={loadOpen}
              >
                Load
              </button>
              <button
                type="button"
                className="secondary"
                disabled={draft.source?.kind !== 'saved'}
                onClick={deleteDeck}
              >
                Delete
              </button>
            </div>
            {status && <p className="muted">{status}</p>}
            {loadOpen && (
              <div className="load-panel">
                <h3>Starters</h3>
                {STARTERS.map((starter) => (
                  <button
                    key={starter.id}
                    type="button"
                    className="load-item"
                    onClick={() => loadStarter(starter)}
                  >
                    <strong>{starter.name}</strong>
                    <span className="muted">{starter.blurb}</span>
                  </button>
                ))}
                <h3>Saved</h3>
                {savedDecks.length === 0 ? (
                  <p className="muted">No saved decks yet.</p>
                ) : (
                  savedDecks.map((deck) => (
                    <button
                      key={deck.id}
                      type="button"
                      className="load-item"
                      onClick={() => loadSaved(deck)}
                    >
                      <strong>{deck.name}</strong>
                      <span className="muted">
                        {Object.values(deck.counts).reduce((sum, n) => sum + n, 0)} cards
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="deck-list">
            <h3>Deck</h3>
            {deckIds.length === 0 ? (
              <p className="muted">No cards yet. Click a card to add it.</p>
            ) : (
              deckIds.map((id) => {
                const card = getCard(id)
                const count = draft.counts[id] ?? 0
                const onTop = card.kind === 'monster' && draft.topMonsterId === id
                return (
                  <div key={id} className="deck-row">
                    <div>
                      <span className="deck-card-name">{card.name}</span>
                      <span className="muted deck-card-kind">{card.kind}</span>
                    </div>
                    {card.kind === 'monster' ? (
                      <button
                        type="button"
                        className={onTop ? 'chip selected' : 'chip'}
                        onClick={() => updateDraft((current) => ({ ...current, topMonsterId: id }))}
                      >
                        {onTop ? 'On top' : 'Set on top'}
                      </button>
                    ) : (
                      <span />
                    )}
                    <div className="count-row">
                      <button
                        type="button"
                        aria-label={`Remove one ${card.name}`}
                        onClick={() => updateDraft((current) => withCount(current, id, (current.counts[id] ?? 0) - 1))}
                      >
                        −
                      </button>
                      <span>{count}</span>
                      <button
                        type="button"
                        aria-label={`Add one ${card.name}`}
                        onClick={() => updateDraft((current) => withCount(current, id, (current.counts[id] ?? 0) + 1))}
                      >
                        +
                      </button>
                    </div>
                  </div>
                )
              })
            )}
            {deckIds.length > 0 && !draft.topMonsterId && (
              <p className="muted">Add a monster to put on top of the deck.</p>
            )}
          </div>
        </aside>
      </div>

      <footer className="setup-footer">
        {error && <p className="error">{error}</p>}
        <button type="button" className="primary" disabled={Boolean(error)} onClick={startMatch}>
          Start match
        </button>
      </footer>
    </div>
  )
}
