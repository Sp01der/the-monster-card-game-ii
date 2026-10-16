import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { GameAction, GameState } from './types'

function must<T extends GameAction['type']>(
  state: GameState,
  type: T,
  pred?: (a: Extract<GameAction, { type: T }>) => boolean,
): Extract<GameAction, { type: T }> {
  const action = listLegalActions(state).find(
    (a) => a.type === type && (!pred || pred(a as Extract<GameAction, { type: T }>)),
  )
  if (!action || action.type !== type) {
    throw new Error(
      `Expected ${type} in ${state.phase}; got ${listLegalActions(state)
        .map((a) => a.type)
        .join(', ')}`,
    )
  }
  return action as Extract<GameAction, { type: T }>
}

describe('hotseat playthrough', () => {
  it('plays opening turns for both players end to end', () => {
    let state = createGame(
      {
        name: 'Alice',
        cardIds: [
          'blob',
          'ice_core',
          'snapatrap',
          'coffee',
          'sword',
          'veyan_archer',
          'health_potion',
        ],
        topMonsterIndex: 0,
      },
      {
        name: 'Bob',
        cardIds: [
          'fire_sprite',
          'ember_tortoise',
          'bomber_beetle',
          'ruby_ring',
          'rally',
          'long_range_archer',
          'falling_anvil',
        ],
        topMonsterIndex: 0,
      },
      { shuffleRandom: () => 0, skipHandoff: false, rng: () => 1 },
    )

    expect(state.awaitingHandoff).toBe(true)
    state = applyAction(state, must(state, 'CONFIRM_HANDOFF'))
    expect(state.awaitingHandoff).toBe(false)
    expect(state.phase).toBe('main')
    expect(state.players[0].hand).toHaveLength(4)
    expect(state.players[0].hand[0].defId).toBe('blob')

    // Alice first turn: already in main — play monster, skip move, attach energy, end
    state = applyAction(state, must(state, 'PLAY_MONSTER'))
    expect(state.players[0].field.some(Boolean)).toBe(true)
    state = applyAction(state, must(state, 'SKIP_MAIN'))
    state = applyAction(state, must(state, 'SKIP_MOVE'))
    state = applyAction(state, must(state, 'ATTACH_ENERGY'))
    state = applyAction(state, must(state, 'END_TURN'))
    expect(state.awaitingHandoff).toBe(true)
    expect(state.activePlayer).toBe(1)

    // Bob first turn starts in main
    state = applyAction(state, must(state, 'CONFIRM_HANDOFF'))
    expect(state.phase).toBe('main')
    state = applyAction(state, must(state, 'PLAY_MONSTER'))
    state = applyAction(state, must(state, 'SKIP_MAIN'))
    state = applyAction(state, must(state, 'SKIP_MOVE'))
    state = applyAction(state, must(state, 'SKIP_ENERGY'))
    state = applyAction(state, must(state, 'END_TURN'))
    expect(state.activePlayer).toBe(0)
    expect(state.players[0].hasFinishedFirstTurn).toBe(true)

    // Alice second turn: energy from last turn is usable; may draw
    state = applyAction(state, must(state, 'CONFIRM_HANDOFF'))
    expect(state.phase).toBe('draw')
    state = applyAction(state, must(state, 'DRAW'))
    expect(state.players[0].hand.length).toBeGreaterThanOrEqual(3)
    expect(state.phase).toBe('main')
    const slot = state.players[0].field.findIndex((m) => m !== null)
    expect(state.players[0].field[slot]!.energy).toBe(1)

    const ability = listLegalActions(state).find((a) => a.type === 'USE_ABILITY')
    expect(ability).toBeTruthy()
    state = applyAction(state, ability!)
    state = applyAction(state, must(state, 'SKIP_MAIN'))
    state = applyAction(state, must(state, 'SKIP_MOVE'))
    state = applyAction(state, must(state, 'SKIP_ENERGY'))
    state = applyAction(state, must(state, 'END_TURN'))

    expect(state.winner).toBeNull()
    expect(state.log.some((e) => e.message.includes('uses'))).toBe(true)
  })
})
