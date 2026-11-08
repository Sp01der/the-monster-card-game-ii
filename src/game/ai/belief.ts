import { cloneState, makeCard } from '../helpers'
import { shuffleWith, type DeckSetup } from '../setup'
import type { GameState, HandCard, PlayerId, PlayerState } from '../types'
import { isRevealingPending } from './decision'
import { createDieRng, createFloatRng, mixSeed } from './rng'

export type DeckLists = [DeckSetup, DeckSetup]

function countIds(ids: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  return counts
}

function subtractOne(counts: Map<string, number>, defId: string): void {
  const n = counts.get(defId) ?? 0
  if (n <= 1) counts.delete(defId)
  else counts.set(defId, n - 1)
}

/** Cards publicly known to belong to this player (not in hand or deck). */
function consumePublicCards(player: PlayerState, counts: Map<string, number>): void {
  for (const card of player.discard) subtractOne(counts, card.defId)
  for (const card of player.removed) subtractOne(counts, card.defId)
  for (const entry of player.ethereal ?? []) subtractOne(counts, entry.card.defId)
  for (const monster of player.field) {
    if (!monster) continue
    subtractOne(counts, monster.defId)
    for (const equipment of monster.equipment) subtractOne(counts, equipment.defId)
  }
}

function expandCounts(counts: Map<string, number>): string[] {
  const ids: string[] = []
  const keys = [...counts.keys()].sort()
  for (const id of keys) {
    const n = counts.get(id) ?? 0
    for (let i = 0; i < n; i++) ids.push(id)
  }
  return ids
}

function makePool(state: GameState, defIds: string[]): HandCard[] {
  return defIds.map((defId) => makeCard(state, defId))
}

/**
 * Rebuild hidden zones from deck lists and public cards.
 * The viewer's hand stays. Opponent hand+deck are redealt from the unseen multiset.
 * Own deck order is reshuffled. Revealing pendings keep real hidden zones.
 */
export function applyBelief(
  state: GameState,
  viewer: PlayerId,
  decks: DeckLists,
  seed: number,
): GameState {
  const next = cloneState(state)
  const floatRng = createFloatRng(seed)
  const dieRng = createDieRng(mixSeed(seed, 0x41c64e6d))
  next.random = floatRng
  next.rng = dieRng
  // Keep allocId sequences identical across equal public positions.
  next.nextInstanceId = 10_000 + (seed % 10_000)

  if (isRevealingPending(next.pending)) {
    return next
  }

  for (const player of next.players) {
    const setup = decks[player.id]
    const counts = countIds(setup.cardIds)
    consumePublicCards(player, counts)

    if (player.id === viewer) {
      for (const card of player.hand) subtractOne(counts, card.defId)
      const deckIds = expandCounts(counts)
      player.deck = shuffleWith(makePool(next, deckIds), floatRng)
    } else {
      const handSize = player.hand.length
      const poolIds = expandCounts(counts)
      const shuffled = shuffleWith(makePool(next, poolIds), floatRng)
      player.hand = shuffled.slice(0, handSize)
      player.deck = shuffled.slice(handSize)
    }
  }

  return next
}

/** Install private RNG on a clone without reshuffling hidden zones. */
export function withPrivateRng(state: GameState, seed: number): GameState {
  const next = cloneState(state)
  next.random = createFloatRng(seed)
  next.rng = createDieRng(mixSeed(seed, 0x27d4eb2d))
  return next
}
