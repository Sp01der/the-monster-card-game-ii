import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { countsAsElementalCard, getMonster } from './catalog'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { FieldMonster, GameAction, GameState, PlayerState, TargetRef } from './types'

function game(rng: () => number = () => 6): GameState {
  return createGame(
    { name: 'P1', cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'], topMonsterIndex: 0 },
    { name: 'P2', cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'], topMonsterIndex: 0 },
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

function use(state: GameState, abilityId: string, extra: (candidate: GameAction) => boolean = () => true) {
  return applyAction(
    state,
    action(
      state,
      (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === abilityId && extra(candidate),
    ),
  )
}

function monsterTarget(player: 0 | 1, slot: number): TargetRef {
  return { kind: 'monster', player, slot }
}

describe('storm and legion cards', () => {
  it('prints the new cards', () => {
    expect(getMonster('stormling')).toMatchObject({
      points: 3, maxHp: 140, weakness: 'light', families: ['stormling'],
    })
    expect(getMonster('stormling_commander')).toMatchObject({
      points: 4, maxHp: 150, families: ['stormling'],
    })
    expect(getMonster('stormling_commander').weakness).toBeUndefined()
    expect(getMonster('unending_legionary')).toMatchObject({ points: 2, maxHp: 80, weakness: 'electric' })
    expect(getMonster('unending_bannerman')).toMatchObject({ points: 2, maxHp: 80, weakness: 'electric' })
    expect(getMonster('veyan_bard')).toMatchObject({ points: 2, maxHp: 90 })
    expect(getMonster('gale_serpent')).toMatchObject({ points: 2, maxHp: 90, weakness: 'ice' })
    expect(countsAsElementalCard('stormling')).toBe(true)
    expect(countsAsElementalCard('stormling_commander')).toBe(true)
    expect(countsAsElementalCard('gale_serpent')).toBe(false)
  })

  it('hits three different cards with Downpour, including your own and equipment', () => {
    const state = main(game())
    put(state.players[0], 0, 'stormling', { energy: 2 })
    put(state.players[0], 1, 'horned', { hp: 90 })
    put(state.players[1], 0, 'horned', {
      hp: 90,
      equipment: [{ instanceId: 'shield-eq', defId: 'shield', hp: 30, maxHp: 30 }],
    })
    const pouring = use(state, 'downpour')
    expect(pouring.pending).toMatchObject({ kind: 'multiHit', remaining: 3, scope: 'any', status: 'wet' })
    const first = applyAction(pouring, { type: 'PENDING_TARGET', target: monsterTarget(1, 0) })
    const same = listLegalActions(first).filter(
      (candidate) => candidate.type === 'PENDING_TARGET' && candidate.target.kind === 'monster' && candidate.target.slot === 0 && candidate.target.player === 1,
    )
    expect(same).toHaveLength(0)
    const second = applyAction(first, {
      type: 'PENDING_TARGET',
      target: { kind: 'equipment', player: 1, slot: 0, equipmentIndex: 0 },
    })
    const third = applyAction(second, { type: 'PENDING_TARGET', target: monsterTarget(0, 1) })
    expect(third.pending).toBeNull()
    expect(third.players[1].field[0]?.hp).toBe(80)
    expect(third.players[1].field[0]?.statuses[0]).toMatchObject({ kind: 'wet', turns: 3 })
    expect(third.players[1].field[0]?.equipment[0]?.hp).toBe(20)
    expect(third.players[1].field[0]?.equipment[0]?.statuses).toBeUndefined()
    expect(third.players[0].field[1]?.hp).toBe(80)
    expect(third.players[0].field[1]?.statuses[0]).toMatchObject({ kind: 'wet', turns: 3 })
    expect(third.abilityUsesLeft).toBe(0)
  })

  it('may withdraw after Gale, and Tail Gale withdraws unless the card is stuck or slain', () => {
    const state = main(game())
    put(state.players[0], 0, 'stormling', { energy: 2 })
    put(state.players[1], 0, 'blob', { hp: 50 })
    const choosing = use(state, 'gale', (candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.player === 1)
    expect(choosing.players[1].field[0]?.hp).toBe(20)
    expect(choosing.pending?.kind).toBe('forceWithdraw')
    expect(choosing.movedThisTurn).toBe(false)
    const stayed = applyAction(choosing, { type: 'FORCE_WITHDRAW', accept: false })
    expect(stayed.players[1].field[0]?.stance).toBe('active')

    const again = main(game())
    put(again.players[0], 0, 'stormling', { energy: 2 })
    put(again.players[0], 1, 'blob', { hp: 50 })
    put(again.players[1], 0, 'blob')
    const own = use(again, 'gale', (candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.player === 0 && candidate.target.slot === 1)
    const withdrawn = applyAction(own, { type: 'FORCE_WITHDRAW', accept: true })
    expect(withdrawn.players[0].field[1]?.stance).toBe('withdrawn')
    expect(withdrawn.movedThisTurn).toBe(false)
    expect(withdrawn.movedSlots).toContain(1)

    const goo = main(game())
    put(goo.players[0], 0, 'gale_serpent', { energy: 2 })
    put(goo.players[1], 0, 'blob', { hp: 50, statuses: [{ kind: 'goo', turns: 1 }] })
    const stuck = use(goo, 'tail_gale', (candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.player === 1 && candidate.target.kind === 'monster')
    expect(stuck.pending).toBeNull()
    expect(stuck.players[1].field[0]?.hp).toBe(20)
    expect(stuck.players[1].field[0]?.stance).toBe('active')

    const slain = main(game())
    put(slain.players[0], 0, 'gale_serpent', { energy: 2 })
    put(slain.players[1], 0, 'blob', { hp: 20 })
    const dead = use(slain, 'tail_gale', (candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.player === 1 && candidate.target.kind === 'monster')
    expect(dead.players[1].field[0]).toBeNull()
    expect(dead.pending).toBeNull()
  })

  it('lets Bring the STORM choose a type and count other Stormlings before defense', () => {
    const state = main(game())
    put(state.players[0], 0, 'stormling_commander', { energy: 2 })
    put(state.players[0], 1, 'stormling', { stance: 'withdrawn' })
    put(state.players[1], 0, 'construct', { hp: 100 })
    const choosing = use(state, 'bring_the_storm')
    expect(choosing.pending).toMatchObject({ kind: 'stormType', amount: 50 })
    const water = applyAction(choosing, { type: 'STORM_TYPE', damageType: 'water' })
    const hit = applyAction(water, { type: 'PENDING_TARGET', target: monsterTarget(1, 0) })
    expect(hit.players[1].field[0]?.hp).toBe(30)
  })

  it('gives an elemental card one extra ability that does not spend the team action', () => {
    const state = main(game())
    put(state.players[0], 0, 'stormling_commander', { energy: 1 })
    put(state.players[0], 1, 'stormling', { energy: 1 })
    put(state.players[0], 2, 'gale_serpent')
    put(state.players[1], 0, 'blob', { hp: 50 })
    state.actedSlots = [1]
    state.abilityUsesLeft = 1
    const targets = listLegalActions(state).filter(
      (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'storm_command',
    )
    expect(targets.map((candidate) => candidate.type === 'USE_ABILITY' ? candidate.target : null)).toEqual([
      monsterTarget(0, 0),
      monsterTarget(0, 1),
    ])
    const commanded = use(state, 'storm_command', (candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.slot === 1)
    expect(commanded.abilityUsesLeft).toBe(1)
    expect(commanded.players[0].field[0]?.energy).toBe(0)
    expect(commanded.players[0].field[1]?.extraAbilityUses).toBe(1)
    const stabbed = use(commanded, 'stab')
    expect(stabbed.abilityUsesLeft).toBe(1)
    expect(stabbed.players[0].field[1]?.extraAbilityUses).toBe(0)
    expect(stabbed.players[1].field[0]?.hp).toBe(30)
  })

  it('lets Relentless act again and endure lethal hits until the next turn', () => {
    const state = main(game())
    put(state.players[0], 0, 'unending_legionary', { energy: 3, hp: 20 })
    put(state.players[1], 0, 'blob', { hp: 50 })
    const enduring = use(state, 'relentless')
    expect(enduring.players[0].field[0]?.extraAbilityUses).toBe(1)
    expect(enduring.players[0].field[0]?.unending).toBe(true)
    expect(enduring.abilityUsesLeft).toBe(0)
    const speared = use(enduring, 'legion_spear')
    expect(speared.abilityUsesLeft).toBe(0)
    expect(speared.players[0].field[0]?.extraAbilityUses).toBe(0)
    expect(speared.players[1].field[0]?.hp).toBe(30)

    const struck = main(game())
    put(struck.players[0], 0, 'stormling', { energy: 1 })
    put(struck.players[1], 0, 'unending_legionary', { hp: 20, unending: true })
    const saved = use(struck, 'stab', (candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.player === 1)
    expect(saved.players[1].field[0]?.hp).toBe(10)
    saved.phase = 'draw'
    saved.drewThisTurn = false
    saved.activePlayer = 1
    const nextTurn = applyAction(saved, { type: 'SKIP_DRAW' })
    expect(nextTurn.players[1].field[0]?.unending).toBe(false)
  })

  it('spends ATTACK! and then leaves two actions, adding 10 before weakness', () => {
    const state = main(game())
    put(state.players[0], 0, 'unending_bannerman', { energy: 4 })
    put(state.players[0], 1, 'stormling', { energy: 3 })
    put(state.players[1], 0, 'horned', { hp: 90 })
    const shouted = use(state, 'attack')
    expect(shouted.abilityUsesLeft).toBe(2)
    const bolted = use(shouted, 'bolt')
    expect(bolted.players[1].field[0]).toBeNull()
    expect(bolted.abilityUsesLeft).toBe(1)
  })

  it('adds Bannerman energy only on your energy phase, and only for a monster worth 2 points or less', () => {
    const state = main(game())
    put(state.players[0], 0, 'unending_bannerman')
    put(state.players[0], 1, 'unending_legionary')
    put(state.players[0], 2, 'stormling')
    state.phase = 'move'
    const energy = applyAction(state, { type: 'SKIP_MOVE' })
    expect(energy.bannerEnergyPool).toBe(1)
    expect(energy.energyPool).toBe(1)
    const legion = listLegalActions(energy).some(
      (candidate) => candidate.type === 'ATTACH_ENERGY' && candidate.slot === 1,
    )
    expect(legion).toBe(true)
    const attached = applyAction(energy, { type: 'ATTACH_ENERGY', slot: 1 })
    expect(attached.bannerEnergyPool).toBe(0)
    expect(attached.energyPool).toBe(1)
    expect(attached.players[0].field[1]?.energy).toBe(1)

    const skipped = main(game())
    put(skipped.players[0], 0, 'stormling')
    skipped.phase = 'energy'
    skipped.energyPool = 0
    skipped.bannerEnergyPool = 1
    expect(listLegalActions(skipped).some((candidate) => candidate.type === 'ATTACH_ENERGY')).toBe(false)
    const lost = applyAction(skipped, { type: 'SKIP_ENERGY' })
    expect(lost.bannerEnergyPool).toBe(0)
  })

  it('requires equipment for Improvised Weapon', () => {
    const bare = main(game())
    put(bare.players[0], 0, 'unending_legionary', { energy: 2 })
    put(bare.players[1], 0, 'blob', { hp: 50 })
    expect(listLegalActions(bare).some((candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'improvised_weapon')).toBe(false)

    const armed = main(game())
    put(armed.players[0], 0, 'unending_legionary', {
      energy: 2,
      equipment: [{ instanceId: 'sword-eq', defId: 'sword', hp: 40, maxHp: 40 }],
    })
    put(armed.players[1], 0, 'blob', {
      hp: 50,
      equipment: [{ instanceId: 'shield-eq', defId: 'shield', hp: 30, maxHp: 30 }],
    })
    const hit = use(armed, 'improvised_weapon', (candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.kind === 'equipment')
    expect(hit.players[1].field[0]?.equipment).toHaveLength(0)
    expect(hit.players[1].discard.some((card) => card.defId === 'shield')).toBe(true)
  })

  it('rolls the solo, draws two, and strikes twice with sonic damage', () => {
    const quiet = main(game(() => 1))
    put(quiet.players[0], 0, 'veyan_bard', { energy: 1 })
    put(quiet.players[1], 0, 'blob', { hp: 50 })
    const soft = use(quiet, 'overdramatic_solo')
    expect(soft.players[1].field[0]?.hp).toBe(40)

    const loud = main(game(() => 6))
    put(loud.players[0], 0, 'veyan_bard', { energy: 1 })
    put(loud.players[1], 0, 'blob', { hp: 50 })
    expect(use(loud, 'overdramatic_solo').players[1].field[0]?.hp).toBe(20)

    const drawing = main(game())
    put(drawing.players[0], 0, 'veyan_bard', { energy: 2 })
    const hand = drawing.players[0].hand.length
    const deck = drawing.players[0].deck.length
    const drew = use(drawing, 'attracting_melody')
    expect(drew.players[0].hand).toHaveLength(hand + 2)
    expect(drew.players[0].deck).toHaveLength(deck - 2)
    expect(drew.abilityUsesLeft).toBe(0)

    const music = main(game())
    put(music.players[0], 0, 'veyan_bard', { energy: 2 })
    put(music.players[1], 0, 'blob', {
      hp: 50,
      equipment: [{ instanceId: 'shield-eq', defId: 'shield', hp: 30, maxHp: 30 }],
    })
    put(music.players[1], 1, 'blob', { hp: 50 })
    const first = use(music, 'magic_music')
    const second = applyAction(first, { type: 'PENDING_TARGET', target: monsterTarget(1, 0) })
    const third = applyAction(second, { type: 'PENDING_TARGET', target: monsterTarget(1, 1) })
    expect(third.players[1].field[0]?.hp).toBe(30)
    expect(third.players[1].field[0]?.equipment[0]?.hp).toBe(30)
    expect(third.players[1].field[1]?.hp).toBe(30)
  })

  it('poisons for one turn with Serpent Fang', () => {
    const state = main(game())
    put(state.players[0], 0, 'gale_serpent', { energy: 1 })
    put(state.players[1], 0, 'blob', { hp: 50 })
    const bitten = use(state, 'serpents_fang')
    expect(bitten.players[1].field[0]?.hp).toBe(30)
    expect(bitten.players[1].field[0]?.statuses[0]).toMatchObject({ kind: 'poison', turns: 1 })
  })
})
