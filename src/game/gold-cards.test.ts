import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { getMonster } from './catalog'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { FieldEquipment, FieldMonster, GameAction, GameState, PlayerState } from './types'

function game(rng: () => number = () => 1): GameState {
  return createGame(
    { name: 'P1', cardIds: ['blob', 'orc', 'coffee', 'sword'], topMonsterIndex: 0 },
    { name: 'P2', cardIds: ['blob', 'orc', 'coffee', 'sword'], topMonsterIndex: 0 },
    { skipHandoff: true, shuffleRandom: () => 0, rng },
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

function equip(defId: string, hp = 30): FieldEquipment {
  return { instanceId: `${defId}-eq`, defId, hp, maxHp: hp }
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
  state.pending = null
  return state
}

function action(state: GameState, predicate: (candidate: GameAction) => boolean): GameAction {
  const found = listLegalActions(state).find(predicate)
  if (!found) throw new Error('Action not found')
  return found
}

function use(state: GameState, abilityId: string, extra: (candidate: GameAction) => boolean = () => true) {
  return applyAction(
    state,
    action(
      state,
      (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === abilityId && extra(candidate),
    ),
  )
}

describe('gold affinity cards', () => {
  it('prints the new cards and adds affinity to the pirate and knight', () => {
    expect(getMonster('dwarven_warrior')).toMatchObject({
      points: 2,
      maxHp: 80,
      defense: 1,
      goldAffinity: true,
    })
    expect(getMonster('dwarven_miner')).toMatchObject({ points: 2, maxHp: 80, defense: 1, goldAffinity: true })
    expect(getMonster('loot_goblin')).toMatchObject({
      points: 2,
      maxHp: 90,
      weakness: 'poison',
      goldAffinity: true,
    })
    expect(getMonster('fire_dragon')).toMatchObject({
      points: 6,
      maxHp: 250,
      weakness: 'water',
      goldAffinity: true,
    })
    expect(getMonster('amanesian_warden')).toMatchObject({ points: 2, maxHp: 100, goldAffinity: true })
    expect(getMonster('drowned_pirate').goldAffinity).toBe(true)
    expect(getMonster('red_knight').goldAffinity).toBe(true)
    expect(getMonster('drowned_pirate').abilities.find((a) => a.id === 'lost_treasure')?.ranged).toBe(true)
    const smithwork = getMonster('dwarven_warrior').abilities.find((a) => a.id === 'smithwork')
    expect(smithwork?.ranged).toBe(true)
    expect(smithwork?.free).toBeUndefined()
    expect(getMonster('dwarven_miner').abilities.find((a) => a.id === 'down_in_the_mines')).toMatchObject({
      free: true,
      ranged: true,
    })
    expect(getMonster('fire_dragon').abilities.find((a) => a.id === 'dragon_talons')?.upgradeText).toBe(
      '60 damage',
    )
  })

  it('doubles Great Axe after bonuses and before defense', () => {
    const doubled = main(game(() => 1))
    put(doubled.players[0], 0, 'dwarven_warrior', { energy: 2 })
    put(doubled.players[1], 0, 'red_knight')
    const hit = use(doubled, 'great_axe')
    expect(hit.players[1].field[0]!.hp).toBe(90)

    const plain = main(game(() => 6))
    put(plain.players[0], 0, 'dwarven_warrior', { energy: 2 })
    put(plain.players[1], 0, 'red_knight')
    expect(use(plain, 'great_axe').players[1].field[0]!.hp).toBe(110)
  })

  it('adds Dwarven Spirit gold before defense', () => {
    const state = main(game())
    put(state.players[0], 0, 'dwarven_miner', { energy: 2, gold: 1 })
    put(state.players[1], 0, 'dwarven_warrior', {
      equipment: [equip('shield', 30), equip('shield', 30)],
    })
    state.players[1].field[0]!.equipment[1].instanceId = 'shield-2'
    const next = use(state, 'miner_spirit')
    expect(next.players[1].field[0]!.hp).toBe(70)
  })

  it('lets the player keep or spend gold as energy', () => {
    const spent = main(game())
    put(spent.players[0], 0, 'fire_dragon', { energy: 1, gold: 1 })
    put(spent.players[1], 0, 'blob')
    const afterSpend = use(
      spent,
      'dragon_talons',
      (candidate) => candidate.type === 'USE_ABILITY' && candidate.goldSpend === 1,
    )
    expect(afterSpend.players[0].field[0]!.gold).toBe(0)
    expect(afterSpend.players[0].field[0]!.energy).toBe(1)
    expect(afterSpend.players[1].field[0]!.hp).toBe(10)

    const kept = main(game())
    put(kept.players[0], 0, 'fire_dragon', { energy: 1, gold: 1 })
    put(kept.players[1], 0, 'blob')
    const afterKeep = use(
      kept,
      'dragon_talons',
      (candidate) => candidate.type === 'USE_ABILITY' && candidate.goldRequire === 1,
    )
    expect(afterKeep.players[0].field[0]!.gold).toBe(1)
    expect(afterKeep.players[0].field[0]!.energy).toBe(0)
    expect(afterKeep.players[1].field[0]!.hp).toBe(10)

    const upgraded = main(game())
    put(upgraded.players[0], 0, 'fire_dragon', { energy: 2, gold: 1 })
    put(upgraded.players[1], 0, 'blob', { hp: 200, maxHp: 200 })
    const afterUpgrade = use(upgraded, 'dragon_talons')
    expect(afterUpgrade.players[1].field[0]!.hp).toBe(140)
  })

  it('assigns each gained gold to your own affinity cards', () => {
    const lost = main(game())
    lost.players[0].hand = [{ instanceId: 'hoard', defId: 'treasure_hoard' }]
    let state = applyAction(lost, action(lost, (a) => a.type === 'PLAY_EFFECT'))
    state = applyAction(state, { type: 'HOARD_CHOICE', mode: 'gold' })
    expect(state.pending).toBeNull()
    expect(state.log.some((entry) => entry.message.includes('no Gold Affinity'))).toBe(true)

    const shared = main(game())
    put(shared.players[0], 0, 'dwarven_warrior')
    put(shared.players[0], 1, 'loot_goblin')
    put(shared.players[1], 0, 'dwarven_miner', { gold: 4 })
    shared.players[0].hand = [{ instanceId: 'hoard', defId: 'treasure_hoard' }]
    state = applyAction(shared, action(shared, (a) => a.type === 'PLAY_EFFECT'))
    state = applyAction(state, { type: 'HOARD_CHOICE', mode: 'gold' })
    expect(listLegalActions(state).map((a) => (a.type === 'ASSIGN_GOLD' ? a.slot : -1)).sort()).toEqual([
      0, 1,
    ])
    state = applyAction(state, { type: 'ASSIGN_GOLD', slot: 0 })
    state = applyAction(state, { type: 'ASSIGN_GOLD', slot: 1 })
    state = applyAction(state, { type: 'ASSIGN_GOLD', slot: 0 })
    expect(state.pending).toBeNull()
    expect(state.players[0].field[0]!.gold).toBe(2)
    expect(state.players[0].field[1]!.gold).toBe(1)
    expect(state.players[1].field[0]!.gold).toBe(4)

    const drawn = main(game())
    put(drawn.players[0], 0, 'dwarven_warrior')
    drawn.players[0].hand = [{ instanceId: 'hoard', defId: 'treasure_hoard' }]
    drawn.players[0].deck = [{ instanceId: 'drawn', defId: 'coffee' }]
    state = applyAction(drawn, action(drawn, (a) => a.type === 'PLAY_EFFECT'))
    state = applyAction(state, { type: 'HOARD_CHOICE', mode: 'card' })
    state = applyAction(state, { type: 'ASSIGN_GOLD', slot: 0 })
    expect(state.players[0].field[0]!.gold).toBe(1)
    expect(state.players[0].hand.some((card) => card.instanceId === 'drawn')).toBe(true)
  })

  it('gains gold from Smithwork and a free ranged mine shift', () => {
    const warrior = main(game())
    put(warrior.players[0], 0, 'dwarven_warrior', { energy: 1, stance: 'withdrawn' })
    let state = use(warrior, 'smithwork')
    expect(state.abilityUsesLeft).toBe(0)
    state = applyAction(state, { type: 'ASSIGN_GOLD', slot: 0 })
    expect(state.players[0].field[0]!.gold).toBe(1)

    const miner = main(game())
    put(miner.players[0], 0, 'dwarven_miner', { energy: 3, stance: 'withdrawn' })
    expect(listLegalActions(miner).some((a) => a.type === 'USE_ABILITY' && a.abilityId === 'miner_smithwork')).toBe(
      false,
    )
    state = use(miner, 'down_in_the_mines')
    expect(state.abilityUsesLeft).toBe(1)
    state = applyAction(state, { type: 'ASSIGN_GOLD', slot: 0 })
    expect(state.players[0].field[0]!.gold).toBe(1)
  })

  it('steals equipment, including a Keystone, but not a duplicate', () => {
    const state = main(game())
    put(state.players[0], 0, 'loot_goblin', { energy: 3, equipment: [equip('sword', 30)] })
    put(state.players[1], 0, 'orc', {
      equipment: [equip('sword', 30), equip('shield', 30)],
    })
    state.players[1].field[0]!.equipment[0].instanceId = 'orc-sword'
    put(state.players[1], 1, 'colossus', {
      equipment: [equip('colossus_keystone', 1)],
    })
    const thefts = listLegalActions(state).filter(
      (a) => a.type === 'USE_ABILITY' && a.abilityId === 'theft' && a.target?.kind === 'equipment',
    )
    expect(thefts.some((a) => a.type === 'USE_ABILITY' && a.target?.kind === 'equipment' && a.target.slot === 0 && a.target.equipmentIndex === 0)).toBe(
      false,
    )
    let next = use(
      state,
      'theft',
      (a) => a.type === 'USE_ABILITY' && a.target?.kind === 'equipment' && a.target.slot === 0,
    )
    expect(next.players[0].field[0]!.equipment.map((eq) => eq.defId).sort()).toEqual(['shield', 'sword'])
    expect(next.players[1].field[0]!.equipment.map((eq) => eq.defId)).toEqual(['sword'])

    next.abilityUsesLeft = 1
    next.actedSlots = []
    next.players[0].field[0]!.energy = 3
    next = use(
      next,
      'theft',
      (a) => a.type === 'USE_ABILITY' && a.target?.kind === 'equipment' && a.target.slot === 1,
    )
    expect(next.players[0].field[0]!.equipment.some((eq) => eq.defId === 'colossus_keystone')).toBe(true)
    expect(next.players[1].field[1]!.equipment).toEqual([])
  })

  it('adds the goblin bonus before defense and stacks it with Sword', () => {
    const state = main(game())
    put(state.players[0], 0, 'loot_goblin', { energy: 2, gold: 1, equipment: [equip('sword', 30)] })
    put(state.players[1], 0, 'blob', { hp: 100, maxHp: 100 })
    const next = use(
      state,
      'goblin_scratch',
      (a) => a.type === 'USE_ABILITY' && (a.goldRequire ?? 0) === 0 && (a.goldSpend ?? 0) === 0,
    )
    expect(next.players[1].field[0]!.hp).toBe(50)
  })

  it('remembers every monster that has damaged you and hits them with Archers', () => {
    const state = main(game(() => 6), 1)
    put(state.players[0], 0, 'amanesian_warden')
    put(state.players[1], 0, 'dwarven_warrior', { energy: 2 })
    put(state.players[1], 1, 'blob')
    let next = use(state, 'great_axe')
    expect(next.players[0].damagedByInstanceIds).toEqual(['1-0-dwarven_warrior'])
    expect(next.players[0].field[0]!.hp).toBe(80)

    next = main(next, 0)
    next.players[0].field[0]!.energy = 3
    next = use(next, 'archers_of_the_keep')
    expect(next.players[1].field[0]!.hp).toBe(70)
    expect(next.players[1].field[1]!.hp).toBe(50)

    next = main(next, 0)
    next.players[0].field[0]!.energy = 3
    next = use(next, 'archers_of_the_keep')
    expect(next.players[1].field[0]!.hp).toBe(60)
  })

  it('burns two adjacent cards with Burning Breath and ignores equipment', () => {
    const state = main(game())
    put(state.players[0], 0, 'fire_dragon', { energy: 4 })
    put(state.players[1], 0, 'blob', { hp: 200, maxHp: 200, equipment: [equip('shield', 30)] })
    put(state.players[1], 1, 'blob', { hp: 200, maxHp: 200 })
    const breaths = listLegalActions(state).filter(
      (a) => a.type === 'USE_ABILITY' && a.abilityId === 'burning_breath',
    )
    expect(breaths.every((a) => a.type === 'USE_ABILITY' && a.targets?.every((t) => t.kind === 'monster'))).toBe(
      true,
    )
    const next = use(
      state,
      'burning_breath',
      (a) => a.type === 'USE_ABILITY' && a.targets?.every((target) => target.player === 1) === true,
    )
    expect(next.players[1].field[0]!.hp).toBe(150)
    expect(next.players[1].field[1]!.hp).toBe(140)
    expect(next.players[1].field[0]!.statuses.some((s) => s.kind === 'burn' && s.turns === 3)).toBe(true)
    expect(next.players[1].field[1]!.statuses.some((s) => s.kind === 'burn' && s.turns === 3)).toBe(true)
    expect(next.players[1].field[0]!.equipment[0].hp).toBe(30)
  })

  it('gives the warden defense while its ward has gold, and bonus damage from its own gold', () => {
    const guarded = main(game())
    put(guarded.players[0], 0, 'amanesian_warden', { energy: 1 })
    put(guarded.players[0], 1, 'dwarven_warrior', { gold: 1 })
    let state = use(guarded, 'treasure_keepers')
    expect(state.players[0].field[0]!.protectingInstanceId).toBe('0-1-dwarven_warrior')

    state = main(state, 1)
    put(state.players[1], 0, 'red_knight', { energy: 2 })
    state = use(state, 'fire_sword')
    expect(state.players[0].field[0]!.hp).toBe(70)

    const open = main(game())
    put(open.players[0], 0, 'amanesian_warden', { energy: 1, gold: 2 })
    put(open.players[0], 1, 'dwarven_warrior')
    state = use(open, 'treasure_keepers')
    state = main(state, 1)
    put(state.players[1], 0, 'red_knight', { energy: 2 })
    state = use(state, 'fire_sword')
    expect(state.players[0].field[0]!.hp).toBe(60)

    const fists = main(game())
    put(fists.players[0], 0, 'amanesian_warden', { energy: 2, gold: 2 })
    put(fists.players[1], 0, 'blob')
    state = use(
      fists,
      'iron_fists',
      (a) => a.type === 'USE_ABILITY' && (a.goldSpend ?? 0) === 0,
    )
    expect(state.players[1].field[0]!.hp).toBe(10)
  })

  it('lets Red Knight cover Flurry with gold and energy', () => {
    const state = main(game())
    put(state.players[0], 0, 'red_knight', { energy: 1, gold: 1 })
    put(state.players[1], 0, 'blob')
    const next = use(
      state,
      'flurry_of_blows',
      (a) =>
        a.type === 'USE_ABILITY' &&
        a.extraEnergy === 1 &&
        a.goldRequire === 1 &&
        (a.goldSpend ?? 0) === 0,
    )
    expect(next.players[0].field[0]!.energy).toBe(0)
    expect(next.players[0].field[0]!.gold).toBe(1)
    expect(next.players[1].field[0]!.hp).toBe(20)
  })
})
