import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { getCard, getMonster, isFireMonster } from './catalog'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { FieldEquipment, FieldMonster, GameAction, GameState, PlayerState, TargetRef } from './types'

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

describe('plant cards', () => {
  it('prints the plant batch and tags the old snapatrap', () => {
    expect(getMonster('snapatrap').families).toEqual(['plant'])
    expect(getMonster('toxi_trap')).toMatchObject({
      points: 2, maxHp: 70, weakness: 'fire', families: ['plant'],
    })
    expect(getMonster('green_fairy')).toMatchObject({ points: 2, maxHp: 90, weakness: 'electric' })
    expect(getMonster('green_fairy').families).toBeUndefined()
    const dust = getMonster('green_fairy').abilities.find((ability) => ability.id === 'pixie_dust')
    expect(dust?.cost).toEqual({ require: 0, spend: 0 })
    expect(dust?.free).toBeUndefined()
    expect(getMonster('woody').families).toEqual(['plant', 'woody'])
    expect(getMonster('lovnis_weed')).toMatchObject({
      points: 1, maxHp: 60, extremeWeakness: true, families: ['plant'],
    })
    expect(getCard('magic_fertilizer')).toMatchObject({ kind: 'effect', effectId: 'magicFertilizer' })
    expect(getMonster('triple_snapatrap')).toMatchObject({ points: 4, maxHp: 180, families: ['plant'] })
    expect(getMonster('ecoling')).toMatchObject({ extremeWeakness: true, families: ['plant'] })
    expect(getMonster('vineshon')).toMatchObject({ points: 1, maxHp: 60, extremeWeakness: true })
    expect(getMonster('withered_woody').families).toEqual(['plant', 'woody'])
    expect(isFireMonster('red_knight')).toBe(true)
    expect(isFireMonster('fire_dragon')).toBe(true)
    expect(isFireMonster('withered_woody')).toBe(true)
    expect(isFireMonster('rocketeer')).toBe(false)
    expect(isFireMonster('green_fairy')).toBe(false)
  })

  it('gives Pixie Dust no energy cost while still spending the team action', () => {
    const state = main(game())
    put(state.players[0], 0, 'green_fairy')
    put(state.players[1], 0, 'blob', { hp: 50 })
    const next = use(state, 'pixie_dust', (candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.slot === 0)
    expect(next.players[0].field[0]?.energy).toBe(0)
    expect(next.abilityUsesLeft).toBe(0)
    expect(next.players[1].field[0]?.hp).toBe(40)
  })

  it('heals 10 at the end of your turn, before poison, including equipment', () => {
    const state = main(game())
    put(state.players[0], 0, 'green_fairy')
    put(state.players[0], 1, 'blob', {
      equipment: [{ instanceId: 'sword-eq', defId: 'sword', hp: 10, maxHp: 30 }],
    })
    put(state.players[0], 2, 'blob', {
      hp: 10,
      statuses: [{ kind: 'poison', turns: 1, skipNextTick: false }],
    })
    put(state.players[1], 0, 'green_fairy')
    state.phase = 'end'
    const choosing = applyAction(state, { type: 'END_TURN' })
    expect(choosing.pending).toMatchObject({ kind: 'fairyHeal', remaining: 1 })
    expect(choosing.players[0].field[2]?.hp).toBe(10)
    const healed = applyAction(
      choosing,
      action(
        choosing,
        (candidate) =>
          candidate.type === 'FAIRY_HEAL' &&
          candidate.target.kind === 'equipment' &&
          candidate.target.slot === 1,
      ),
    )
    expect(healed.players[0].field[1]?.equipment[0].hp).toBe(20)
    expect(healed.players[0].field[2]).toBeNull()
    expect(healed.activePlayer).toBe(1)
    expect(healed.awaitingHandoff).toBe(true)
  })

  it('does not heal for a Green Fairy during the opponent turn', () => {
    const state = main(game())
    put(state.players[1], 0, 'green_fairy')
    put(state.players[0], 0, 'blob')
    state.phase = 'end'
    const next = applyAction(state, { type: 'END_TURN' })
    expect(next.pending).toBeNull()
    expect(next.activePlayer).toBe(1)
  })

  it('fertilizes only your plants, including withdrawn ones', () => {
    const state = main(game())
    put(state.players[0], 0, 'snapatrap')
    put(state.players[0], 1, 'woody', { stance: 'withdrawn' })
    put(state.players[0], 2, 'green_fairy')
    put(state.players[1], 0, 'snapatrap')
    state.players[0].hand.push({ instanceId: 'fert', defId: 'magic_fertilizer' })
    const handIndex = state.players[0].hand.findIndex((card) => card.defId === 'magic_fertilizer')
    const next = applyAction(state, { type: 'PLAY_EFFECT', handIndex, targets: [] })
    expect(next.players[0].field[0]?.energy).toBe(1)
    expect(next.players[0].field[1]?.energy).toBe(1)
    expect(next.players[0].field[2]?.energy).toBe(0)
    expect(next.players[1].field[0]?.energy).toBe(0)
  })

  it('adds poison damage only for your other weeds', () => {
    const state = main(game())
    put(state.players[0], 0, 'lovnis_weed', { energy: 2 })
    put(state.players[0], 1, 'lovnis_weed')
    put(state.players[0], 2, 'lovnis_weed')
    put(state.players[1], 0, 'blob', { hp: 100, maxHp: 100 })
    put(state.players[1], 1, 'lovnis_weed', { stance: 'withdrawn' })
    put(state.players[1], 2, 'lovnis_weed', { stance: 'withdrawn' })
    const next = use(state, 'scent', (candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.slot === 0)
    expect(next.players[1].field[0]?.hp).toBe(60)
  })

  it('places a weed in an empty slot, and drops an extra slot when that weed leaves', () => {
    const open = main(game())
    put(open.players[0], 0, 'lovnis_weed', { energy: 1 })
    const placing = use(open, 'multiply')
    expect(placing.pending?.kind).toBe('placeWeed')
    expect(placing.abilityUsesLeft).toBe(1)
    expect(placing.players[0].field[0]?.energy).toBe(0)
    expect(placing.players[0].field).toHaveLength(7)
    const placed = applyAction(placing, { type: 'PLACE_WEED', slot: 1, stance: 'withdrawn' })
    expect(placed.players[0].field).toHaveLength(7)
    expect(placed.players[0].field[1]).toMatchObject({
      defId: 'lovnis_weed', stance: 'withdrawn', hp: 60, energy: 0, ownsExtraSlot: undefined,
    })

    const full = main(game())
    for (let slot = 0; slot < 7; slot++) put(full.players[0], slot, 'lovnis_weed', { energy: slot === 0 ? 1 : 0 })
    const growing = use(full, 'multiply')
    expect(listLegalActions(growing).map((candidate) => candidate.type === 'PLACE_WEED' ? candidate.slot : -1))
      .toEqual([7, 7])
    const grown = applyAction(growing, { type: 'PLACE_WEED', slot: 7, stance: 'active' })
    expect(grown.players[0].field).toHaveLength(8)
    expect(grown.players[0].field[7]?.ownsExtraSlot).toBe(true)
    grown.players[0].field[7]!.hp = 10
    put(grown.players[1], 0, 'blob', { energy: 1 })
    main(grown, 1)
    const slain = use(
      grown,
      'wakkle',
      (candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.slot === 7,
    )
    expect(slain.players[0].field).toHaveLength(7)
    expect(slain.players[0].points).toBe(5)
  })

  it('repeats Triple Chomp from current HP, with a new roll and target each time', () => {
    const low = main(game())
    put(low.players[0], 0, 'triple_snapatrap', { hp: 60, energy: 3 })
    put(low.players[1], 0, 'blob', { hp: 200, maxHp: 200 })
    const once = use(low, 'triple_chomp')
    expect(once.pending).toMatchObject({ kind: 'multiHit', remaining: 1, strike: 'chomp' })

    const state = main(game(() => 1))
    const rolls = [1, 6]
    let index = 0
    state.rng = () => rolls[index++] ?? 1
    put(state.players[0], 0, 'triple_snapatrap', { hp: 100, energy: 3 })
    put(state.players[1], 0, 'blob', { hp: 200, maxHp: 200 })
    put(state.players[1], 1, 'blob', { hp: 200, maxHp: 200 })
    let next = use(state, 'triple_chomp')
    expect(next.pending).toMatchObject({ remaining: 2, strike: 'chomp' })
    next = applyAction(next, { type: 'PENDING_TARGET', target: monsterTarget(1, 0) })
    expect(next.players[1].field[0]?.hp).toBe(170)
    expect(next.pending).toMatchObject({ remaining: 1 })
    next = applyAction(next, { type: 'PENDING_TARGET', target: monsterTarget(1, 1) })
    expect(next.players[1].field[1]?.hp).toBe(160)
    expect(next.pending).toBeNull()

    const high = main(game())
    put(high.players[0], 0, 'triple_snapatrap', { hp: 180, energy: 3 })
    put(high.players[1], 0, 'blob')
    expect(use(high, 'triple_chomp').pending).toMatchObject({ remaining: 3 })
  })

  it('uses Spear once for every woody in play and every woody in your hand', () => {
    const state = main(game(() => 6))
    put(state.players[0], 0, 'woody', { energy: 2 })
    put(state.players[1], 0, 'withered_woody')
    put(state.players[1], 1, 'blob', { hp: 100, maxHp: 100 })
    state.players[0].hand.push({ instanceId: 'hand-withered', defId: 'withered_woody' })
    state.players[1].hand.push({ instanceId: 'hand-woody', defId: 'woody' })
    let next = use(state, 'team_attack')
    expect(next.pending).toMatchObject({ kind: 'multiHit', remaining: 3, strike: 'spear' })
    next = applyAction(next, { type: 'PENDING_TARGET', target: monsterTarget(1, 1) })
    expect(next.players[1].field[1]?.hp).toBe(80)
    expect(next.pending).toMatchObject({ remaining: 2 })
  })

  it('poisons two adjacent cards on a 4/6', () => {
    const state = main(game(() => 1))
    put(state.players[0], 0, 'toxi_trap', { energy: 1 })
    put(state.players[1], 0, 'blob', { hp: 50 })
    put(state.players[1], 1, 'blob', { hp: 50 })
    put(state.players[1], 3, 'blob', { hp: 50 })
    const next = use(state, 'poison_gas', (candidate) => {
      if (candidate.type !== 'USE_ABILITY' || !candidate.targets) return false
      const slots = candidate.targets.map((target) => target.slot).sort()
      return slots[0] === 0 && slots[1] === 1 && candidate.targets.every((target) => target.kind === 'monster')
    })
    expect(next.players[1].field[0]?.hp).toBe(30)
    expect(next.players[1].field[1]?.hp).toBe(30)
    expect(next.players[1].field[0]?.statuses.some((status) => status.kind === 'poison')).toBe(true)
    expect(next.players[1].field[1]?.statuses.some((status) => status.kind === 'poison')).toBe(true)
    expect(next.players[1].field[3]?.hp).toBe(50)
  })

  it('refuses to heal fire monsters and the equipment on them', () => {
    const state = main(game())
    put(state.players[0], 0, 'ecoling', { energy: 2 })
    put(state.players[1], 0, 'red_knight', { equipment: [equip('sword')] })
    put(state.players[1], 1, 'blob', { hp: 40, maxHp: 80, equipment: [equip('sword', 10)] })
    const targets = listLegalActions(state).filter(
      (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'healing_hands',
    )
    expect(
      targets.some(
        (candidate) =>
          candidate.type === 'USE_ABILITY' && candidate.target?.player === 1 && candidate.target.slot === 0,
      ),
    ).toBe(false)
    expect(
      targets.some(
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.target?.kind === 'equipment' &&
          candidate.target.player === 1 &&
          candidate.target.slot === 1,
      ),
    ).toBe(true)
    const next = use(
      state,
      'healing_hands',
      (candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.kind === 'monster' && candidate.target.slot === 1,
    )
    expect(next.players[1].field[1]?.hp).toBe(70)
  })

  it('grows a plant you control by 20 HP and 20 max HP', () => {
    const state = main(game())
    put(state.players[0], 0, 'ecoling', { energy: 3 })
    put(state.players[0], 1, 'snapatrap', { hp: 40 })
    put(state.players[1], 0, 'snapatrap', { hp: 40 })
    const targets = listLegalActions(state).filter(
      (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'growth',
    )
    expect(targets.every((candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.player === 0)).toBe(true)
    const next = use(state, 'growth', (candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.slot === 1)
    expect(next.players[0].field[1]).toMatchObject({ hp: 60, maxHp: 90 })
    expect(next.players[1].field[0]).toMatchObject({ hp: 40, maxHp: 70 })
  })

  it('damages a withdrawn card and advances it without spending the move', () => {
    const state = main(game())
    put(state.players[0], 0, 'vineshon', { energy: 1 })
    put(state.players[1], 0, 'blob', { hp: 50, stance: 'withdrawn' })
    const advanced = use(state, 'vine_whip')
    expect(advanced.players[1].field[0]).toMatchObject({ hp: 30, stance: 'active' })
    expect(advanced.movedThisTurn).toBe(false)
    expect(advanced.movedSlots).toEqual([])

    const stuck = main(game())
    put(stuck.players[0], 0, 'vineshon', { energy: 1 })
    put(stuck.players[1], 0, 'blob', {
      hp: 50,
      stance: 'withdrawn',
      statuses: [{ kind: 'goo', turns: 1, skipNextTick: true }],
    })
    const goo = use(stuck, 'vine_whip')
    expect(goo.players[1].field[0]).toMatchObject({ hp: 30, stance: 'withdrawn' })

    const doomed = main(game())
    put(doomed.players[0], 0, 'vineshon', { energy: 1 })
    put(doomed.players[1], 0, 'blob', { hp: 20, stance: 'withdrawn' })
    const slain = use(doomed, 'vine_whip')
    expect(slain.players[1].field[0]).toBeNull()
    expect(slain.movedThisTurn).toBe(false)
  })

  it('burns with Burning Spear, then may deal this card 20 untyped damage', () => {
    const hit = main(game(() => 1))
    put(hit.players[0], 0, 'withered_woody', { energy: 1, equipment: [equip('shield')] })
    put(hit.players[1], 0, 'blob', { hp: 50 })
    const burned = use(hit, 'burning_spear')
    expect(burned.players[1].field[0]?.hp).toBe(20)
    expect(burned.players[1].field[0]?.statuses.some((status) => status.kind === 'burn' && status.turns === 3)).toBe(true)
    expect(burned.players[0].field[0]?.hp).toBe(70)

    const miss = main(game(() => 6))
    put(miss.players[0], 0, 'withered_woody', { energy: 1 })
    put(miss.players[1], 0, 'blob', { hp: 50 })
    const safe = use(miss, 'burning_spear')
    expect(safe.players[0].field[0]?.hp).toBe(80)
  })

  it('keeps Regrow free', () => {
    const state = main(game())
    put(state.players[0], 0, 'toxi_trap', { energy: 1, hp: 40 })
    const next = use(state, 'regrow')
    expect(next.players[0].field[0]).toMatchObject({ hp: 50, energy: 1 })
    expect(next.abilityUsesLeft).toBe(1)
  })
})
