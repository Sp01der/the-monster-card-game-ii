import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { getMonster, getWeaknesses } from './catalog'
import { computeDamage } from './damage'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { FieldMonster, GameAction, GameState, HandCard, PlayerState } from './types'

function game(rolls: number[] = [1]): GameState {
  let rollIndex = 0
  return createGame(
    {
      name: 'P1',
      cardIds: ['frost_hawk', 'winter_wizard', 'aquatic_lightning', 'blizzard'],
      topMonsterIndex: 0,
    },
    {
      name: 'P2',
      cardIds: ['chill_sprite', 'glacier_golem', 'two_tailed_frost_biter', 'ice_mirror'],
      topMonsterIndex: 0,
    },
    {
      skipHandoff: true,
      shuffleRandom: () => 0,
      rng: () => rolls[rollIndex++] ?? rolls.at(-1) ?? 1,
    },
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

function main(state: GameState): GameState {
  state.phase = 'main'
  state.players[0].isFirstTurn = false
  state.players[0].hasFinishedFirstTurn = true
  state.players[1].isFirstTurn = false
  state.players[1].hasFinishedFirstTurn = true
  state.abilityUsesLeft = 1
  state.actedSlots = []
  state.playedCardThisTurn = false
  return state
}

function action(state: GameState, predicate: (candidate: GameAction) => boolean): GameAction {
  const found = listLegalActions(state).find(predicate)
  if (!found) throw new Error(`Action not found: ${listLegalActions(state).map((a) => a.type)}`)
  return found
}

function card(instanceId: string, defId: string): HandCard {
  return { instanceId, defId }
}

describe('ice card catalog and weaknesses', () => {
  it('defines every requested monster and both multi-weaknesses', () => {
    expect(getMonster('frost_hawk')).toMatchObject({ points: 2, maxHp: 80 })
    expect(getMonster('winter_wizard')).toMatchObject({ points: 2, maxHp: 90 })
    expect(getMonster('two_tailed_frost_biter')).toMatchObject({ points: 3, maxHp: 120 })
    expect(getMonster('aquatic_lightning')).toMatchObject({ points: 2, maxHp: 80 })
    expect(getMonster('chill_sprite')).toMatchObject({ points: 2, maxHp: 90 })
    expect(getMonster('glacier_golem')).toMatchObject({ points: 4, maxHp: 170 })
    expect(getWeaknesses('frost_hawk')).toEqual(['fire', 'electric'])
    expect(getWeaknesses('glacier_golem')).toEqual(['fire', 'blast'])
  })

  it('applies either weakness in the damage pipeline', () => {
    const attacker = {
      instanceId: 'a', defId: 'blob', hp: 50, maxHp: 50, stance: 'active' as const,
      energy: 0, pendingEnergy: 0, statuses: [], equipment: [],
    }
    const hawk = {
      ...attacker, instanceId: 'h', defId: 'frost_hawk', hp: 80, maxHp: 80,
    }
    expect(computeDamage({ base: 20, damageType: 'fire', attacker, defender: hawk })).toBe(30)
    expect(computeDamage({ base: 20, damageType: 'electric', attacker, defender: hawk })).toBe(30)
  })
})

describe('ice monster abilities', () => {
  it('automatically upgrades Icey Beak with its extra required energy', () => {
    let state = main(game())
    put(state.players[0], 0, 'frost_hawk', { energy: 2 })
    put(state.players[1], 0, 'water_lizel')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'icey_beak'),
    )
    expect(state.players[0].field[0]!.energy).toBe(1)
    expect(state.players[1].field[0]!.hp).toBe(50)
  })

  it('Chilling Screech freezes distinct targets based on friendly ice attackers', () => {
    let state = main(game())
    put(state.players[0], 0, 'frost_hawk', { energy: 2 })
    put(state.players[0], 1, 'ice_core')
    put(state.players[1], 0, 'blob')
    put(state.players[1], 1, 'leecher')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'chilling_screech'),
    )
    expect(state.pending).toMatchObject({ kind: 'freezeTargets', remaining: 2 })
    state = applyAction(
      state,
      action(state, (a) => a.type === 'FREEZE_TARGET' && a.target.slot === 0),
    )
    expect(
      listLegalActions(state).some((a) => a.type === 'FREEZE_TARGET' && a.target.slot === 0),
    ).toBe(false)
    state = applyAction(
      state,
      action(state, (a) => a.type === 'FREEZE_TARGET' && a.target.slot === 1),
    )
    expect(state.players[1].field[0]!.statuses).toContainEqual(
      expect.objectContaining({ kind: 'frozen', turns: 2 }),
    )
    expect(state.players[1].field[1]!.statuses).toContainEqual(
      expect.objectContaining({ kind: 'frozen', turns: 2 }),
    )
  })

  it('Chill extends every Frozen monster on both sides', () => {
    let state = main(game())
    put(state.players[0], 0, 'winter_wizard', { energy: 2 })
    put(state.players[0], 1, 'ice_core', {
      statuses: [{ kind: 'frozen', turns: 1, skipNextTick: false }],
    })
    put(state.players[1], 0, 'blob', {
      statuses: [{ kind: 'frozen', turns: 2, skipNextTick: false }],
    })
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'chill'),
    )
    expect(state.players[0].field[1]!.statuses[0].turns).toBe(2)
    expect(state.players[1].field[0]!.statuses[0].turns).toBe(3)
  })

  it('Winter Winds records the opponent’s next skipped energy phase', () => {
    let state = main(game())
    put(state.players[0], 0, 'winter_wizard', { energy: 2 })
    put(state.players[1], 0, 'blob')
    state = applyAction(
      state,
      action(
        state,
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'wizard_winter_winds',
      ),
    )
    expect(state.players[1].skipEnergyPhases).toBe(1)
  })

  it('Frostbite uses current attached energy as its Frozen duration', () => {
    let state = main(game())
    put(state.players[0], 0, 'two_tailed_frost_biter', { energy: 3 })
    put(state.players[1], 0, 'water_lizel')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'frostbite'),
    )
    expect(state.players[1].field[0]!.statuses).toContainEqual(
      expect.objectContaining({ kind: 'frozen', turns: 3 }),
    )
  })

  it('Frozen Sting face six deals 20 ice and Freezes', () => {
    let state = main(game([6]))
    put(state.players[0], 0, 'aquatic_lightning', { energy: 1 })
    put(state.players[1], 0, 'water_lizel')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'frozen_sting'),
    )
    expect(state.players[1].field[0]!.hp).toBe(70)
    expect(state.players[1].field[0]!.statuses.some((status) => status.kind === 'frozen')).toBe(true)
  })

  it('Lightning Needle spends no more than three extra energy', () => {
    let state = main(game())
    put(state.players[0], 0, 'aquatic_lightning', { energy: 5 })
    put(state.players[1], 0, 'leecher')
    state = applyAction(
      state,
      action(
        state,
        (a) =>
          a.type === 'USE_ABILITY' &&
          a.abilityId === 'lightning_needle' &&
          a.extraEnergy === 3,
      ),
    )
    expect(state.players[0].field[0]!.energy).toBe(1)
    expect(state.players[1].field[0]).toBeNull()
  })

  it('Haunting Cry energizes only friendly monsters with at least two ice abilities', () => {
    let state = main(game())
    put(state.players[0], 0, 'aquatic_lightning', { energy: 1 })
    put(state.players[0], 1, 'frost_hawk')
    put(state.players[0], 2, 'ice_core')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'haunting_cry'),
    )
    expect(state.players[0].field.map((monster) => monster?.energy ?? null).slice(0, 3)).toEqual([
      1, 1, 1,
    ])
  })

  it('Frost Breath freezes two targets before the opponent chooses a discard', () => {
    let state = main(game())
    put(state.players[0], 0, 'glacier_golem', { energy: 2 })
    put(state.players[1], 0, 'blob')
    put(state.players[1], 1, 'leecher')
    state.players[1].hand = [card('discard-a', 'shield'), card('discard-b', 'coffee')]
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'frost_breath'),
    )
    state = applyAction(
      state,
      action(state, (a) => a.type === 'FREEZE_TARGET' && a.target.slot === 0),
    )
    state = applyAction(
      state,
      action(state, (a) => a.type === 'FREEZE_TARGET' && a.target.slot === 1),
    )
    expect(state.pending).toEqual({ kind: 'handDiscard', player: 1, remaining: 1 })
    state = applyAction(state, { type: 'DISCARD_FROM_HAND', instanceId: 'discard-b' })
    expect(state.players[1].hand.map((entry) => entry.instanceId)).toEqual(['discard-a'])
    expect(state.players[1].discard.some((entry) => entry.instanceId === 'discard-b')).toBe(true)
  })
})

