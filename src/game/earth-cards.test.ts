import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { getCard, getMonster } from './catalog'
import { computeDamage } from './damage'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { FieldMonster, GameAction, GameState, PlayerState } from './types'

function game(): GameState {
  return createGame(
    { name: 'P1', cardIds: ['blob', 'orc', 'coffee', 'sword'], topMonsterIndex: 0 },
    { name: 'P2', cardIds: ['blob', 'orc', 'coffee', 'sword'], topMonsterIndex: 0 },
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

function main(state: GameState, player: 0 | 1 = 0): GameState {
  state.phase = 'main'
  state.activePlayer = player
  state.players[0].isFirstTurn = false
  state.players[0].hasFinishedFirstTurn = true
  state.players[1].isFirstTurn = false
  state.players[1].hasFinishedFirstTurn = true
  state.abilityUsesLeft = 1
  state.actedSlots = []
  state.movedSlots = []
  state.movedThisTurn = false
  state.playedCardThisTurn = false
  state.pending = null
  return state
}

function action(state: GameState, predicate: (candidate: GameAction) => boolean): GameAction {
  const found = listLegalActions(state).find(predicate)
  if (!found) throw new Error(`Action not found among ${listLegalActions(state).map((a) => a.type).join(',')}`)
  return found
}

function monster(state: GameState, player: 0 | 1, slot: number): FieldMonster {
  const found = state.players[player].field[slot]
  if (!found) throw new Error('missing monster')
  return found
}

describe('earth and guardian catalog', () => {
  it('defines the batch', () => {
    expect(getMonster('ancient_monstrosity')).toMatchObject({
      points: 3, maxHp: 110, defense: 2, weaknesses: ['blast', 'ice'],
    })
    expect(getMonster('breaker')).toMatchObject({ points: 2, maxHp: 100, defense: 1, weakness: 'blast' })
    expect(getMonster('hill_troll')).toMatchObject({
      points: 4, maxHp: 160, defense: 1, extremeWeakness: true, weakness: 'light',
    })
    expect(getMonster('molika')).toMatchObject({ points: 2, maxHp: 70 })
    expect(getMonster('lizel_guardian')).toMatchObject({ points: 3, maxHp: 110, defense: 1 })
    expect(getMonster('colossus')).toMatchObject({ points: 4, maxHp: 180, defense: 1, weakness: 'blast' })
    expect(getMonster('colossus').abilities.find((a) => a.id === 'quake')?.cost).toEqual({
      require: 0,
      spend: 2,
    })
    expect(getMonster('wizards_key')).toMatchObject({ points: 2, maxHp: 80, weakness: 'blast' })
    expect(getMonster('yellow_blob').families).toContain('blob')
    expect(getCard('colossus_keystone')).toMatchObject({ createdOnly: true, indestructible: true })
    expect(getMonster('hill_troll').abilities.find((a) => a.id === 'meat_shield')?.free).toBe(true)
    expect(getMonster('wizards_key').abilities.find((a) => a.id === 'open_fourth_floor')?.cost).toEqual({
      require: 1,
      spend: 0,
    })
    expect(getMonster('wizards_key').abilities.find((a) => a.id === 'open_fourth_floor')?.free).toBeUndefined()
    expect(getMonster('wizards_key').abilities.find((a) => a.id === 'magic_door')?.cost).toEqual({
      require: 1,
      spend: 0,
    })
    expect(getMonster('wizards_key').abilities.find((a) => a.id === 'magic_door')?.free).toBe(true)
  })
})

describe('damage modifiers', () => {
  it('halves a weakened attack before weakness and defense', () => {
    const state = game()
    put(state.players[0], 0, 'breaker', { statuses: [{ kind: 'weakened', turns: 1, skipNextTick: false }] })
    put(state.players[1], 0, 'hill_troll')
    const amount = computeDamage({
      base: 40,
      damageType: 'light',
      attacker: monster(state, 0, 0),
      defender: monster(state, 1, 0),
    })
    // 40 halved to 20, extremely weak ×2 = 40, defense 1 → 30
    expect(amount).toBe(30)
  })
})

describe('Ground Shaker', () => {
  it('hits a monster and both circle neighbors', () => {
    const state = main(game())
    put(state.players[0], 0, 'breaker', { energy: 2 })
    put(state.players[1], 0, 'blob')
    put(state.players[1], 1, 'blob')
    put(state.players[1], 2, 'blob')
    const next = applyAction(
      state,
      action(
        state,
        (a) =>
          a.type === 'USE_ABILITY' &&
          a.abilityId === 'ground_shaker' &&
          a.target?.kind === 'monster' &&
          a.target.slot === 1,
      ),
    )
    expect(monster(next, 1, 0).hp).toBe(30)
    expect(monster(next, 1, 1).hp).toBe(30)
    expect(monster(next, 1, 2).hp).toBe(30)
  })

  it('is illegal unless the center has two neighbors', () => {
    const state = main(game())
    put(state.players[0], 0, 'breaker', { energy: 2 })
    put(state.players[1], 0, 'blob')
    expect(
      listLegalActions(state).some((a) => a.type === 'USE_ABILITY' && a.abilityId === 'ground_shaker'),
    ).toBe(false)
  })
})

describe('protection', () => {
  it('blocks damaging attacks, allows goo, and ends when the protector withdraws', () => {
    const state = main(game())
    put(state.players[0], 0, 'hill_troll', { energy: 2 })
    put(state.players[0], 1, 'orc')
    put(state.players[1], 0, 'blob', { energy: 2 })
    let next = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'meat_shield'),
    )
    expect(monster(next, 0, 1).protectedByInstanceId).toBe(monster(next, 0, 0).instanceId)
    expect(next.abilityUsesLeft).toBe(1)

    next = main(next, 1)
    expect(
      listLegalActions(next).some(
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'wakkle' && a.target?.slot === 1,
      ),
    ).toBe(false)
    expect(
      listLegalActions(next).some(
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'splat' && a.target?.slot === 1,
      ),
    ).toBe(true)
    next = applyAction(
      next,
      action(
        next,
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'splat' && a.target?.slot === 1,
      ),
    )
    expect(monster(next, 0, 1).statuses.some((s) => s.kind === 'goo')).toBe(true)

    next = main(next, 0)
    next.phase = 'move'
    next = applyAction(next, { type: 'WITHDRAW', slot: 0 })
    expect(monster(next, 0, 1).protectedByInstanceId).toBeUndefined()
    expect(monster(next, 0, 0).stance).toBe('withdrawn')
  })
})

