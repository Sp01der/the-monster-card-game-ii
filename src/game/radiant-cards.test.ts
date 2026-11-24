import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { getMonster } from './catalog'
import { discardMonster } from './helpers'
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
  const printed = getMonster(defId)
  const maxHp = extra.maxHp ?? printed.maxHp
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
  state.pending = null
  state.playedCardThisTurn = false
  state.awaitingHandoff = false
  state.winner = null
  return state
}

function act(state: GameState, predicate: (candidate: GameAction) => boolean) {
  const found = listLegalActions(state).find(predicate)
  if (!found) throw new Error('Action not found')
  return applyAction(state, found)
}

function use(
  state: GameState,
  abilityId: string,
  predicate?: (candidate: Extract<GameAction, { type: 'USE_ABILITY' }>) => boolean,
) {
  return act(
    state,
    (candidate) =>
      candidate.type === 'USE_ABILITY' &&
      candidate.abilityId === abilityId &&
      (predicate ? predicate(candidate) : true),
  )
}

describe('light, ash, and rogue cards', () => {
  it('prints the six cards', () => {
    expect(getMonster('goldwind_vawk')).toMatchObject({
      points: 2,
      maxHp: 70,
      weakness: 'earth',
      goldAffinity: true,
    })
    expect(getMonster('suntouched_larner')).toMatchObject({ points: 2, maxHp: 80, weakness: 'wind' })
    expect(getMonster('lightbloom_snapatrap')).toMatchObject({
      points: 2,
      maxHp: 70,
      weakness: 'wind',
      families: ['plant'],
    })
    expect(getMonster('lightbloom_snapatrap').abilities.find((ability) => ability.id === 'regrow')).toMatchObject({
      free: true,
      cost: { require: 1, spend: 0 },
    })
    expect(getMonster('hollow_rogue')).toMatchObject({
      points: 2,
      maxHp: 70,
      weakness: 'light',
      goldAffinity: true,
      darkCharge: true,
    })
    expect(getMonster('lantern_wisp')).toMatchObject({
      points: 1,
      maxHp: 50,
      weakness: 'wind',
      families: ['light'],
    })
    expect(getMonster('lantern_wisp').abilities.map((ability) => ability.id)).toEqual([
      'searing_light',
      'gleam',
    ])
    expect(getMonster('ashling')).toMatchObject({ points: 2, maxHp: 70, weakness: 'wind' })
  })

  it('lets Gleam cleanse a withdrawn enemy while another enemy is active', () => {
    let state = main(game())
    put(state.players[0], 0, 'lantern_wisp', { energy: 1 })
    put(state.players[1], 0, 'orc')
    put(state.players[1], 1, 'blob', {
      stance: 'withdrawn',
      hp: 40,
      statuses: [{ kind: 'poison', turns: 2, skipNextTick: false }],
    })
    state = use(
      state,
      'gleam',
      (candidate) => candidate.target?.player === 1 && candidate.target.slot === 1,
    )
    expect(state.abilityUsesLeft).toBe(1)
    expect(state.players[1].field[1]?.hp).toBe(50)
    expect(state.players[1].field[1]?.statuses).toEqual([])
  })

  it('hits every Searing Light target when fewer than three exist, and asks when more do', () => {
    let few = main(game())
    put(few.players[0], 0, 'lantern_wisp', { energy: 1 })
    put(few.players[1], 0, 'orc')
    put(few.players[1], 1, 'orc', { instanceId: 'orc-b' })
    few = use(few, 'searing_light')
    expect(few.pending).toBeNull()
    expect(few.players[1].field[0]?.hp).toBe(70)
    expect(few.players[1].field[1]?.hp).toBe(70)

    let many = main(game())
    put(many.players[0], 0, 'lantern_wisp', { energy: 1 })
    for (let slot = 0; slot < 4; slot++) put(many.players[1], slot, 'orc', { instanceId: `orc-${slot}` })
    many = use(many, 'searing_light')
    expect(many.pending).toMatchObject({ kind: 'searingLight', remaining: 3 })
    for (const slot of [0, 1, 2]) {
      many = act(
        many,
        (candidate) =>
          candidate.type === 'SEARING_TARGET' && candidate.target.slot === slot && candidate.target.kind === 'monster',
      )
    }
    expect(many.pending).toBeNull()
    expect(many.players[1].field[0]?.hp).toBe(70)
    expect(many.players[1].field[3]?.hp).toBe(80)
  })

  it('cleanses any monster, and only heals equipment', () => {
    let state = main(game())
    put(state.players[0], 0, 'goldwind_vawk', { energy: 2 })
    put(state.players[1], 0, 'orc', {
      hp: 40,
      statuses: [
        { kind: 'stone', turns: 0, skipNextTick: false },
        { kind: 'burn', turns: 2, skipNextTick: false },
      ],
    })
    state = use(
      state,
      'cleansing_rites',
      (candidate) => candidate.target?.kind === 'monster' && candidate.target.player === 1,
    )
    expect(state.players[1].field[0]?.hp).toBe(70)
    expect(state.players[1].field[0]?.statuses).toEqual([])

    let gear = main(game())
    put(gear.players[0], 0, 'goldwind_vawk', { energy: 2 })
    put(gear.players[1], 0, 'orc', {
      hp: 40,
      statuses: [{ kind: 'burn', turns: 2, skipNextTick: false }],
      equipment: [{ instanceId: 'shield', defId: 'shield', hp: 10, maxHp: 30 }],
    })
    gear = use(gear, 'cleansing_rites', (candidate) => candidate.target?.kind === 'equipment')
    expect(gear.players[1].field[0]?.equipment[0]?.hp).toBe(30)
    expect(gear.players[1].field[0]?.statuses).toHaveLength(1)
    expect(gear.players[1].field[0]?.hp).toBe(40)
  })

  it('returns from Reach for the Sky and may use another ability without a team action', () => {
    let state = main(game())
    put(state.players[0], 0, 'goldwind_vawk', { energy: 2 })
    put(state.players[0], 1, 'blob')
    put(state.players[1], 0, 'blob')
    state = use(state, 'reach_for_the_sky')
    expect(state.players[0].field[0]).toBeNull()
    expect(state.players[0].ethereal?.[0]?.monster?.defId).toBe('goldwind_vawk')
    expect(state.abilityUsesLeft).toBe(0)
    state = act(
      state,
      (candidate) => candidate.type === 'RETURN_ETHEREAL' && candidate.slot === 0 && candidate.stance === 'active',
    )
    expect(state.pending).toMatchObject({ kind: 'vawkStrike', stage: 'ability' })
    state = act(state, (candidate) => candidate.type === 'VAWK_ABILITY' && candidate.abilityId === 'shining_bow')
    state = act(state, (candidate) => candidate.type === 'VAWK_TARGET' && candidate.target.player === 1)
    expect(state.pending).toBeNull()
    expect(state.abilityUsesLeft).toBe(0)
    expect(state.players[0].field[0]?.energy).toBe(1)
    expect(state.players[1].field[0]?.hp).toBe(20)
  })

  it('adds the top two cards of the chosen type and leaves the deck in order', () => {
    let state = main(game())
    put(state.players[0], 0, 'suntouched_larner', { energy: 2 })
    state.players[0].hand = []
    state.players[0].deck = [
      { instanceId: 'sword', defId: 'sword' },
      { instanceId: 'blob-a', defId: 'blob' },
      { instanceId: 'day', defId: 'daybreak' },
      { instanceId: 'orc-a', defId: 'orc' },
      { instanceId: 'shrine', defId: 'shrine_of_healing' },
    ]
    state = use(state, 'revealing_light')
    state = act(state, (candidate) => candidate.type === 'REVEAL_TYPE' && candidate.cardKind === 'monster')
    expect(state.players[0].hand.map((card) => card.defId)).toEqual(['blob', 'orc'])
    expect(state.players[0].deck.map((card) => card.defId)).toEqual(['sword', 'daybreak', 'shrine_of_healing'])
  })

  it('deals Flashbloom damage and then heals a different card', () => {
    let state = main(game())
    put(state.players[0], 0, 'lightbloom_snapatrap', { energy: 2, hp: 50 })
    put(state.players[0], 1, 'orc', { hp: 40 })
    put(state.players[1], 0, 'blob')
    state = use(state, 'flashbloom', (candidate) => candidate.target?.player === 1)
    expect(state.players[1].field[0]?.hp).toBe(30)
    expect(state.pending?.kind).toBe('flashbloomHeal')
    state = act(
      state,
      (candidate) =>
        candidate.type === 'FLASHBLOOM_HEAL' && candidate.target.player === 0 && candidate.target.slot === 1,
    )
    expect(state.players[0].field[1]?.hp).toBe(60)
    expect(state.players[0].field[0]?.hp).toBe(50)
  })

  it('regrows for free, rolls Chomp, and splashes light only when slain', () => {
    let state = main(game())
    put(state.players[0], 0, 'lightbloom_snapatrap', { hp: 40, energy: 1 })
    state = use(state, 'regrow')
    expect(state.abilityUsesLeft).toBe(1)
    expect(state.players[0].field[0]?.hp).toBe(50)

    let bite = main(game())
    put(bite.players[0], 0, 'lightbloom_snapatrap', { energy: 1 })
    put(bite.players[1], 0, 'blob')
    bite = use(bite, 'chomp')
    expect(bite.players[1].field[0]?.hp).toBe(20)

    let slain = main(game())
    put(slain.players[0], 0, 'lightbloom_snapatrap', { hp: 10 })
    put(slain.players[0], 1, 'blob')
    put(slain.players[1], 0, 'orc')
    put(slain.players[1], 1, 'blob', { stance: 'withdrawn' })
    discardMonster(slain, slain.players[0], 0, 'slain')
    expect(slain.players[0].points).toBe(4)
    expect(slain.players[1].field[0]?.hp).toBe(70)
    expect(slain.players[1].field[1]?.hp).toBe(50)

    let removed = main(game())
    put(removed.players[0], 0, 'lightbloom_snapatrap')
    put(removed.players[1], 0, 'orc')
    discardMonster(removed, removed.players[0], 0, 'removed')
    expect(removed.players[0].points).toBe(6)
    expect(removed.players[1].field[0]?.hp).toBe(80)
  })

  it('keeps HP, energy, and gold through Vanish, then doubles damage on the turn it is replayed', () => {
    let state = main(game())
    state.players[0].hand = []
    put(state.players[0], 0, 'hollow_rogue', {
      hp: 40,
      energy: 5,
      gold: 2,
      pendingEnergy: 5,
      statuses: [{ kind: 'burn', turns: 2, skipNextTick: false }],
      maxHp: 90,
      equipment: [
        { instanceId: 'sword', defId: 'sword', hp: 12, maxHp: 20 },
        { instanceId: 'rune', defId: 'resilience', hp: 30, maxHp: 30 },
      ],
    })
    put(state.players[0], 1, 'blob')
    put(state.players[1], 0, 'orc')
    state = use(state, 'vanish')
    expect(state.players[0].points).toBe(6)
    expect(state.players[0].field[0]).toBeNull()
    expect(state.players[0].discard.map((card) => card.defId)).not.toContain('sword')
    expect(state.players[0].hand.find((card) => card.defId === 'hollow_rogue')).toMatchObject({
      defId: 'hollow_rogue',
      kept: {
        hp: 40,
        maxHp: 90,
        energy: 2,
        gold: 2,
        equipment: [
          { instanceId: 'sword', defId: 'sword', hp: 12, maxHp: 20 },
          { instanceId: 'rune', defId: 'resilience', hp: 30, maxHp: 30 },
        ],
      },
    })

    state = act(state, (candidate) => candidate.type === 'PLAY_MONSTER' && candidate.stance === 'active')
    const rogue = state.players[0].field.find((monster) => monster?.defId === 'hollow_rogue')
    expect(rogue).toMatchObject({ hp: 40, maxHp: 90, energy: 2, gold: 2, pendingEnergy: 0, enteredThisTurn: true })
    expect(rogue?.statuses).toEqual([])
    expect(rogue?.equipment).toEqual([
      { instanceId: 'sword', defId: 'sword', hp: 12, maxHp: 20 },
      { instanceId: 'rune', defId: 'resilience', hp: 30, maxHp: 30 },
    ])

    let doubled = main(game())
    doubled.players[0].hand = [
      { instanceId: 'rogue', defId: 'hollow_rogue', kept: { hp: 40, energy: 1, gold: 1 } },
    ]
    put(doubled.players[1], 0, 'orc')
    doubled = act(doubled, (candidate) => candidate.type === 'PLAY_MONSTER' && candidate.stance === 'active')
    doubled = use(doubled, 'twisted_knife')
    expect(doubled.players[1].field[0]?.hp).toBe(50)

    let plain = main(game())
    put(plain.players[0], 0, 'hollow_rogue', { energy: 1 })
    put(plain.players[1], 0, 'orc')
    plain = use(plain, 'twisted_knife')
    expect(plain.players[1].field[0]?.hp).toBe(70)
  })

  it('ignores Defense with Piercing Ray', () => {
    let state = main(game())
    put(state.players[0], 0, 'suntouched_larner', { energy: 1 })
    put(state.players[1], 0, 'orc')
    state = use(state, 'piercing_ray')
    expect(state.players[1].field[0]?.hp).toBe(60)
  })

  it('grows whenever a card takes fire damage, and Sudden Blaze burns after untyped damage', () => {
    let state = main(game())
    put(state.players[0], 0, 'ashling', { energy: 1 })
    put(state.players[1], 0, 'ashling', { instanceId: 'ash', hp: 20 })
    state = use(state, 'ember_punch')
    expect(state.players[0].field[0]).toMatchObject({ hp: 80, maxHp: 80 })
    expect(state.players[1].field[0]).toMatchObject({ hp: 10, maxHp: 80 })

    let blaze = main(game())
    put(blaze.players[0], 0, 'ashling', { energy: 2, hp: 20 })
    put(blaze.players[0], 1, 'blob')
    put(blaze.players[1], 0, 'orc')
    blaze = use(blaze, 'sudden_blaze')
    expect(blaze.players[0].field[0]).toBeNull()
    expect(blaze.players[0].points).toBe(4)
    expect(blaze.players[0].field[1]?.statuses.map((status) => status.kind)).toEqual(['burn'])
    expect(blaze.players[1].field[0]?.statuses.map((status) => status.kind)).toEqual(['burn'])
    expect(blaze.pending).toBeNull()

    let choice = main(game())
    put(choice.players[0], 0, 'ashling', { energy: 2 })
    put(choice.players[0], 1, 'blob')
    put(choice.players[0], 2, 'blob', { instanceId: 'b2' })
    put(choice.players[1], 0, 'orc')
    put(choice.players[1], 1, 'orc', { instanceId: 'orc-b' })
    choice = use(choice, 'sudden_blaze')
    expect(choice.players[0].field[0]).toMatchObject({ hp: 40, maxHp: 70 })
    expect(choice.pending).toMatchObject({ kind: 'burnCards', remaining: 3 })
  })

  it('grows from every-elemental attacks, including Yentir', () => {
    let state = main(game())
    put(state.players[0], 0, 'elemental_summoner', { energy: 2 })
    put(state.players[0], 1, 'ashling', { instanceId: 'ash' })
    put(state.players[1], 0, 'blob', { hp: 100, maxHp: 100 })
    state = use(
      state,
      'elemental_blast',
      (candidate) => candidate.target?.player === 1 && candidate.target.slot === 0,
    )
    expect(state.players[0].field[1]).toMatchObject({ hp: 80, maxHp: 80 })

    let yentir = main(game())
    put(yentir.players[0], 0, 'blob', {
      energy: 1,
      equipment: [{ instanceId: 'y', defId: 'yentir_starforged', hp: 0, maxHp: 0 }],
    })
    put(yentir.players[0], 1, 'ashling', { instanceId: 'ash' })
    put(yentir.players[1], 0, 'blob', { hp: 100, maxHp: 100 })
    yentir = use(
      yentir,
      'wakkle',
      (candidate) => candidate.target?.player === 1 && candidate.target.slot === 0,
    )
    expect(yentir.players[0].field[1]).toMatchObject({ hp: 80, maxHp: 80 })
  })
})
