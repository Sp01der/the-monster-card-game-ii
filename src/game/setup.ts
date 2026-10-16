import { getCard } from './catalog'
import { defaultRng, makeCard } from './helpers'
import { cardIdsFromCounts, STARTERS } from './starters'
import type { GameState, HandCard, PlayerId, PlayerState } from './types'
import { FIELD_SIZE, STARTING_HAND, STARTING_POINTS } from './types'

export type DeckSetup = {
  name: string
  /** Card def ids in any order; must include at least one monster. */
  cardIds: string[]
  /** Index into cardIds for the monster placed on top before shuffle. */
  topMonsterIndex: number
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    // Map 1-6 die to a Fisher-Yates index — for setup we want a real random.
    // Use a separate float RNG for shuffle when available.
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  void rng
  return a
}

/** Deterministic shuffle for tests. */
export function shuffleWith<T>(arr: T[], random: () => number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const r = random()
    const j = Math.floor(r * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function buildPlayer(
  id: PlayerId,
  setup: DeckSetup,
  state: GameState,
  shuffleFn: <T>(arr: T[]) => T[],
): PlayerState {
  if (setup.cardIds.length < STARTING_HAND) {
    throw new Error(`${setup.name} needs at least ${STARTING_HAND} cards`)
  }
  const topId = setup.cardIds[setup.topMonsterIndex]
  if (!topId || getCard(topId).kind !== 'monster') {
    throw new Error(`${setup.name} must select a monster to put on top`)
  }

  const restIds = setup.cardIds.filter((_, i) => i !== setup.topMonsterIndex)
  const shuffledRest = shuffleFn(restIds)
  const ordered = [topId, ...shuffledRest]

  const cards: HandCard[] = ordered.map((defId) => makeCard(state, defId))
  const hand = cards.slice(0, STARTING_HAND)
  const deck = cards.slice(STARTING_HAND)

  return {
    id,
    name: setup.name,
    points: STARTING_POINTS,
    deck,
    hand,
    discard: [],
    removed: [],
    field: Array.from({ length: FIELD_SIZE }, () => null),
    hasFinishedFirstTurn: false,
    isFirstTurn: true,
    skipEnergyPhases: 0,
    iceMirrorCharges: 0,
    lingeringEnergy: false,
  }
}

export function createGame(
  player0: DeckSetup,
  player1: DeckSetup,
  options?: {
    rng?: () => number
    random?: () => number
    shuffleRandom?: () => number
    /** Skip handoff screen for tests. */
    skipHandoff?: boolean
  },
): GameState {
  const rng = options?.rng ?? defaultRng()
  const shuffleRandom = options?.shuffleRandom ?? Math.random

  const state: GameState = {
    players: null as unknown as [PlayerState, PlayerState],
    activePlayer: 0,
    // First player skips draw and begins in main.
    phase: 'main',
    drewThisTurn: true,
    abilityUsesLeft: 0,
    actedSlots: [],
    movedSlots: [],
    playedCardThisTurn: false,
    movedThisTurn: false,
    attachedEnergyThisTurn: false,
    energyPool: 0,
    blobEnergyPool: 0,
    bannerEnergyPool: 0,
    skipEnergyPhase: false,
    endStepResolved: false,
    pending: null,
    pendingStack: [],
    awaitingHandoff: options?.skipHandoff ? false : true,
    winner: null,
    log: [],
    rng,
    random: options?.random ?? Math.random,
    nextInstanceId: 1,
  }

  const shuffleFn = <T>(arr: T[]) => shuffleWith(arr, shuffleRandom)
  state.players = [
    buildPlayer(0, player0, state, shuffleFn),
    buildPlayer(1, player1, state, shuffleFn),
  ]

  state.log.push({
    message: `Game start. ${state.players[0].name} goes first.`,
  })
  if (state.awaitingHandoff) {
    state.log.push({ message: `Pass the device to ${state.players[0].name}.` })
  }

  void shuffle
  return state
}

/** Ember starter, for quick playtests and older callers. */
export function sampleDeck(name: string): DeckSetup {
  const ember = STARTERS.find((starter) => starter.id === 'ember')
  if (!ember) throw new Error('Missing Ember starter')
  const cardIds = cardIdsFromCounts(ember.counts)
  const topMonsterIndex = cardIds.indexOf(ember.topMonsterId)
  return {
    name,
    cardIds,
    topMonsterIndex: topMonsterIndex >= 0 ? topMonsterIndex : 0,
  }
}