describe('Goo', () => {
  it('prevents the gooed card from using abilities', () => {
    const state = main(game())
    put(state.players[0], 0, 'breaker', {
      energy: 3,
      statuses: [{ kind: 'goo', turns: 1, skipNextTick: false }],
    })
    expect(listLegalActions(state).some((a) => a.type === 'USE_ABILITY')).toBe(false)
    expect(listLegalActions(state).some((a) => a.type === 'UNGOO')).toBe(true)
  })
})

describe('Colossus Keystone', () => {
  it('blocks energy until three hand cards are destroyed to create it', () => {
    const state = main(game())
    put(state.players[0], 0, 'colossus')
    state.players[0].hand = [
      { instanceId: 'h1', defId: 'blob' },
      { instanceId: 'h2', defId: 'orc' },
      { instanceId: 'h3', defId: 'coffee' },
    ]
    state.phase = 'energy'
    state.energyPool = 1
    state.blobEnergyPool = 0
    expect(listLegalActions(state).some((a) => a.type === 'ATTACH_ENERGY')).toBe(false)

    state.phase = 'main'
    let next = applyAction(state, { type: 'BEGIN_KEYSTONE' })
    next = applyAction(next, { type: 'KEYSTONE_TOGGLE', instanceId: 'h1' })
    next = applyAction(next, { type: 'KEYSTONE_TOGGLE', instanceId: 'h2' })
    next = applyAction(next, { type: 'KEYSTONE_TOGGLE', instanceId: 'h3' })
    next = applyAction(next, { type: 'KEYSTONE_ATTACH', slot: 0 })
    expect(monster(next, 0, 0).equipment.map((eq) => eq.defId)).toEqual(['colossus_keystone'])
    expect(next.players[0].hand).toHaveLength(0)
    expect(next.players[0].removed).toHaveLength(3)
    expect(next.playedCardThisTurn).toBe(false)

    next.phase = 'move'
    next = applyAction(next, { type: 'SKIP_MOVE' })
    expect(monster(next, 0, 0).energy).toBe(1)
    expect(listLegalActions(next).some((a) => a.type === 'ATTACH_ENERGY' && a.slot === 0)).toBe(true)
  })
})

describe('Smash', () => {
  it('is reduced by defense', () => {
    const state = main(game())
    put(state.players[0], 0, 'colossus', {
      energy: 3,
      equipment: [{ instanceId: 'key', defId: 'colossus_keystone', hp: 1, maxHp: 1 }],
    })
    put(state.players[1], 0, 'orc')
    const next = applyAction(state, action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'smash'))
    expect(monster(next, 1, 0).hp).toBe(60)
    expect(monster(next, 1, 0).statuses.some((s) => s.kind === 'weakened')).toBe(true)
  })
})

describe('Quake', () => {
  it('spends both attached energy', () => {
    const state = main(game())
    put(state.players[0], 0, 'colossus', {
      energy: 2,
      equipment: [{ instanceId: 'key', defId: 'colossus_keystone', hp: 1, maxHp: 1 }],
    })
    put(state.players[1], 0, 'blob')
    const next = applyAction(state, action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'quake'))
    expect(monster(next, 0, 0).energy).toBe(0)
    expect(monster(next, 1, 0).hp).toBe(40)
  })
})

