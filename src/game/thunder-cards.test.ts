import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { getCard, getMonster } from './catalog'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { FieldMonster, GameAction, GameState, PlayerState } from './types'

function game(rng: () => number = () => 1): GameState {
  return createGame(
    { name: 'P1', cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'], topMonsterIndex: 0 },
    { name: 'P2', cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'], topMonsterIndex: 0 },
    { skipHandoff: true, shuffleRandom: () => 0, rng },
  )
}

function put(player: PlayerState, slot: number, defId: string, extra: Partial<FieldMonster> = {}) {
  const printed = getCard(defId)
  const maxHp = extra.maxHp ?? (printed.kind === 'monster' ? printed.maxHp : 50)
  player.field[slot] = {
    instanceId: extra.instanceId ?? `${player.id}-${slot}-${defId}`,
    defId,
    hp: extra.hp ?? maxHp,
    maxHp,
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
  state.openingMulligan = undefined
  state.players[0].isFirstTurn = false
  state.players[1].isFirstTurn = false
  state.players[0].hasFinishedFirstTurn = true
  state.players[1].hasFinishedFirstTurn = true
  state.abilityUsesLeft = 1
  state.actedSlots = []
  state.movedSlots = []
  state.pending = null
  state.playedCardThisTurn = false
  state.awaitingHandoff = false
  state.winner = null
  return state
}

function use(state: GameState, abilityId: string) {
  const found = listLegalActions(state).find(
    (candidate: GameAction) => candidate.type === 'USE_ABILITY' && candidate.abilityId === abilityId,
  )
  if (!found) throw new Error('Action not found')
  return applyAction(state, found)
}

describe('Megetherin Bat and Iron-headed Thunderblaster', () => {
  it('prints the new monsters', () => {
    expect(getCard('megetherin_bat')).toMatchObject({
      points: 3, maxHp: 120, weakness: 'light',
    })
    expect(getCard('iron_headed_thunderblaster')).toMatchObject({
      points: 6, maxHp: 230, defense: 1,
    })
    expect(getMonster('iron_headed_thunderblaster').weakness).toBeUndefined()
  })

  it('deals sonic damage through defense and wind damage normally', () => {
    const wings = main(game())
    put(wings.players[0], 0, 'megetherin_bat', { energy: 1 })
    put(wings.players[1], 0, 'orc')
    expect(use(wings, 'shadowy_wings').players[1].field[0]?.hp).toBe(70)

    const shriek = main(game())
    put(shriek.players[0], 0, 'megetherin_bat', { energy: 4 })
    put(shriek.players[1], 0, 'orc')
    expect(use(shriek, 'killing_shriek').players[1].field[0]?.hp).toBe(10)
  })

  it('always deals Iron Ram damage, and weakens on 4/6', () => {
    const miss = main(game(() => 1))
    put(miss.players[0], 0, 'iron_headed_thunderblaster', { energy: 2 })
    put(miss.players[1], 0, 'orc')
    const missed = use(miss, 'iron_ram')
    expect(missed.players[1].field[0]?.hp).toBe(40)
    expect(missed.players[1].field[0]?.statuses).toEqual([])

    const hit = main(game(() => 6))
    put(hit.players[0], 0, 'iron_headed_thunderblaster', { energy: 2 })
    put(hit.players[1], 0, 'orc')
    const weakened = use(hit, 'iron_ram')
    expect(weakened.players[1].field[0]?.hp).toBe(40)
    expect(weakened.players[1].field[0]?.statuses.find((status) => status.kind === 'weakened')).toMatchObject({
      turns: 1,
    })
  })

  it('reduces Steel Chomp with defense and leaves Lightning Blast reduced too', () => {
    const chomp = main(game())
    put(chomp.players[0], 0, 'iron_headed_thunderblaster', { energy: 1 })
    put(chomp.players[1], 0, 'orc')
    expect(use(chomp, 'steel_chomp').players[1].field[0]?.hp).toBe(50)

    const blast = main(game())
    put(blast.players[0], 0, 'iron_headed_thunderblaster', { energy: 3 })
    put(blast.players[1], 0, 'orc')
    expect(use(blast, 'lightning_blast').players[1].field[0]?.hp).toBe(10)
  })
})