describe('ice effects', () => {
  it('Blizzard schedules both upcoming energy phases, including the caster’s current turn', () => {
    let state = main(game())
    put(state.players[0], 0, 'frost_hawk')
    put(state.players[1], 0, 'chill_sprite')
    state.players[0].hand = [card('blizzard', 'blizzard')]
    state = applyAction(
      state,
      action(state, (a) => a.type === 'PLAY_EFFECT' && a.handIndex === 0),
    )
    expect(state.players.map((player) => player.skipEnergyPhases)).toEqual([1, 1])
    state = applyAction(state, { type: 'SKIP_MAIN' })
    state = applyAction(state, { type: 'SKIP_MOVE' })
    expect(state.phase).toBe('end')
    expect(state.players.map((player) => player.skipEnergyPhases)).toEqual([0, 1])
  })

  it('Ice Mirror prevents the hit and recalculates it against the attacker', () => {
    let state = main(game())
    put(state.players[0], 0, 'fire_sprite', { energy: 1 })
    put(state.players[1], 0, 'frost_hawk')
    state.players[1].iceMirrorCharges = 1
    state = applyAction(
      state,
      action(
        state,
        (a) =>
          a.type === 'USE_ABILITY' &&
          a.abilityId === 'fire_punch' &&
          a.choice === 'firePunchFull',
      ),
    )
    expect(state.players[1].field[0]!.hp).toBe(80)
    expect(state.players[0].field[0]!.hp).toBe(60)
    expect(state.players[1].iceMirrorCharges).toBe(0)
  })

  it('Ice Mirror also reflects a damaging ability’s status', () => {
    let state = main(game())
    put(state.players[0], 0, 'winter_wizard', { energy: 1 })
    put(state.players[1], 0, 'blob')
    state.players[1].iceMirrorCharges = 1
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'wizard_freeze'),
    )
    expect(state.players[1].field[0]!.statuses.some((status) => status.kind === 'frozen')).toBe(false)
    expect(state.players[0].field[0]!.statuses.some((status) => status.kind === 'frozen')).toBe(true)
  })
})