describe('Fortify', () => {
  it('adds defense for two damage packets and does not stack', () => {
    const state = main(game())
    put(state.players[0], 0, 'colossus', {
      energy: 4,
      equipment: [{ instanceId: 'key', defId: 'colossus_keystone', hp: 1, maxHp: 1 }],
    })
    put(state.players[1], 0, 'blob', { energy: 6 })
    let next = applyAction(state, action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'fortify'))
    expect(monster(next, 0, 0).fortifyHitsLeft).toBe(2)
    next = main(next)
    next.abilityUsesLeft = 1
    monster(next, 0, 0).energy = 2
    next = applyAction(next, action(next, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'fortify'))
    expect(monster(next, 0, 0).fortifyHitsLeft).toBe(2)

    next = main(next, 1)
    const bash = () =>
      action(
        next,
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'wakkle',
      )
    next = applyAction(next, bash())
    expect(monster(next, 0, 0).hp).toBe(170)
    expect(monster(next, 0, 0).fortifyHitsLeft).toBe(1)
  })
})

describe('Yellow Blob', () => {
  it('adds energy that can only be attached to a blob', () => {
    const state = main(game())
    put(state.players[0], 0, 'yellow_blob')
    put(state.players[0], 1, 'orc')
    state.phase = 'move'
    const next = applyAction(state, { type: 'SKIP_MOVE' })
    expect(next.blobEnergyPool).toBe(1)
    expect(next.energyPool).toBe(1)
    expect(
      listLegalActions(next).some((a) => a.type === 'ATTACH_ENERGY' && a.slot === 1),
    ).toBe(true)
    const attached = applyAction(next, { type: 'ATTACH_ENERGY', slot: 0 })
    expect(monster(attached, 0, 0).energy).toBe(1)
    expect(attached.blobEnergyPool).toBe(0)
    expect(attached.energyPool).toBe(1)
    const skipped = applyAction(attached, { type: 'SKIP_ENERGY' })
    expect(skipped.blobEnergyPool).toBe(0)
    expect(skipped.energyPool).toBe(0)
  })
})

describe("Wizard's Key", () => {
  it('Open the 4th Floor spends the team action', () => {
    const state = main(game())
    put(state.players[0], 0, 'wizards_key', { energy: 1 })
    put(state.players[1], 0, 'blob')
    const next = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'open_fourth_floor'),
    )
    expect(next.abilityUsesLeft).toBe(0)
    expect(monster(next, 1, 0).hp).toBe(30)
  })

  it('Magic Door needs one attached energy and does not spend the team action', () => {
    const state = main(game())
    put(state.players[0], 0, 'wizards_key')
    put(state.players[0], 1, 'blob')
    expect(
      listLegalActions(state).some((a) => a.type === 'USE_ABILITY' && a.abilityId === 'magic_door'),
    ).toBe(false)
    monster(state, 0, 0).energy = 1
    const next = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'magic_door'),
    )
    expect(monster(next, 0, 1).stance).toBe('withdrawn')
    expect(monster(next, 0, 0).energy).toBe(1)
    expect(next.abilityUsesLeft).toBe(1)
    expect(next.movedThisTurn).toBe(false)
  })
})

describe('stance abilities', () => {
  it('Burrow changes stance without spending the move', () => {
    const state = main(game())
    put(state.players[0], 0, 'molika')
    const next = applyAction(state, action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'burrow'))
    expect(monster(next, 0, 0).stance).toBe('withdrawn')
    expect(next.movedThisTurn).toBe(false)
    expect(next.phase).toBe('main')
    expect(next.abilityUsesLeft).toBe(1)
  })

  it("Elder's Eye draws the card placed on top", () => {
    const state = main(game())
    put(state.players[0], 0, 'ancient_monstrosity', { energy: 3 })
    state.players[0].deck = [
      { instanceId: 'top', defId: 'blob' },
      { instanceId: 'mid', defId: 'orc' },
      { instanceId: 'bot', defId: 'coffee' },
      { instanceId: 'rest', defId: 'sword' },
    ]
    const before = state.players[0].hand.length
    let next = applyAction(state, action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'elders_eye'))
    next = applyAction(next, { type: 'ELDERS_PICK', instanceId: 'bot' })
    next = applyAction(next, { type: 'ELDERS_PICK', instanceId: 'top' })
    next = applyAction(next, { type: 'ELDERS_PICK', instanceId: 'mid' })
    expect(next.players[0].hand.at(-1)?.defId).toBe('coffee')
    expect(next.players[0].hand).toHaveLength(before + 1)
    expect(next.players[0].deck.map((card) => card.instanceId)).toEqual(['top', 'mid', 'rest'])
  })
})
