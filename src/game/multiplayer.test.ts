import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { getMonster } from './catalog'
import { getCircleAdjacent } from './damage'
import { checkLosses, nextLivingPlayerId } from './helpers'
import { applyAction } from './reducer'
import { createGame, type DeckSetup } from './setup'
import { normalAttackTargets } from './targeting'
import type { FieldMonster, GameState, PlayerState } from './types'

const TINY: Omit<DeckSetup, 'name'> = {
  cardIds: ['blob', 'orc', 'coffee', 'sword', 'shield'],
  topMonsterIndex: 0,
}

function threePlayerGame(): GameState {
  return createGame(
    [
      { name: 'P1', ...TINY },
      { name: 'P2', ...TINY },
      { name: 'P3', ...TINY },
    ],
    { skipHandoff: true, shuffleRandom: () => 0, rng: () => 1 },
  )
}

function put(player: PlayerState, slot: number, defId: string, extra: Partial<FieldMonster> = {}) {
  const def = getMonster(defId)
  player.field[slot] = {
    instanceId: `${player.id}-${slot}-${defId}`,
    defId,
    hp: def.maxHp,
    maxHp: def.maxHp,
    stance: 'active',
    energy: 0,
    pendingEnergy: 0,
    statuses: [],
    equipment: [],
    ...extra,
  }
}

function ready(state: GameState): GameState {
  state.phase = 'main'
  state.activePlayer = 0
  for (const player of state.players) {
    player.isFirstTurn = false
    player.hasFinishedFirstTurn = true
  }
  state.abilityUsesLeft = 1
  state.actedSlots = []
  state.movedSlots = []
  state.movedThisTurn = false
  state.playedCardThisTurn = false
  state.pending = null
  state.awaitingHandoff = false
  return state
}

describe('multiplayer free-for-all', () => {
  it('creates 3–5 player matches while createGame(deck, deck) stays two-player', () => {
    const duo = createGame(
      { name: 'A', ...TINY },
      { name: 'B', ...TINY },
      { skipHandoff: true },
    )
    expect(duo.players).toHaveLength(2)
    expect(duo.openingMulligan).toBeUndefined()

    const trio = threePlayerGame()
    expect(trio.players).toHaveLength(3)
    expect(trio.players.map((player) => player.id)).toEqual([0, 1, 2])
  })

  function forcePassTurn(state: GameState): GameState {
    state.phase = 'end'
    state.endStepResolved = true
    let next = applyAction(state, { type: 'END_TURN' })
    if (next.awaitingHandoff) next = applyAction(next, { type: 'CONFIRM_HANDOFF' })
    return next
  }

  it('passes the turn clockwise to the next living seat', () => {
    let state = ready(threePlayerGame())
    for (const player of state.players) put(player, 0, 'blob')
    expect(state.activePlayer).toBe(0)
    state = forcePassTurn(state)
    expect(state.activePlayer).toBe(1)
    state = forcePassTurn(state)
    expect(state.activePlayer).toBe(2)
    state = forcePassTurn(state)
    expect(state.activePlayer).toBe(0)
  })

  it('skips eliminated seats and awards the last living player the win', () => {
    const state = ready(threePlayerGame())
    put(state.players[0]!, 0, 'blob')
    put(state.players[1]!, 0, 'blob')
    put(state.players[2]!, 0, 'blob')
    state.players[1]!.points = 0
    checkLosses(state)
    expect(state.players[1]!.eliminated).toBe(true)
    expect(state.winner).toBeNull()
    expect(nextLivingPlayerId(state, 0)).toBe(2)

    state.players[2]!.points = 0
    checkLosses(state)
    expect(state.players[2]!.eliminated).toBe(true)
    expect(state.winner).toBe(0)
  })

  it('lets attacks hit any living opponent, judged per field', () => {
    const state = ready(threePlayerGame())
    put(state.players[0]!, 0, 'blob')
    put(state.players[1]!, 0, 'orc', { stance: 'active' })
    put(state.players[1]!, 1, 'blob', { stance: 'withdrawn' })
    put(state.players[2]!, 0, 'blob', { stance: 'withdrawn' })

    const targets = normalAttackTargets(state, 0)
    const keys = targets.map((target) => `${target.player}:${target.slot}`).sort()
    // P2 has an active monster, so only that one is legal there.
    // P3 has no actives, so withdrawn may be hit.
    expect(keys).toEqual(['1:0', '2:0'])
  })

  it('uses the free-for-all circle for adjacency across neighboring seats', () => {
    const state = ready(threePlayerGame())
    put(state.players[0]!, 0, 'blob')
    put(state.players[0]!, 2, 'orc')
    put(state.players[1]!, 0, 'blob')
    put(state.players[2]!, 1, 'orc')

    const leftEdge = getCircleAdjacent(state, 0, 0)
    expect(leftEdge.some((target) => target.player === 2 && target.slot === 1)).toBe(true)

    const rightEdge = getCircleAdjacent(state, 0, 2)
    expect(rightEdge.some((target) => target.player === 1 && target.slot === 0)).toBe(true)
  })

  it('keeps the classic two-player circle unchanged', () => {
    const state = createGame(
      { name: 'A', ...TINY },
      { name: 'B', ...TINY },
      { skipHandoff: true, shuffleRandom: () => 0, rng: () => 1 },
    )
    ready(state)
    put(state.players[0]!, 0, 'blob')
    put(state.players[0]!, 2, 'orc')
    put(state.players[1]!, 0, 'blob')
    put(state.players[1]!, 3, 'orc')

    const left = getCircleAdjacent(state, 0, 0)
    expect(left.some((target) => target.player === 1 && target.slot === 0)).toBe(true)
    const right = getCircleAdjacent(state, 0, 2)
    expect(right.some((target) => target.player === 1 && target.slot === 3)).toBe(true)
  })

  it('still ends a two-player match immediately when a seat loses', () => {
    const state = createGame(
      { name: 'A', ...TINY },
      { name: 'B', ...TINY },
      { skipHandoff: true, shuffleRandom: () => 0, rng: () => 1 },
    )
    ready(state)
    put(state.players[0]!, 0, 'blob')
    put(state.players[1]!, 0, 'blob')
    state.players[0]!.points = 0
    checkLosses(state)
    expect(state.winner).toBe(1)
    expect(state.players[0]!.eliminated).toBeUndefined()
  })

  it('offers choose-opponent when Trickery has multiple hands to steal from', () => {
    const state = ready(threePlayerGame())
    put(state.players[0]!, 0, 'goblin_magician', { energy: 2 })
    state.players[1]!.hand = [{ instanceId: 'h1', defId: 'coffee' }]
    state.players[2]!.hand = [{ instanceId: 'h2', defId: 'coffee' }]
    const legal = listLegalActions(state)
    const trickery = legal.find(
      (action) => action.type === 'USE_ABILITY' && action.abilityId === 'trickery',
    )
    expect(trickery).toBeDefined()
    let next = applyAction(state, trickery!)
    expect(next.pending?.kind).toBe('chooseOpponent')
    if (next.pending?.kind !== 'chooseOpponent') return
    expect(next.pending.eligible.sort()).toEqual([1, 2])
  })
})
