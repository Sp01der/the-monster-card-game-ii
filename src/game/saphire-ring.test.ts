import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { getCard } from './catalog'
import { computeDamage } from './damage'
import { applyStatus } from './helpers'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { FieldMonster, GameAction, GameState, PlayerState } from './types'

const ring = { instanceId: 'saphire', defId: 'saphire_ring', hp: 20, maxHp: 20 }

function game(): GameState {
  return createGame(
    { name: 'P1', cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'], topMonsterIndex: 0 },
    { name: 'P2', cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'], topMonsterIndex: 0 },
    { skipHandoff: true, shuffleRandom: () => 0, rng: () => 6 },
  )
}

function put(player: PlayerState, slot: number, defId: string, extra: Partial<FieldMonster> = {}) {
  player.field[slot] = {
    instanceId: `${player.id}-${slot}-${defId}`,
    defId,
    hp: 50,
    maxHp: 50,
    stance: 'active',
    energy: 0,
    pendingEnergy: 0,
    statuses: [],
    equipment: [],
    ...extra,
  }
}

function main(state: GameState): GameState {
  state.phase = 'main'
  state.activePlayer = 0
  state.players[0].isFirstTurn = false
  state.players[0].hasFinishedFirstTurn = true
  state.players[1].isFirstTurn = false
  state.players[1].hasFinishedFirstTurn = true
  state.abilityUsesLeft = 1
  state.actedSlots = []
  state.movedSlots = []
  state.pending = null
  state.awaitingHandoff = false
  return state
}

function action(state: GameState, predicate: (candidate: GameAction) => boolean): GameAction {
  const found = listLegalActions(state).find(predicate)
  if (!found) throw new Error('Action not found')
  return found
}

describe('Saphire Ring', () => {
  it('is 20 HP equipment', () => {
    expect(getCard('saphire_ring')).toMatchObject({
      kind: 'equipment',
      name: 'Saphire Ring',
      maxHp: 20,
    })
  })

  it('stops negative statuses from landing, ticking, or changing damage', () => {
    const host = {
      instanceId: 'host',
      defId: 'fire_sprite',
      hp: 50,
      maxHp: 50,
      stance: 'active' as const,
      energy: 0,
      pendingEnergy: 0,
      statuses: [{ kind: 'wet' as const, turns: 3, skipNextTick: false }],
      equipment: [ring],
    }
    expect(applyStatus(host, 'poison', 3)).toBe(false)
    expect(host.statuses.map((status) => status.kind)).toEqual(['wet'])
    const plain = { ...host, equipment: [], statuses: [] }
    expect(applyStatus(plain, 'poison', 3)).toBe(true)

    const wetHit = computeDamage({ base: 10, damageType: 'water', attacker: null, defender: host })
    const dry = { ...host, equipment: [] }
    expect(wetHit).toBe(10)
    expect(computeDamage({ base: 10, damageType: 'water', attacker: null, defender: dry })).toBe(20)

    const state = main(game())
    put(state.players[0], 0, 'blob', { energy: 2 })
    put(state.players[1], 0, 'blob', { equipment: [{ ...ring }] })
    const splatted = applyAction(
      state,
      action(
        state,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'splat' &&
          candidate.target?.player === 1,
      ),
    )
    expect(splatted.players[1].field[0]?.statuses).toEqual([])

    const burning = main(game())
    put(burning.players[0], 0, 'blob', {
      hp: 50,
      equipment: [{ ...ring, instanceId: 'saphire-2' }],
      statuses: [{ kind: 'burn', turns: 3, skipNextTick: false }],
    })
    put(burning.players[1], 0, 'blob')
    burning.phase = 'end'
    const ended = applyAction(burning, { type: 'END_TURN' })
    expect(ended.players[0].field[0]?.hp).toBe(50)
    expect(ended.players[0].field[0]?.statuses).toEqual([])
  })

  it('clears negative statuses already on the card when the ring is attached', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', {
      energy: 1,
      statuses: [{ kind: 'goo', turns: 1, skipNextTick: false }],
    })
    put(state.players[1], 0, 'blob')
    state.players[0].hand = [{ instanceId: 'ring-card', defId: 'saphire_ring' }]
    const attached = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'PLAY_EQUIPMENT'),
    )
    expect(attached.players[0].field[0]?.equipment[0]?.defId).toBe('saphire_ring')
    expect(attached.players[0].field[0]?.statuses).toEqual([])
    expect(listLegalActions(attached).some((candidate) => candidate.type === 'USE_ABILITY')).toBe(true)
  })
})
