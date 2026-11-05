import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { cardMatchesSearchType, getCard, getMonster } from './catalog'
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

function main(state: GameState, active: 0 | 1 = 0): GameState {
  state.phase = 'main'
  state.activePlayer = active
  state.players[0].isFirstTurn = false
  state.players[0].hasFinishedFirstTurn = true
  state.players[1].isFirstTurn = false
  state.players[1].hasFinishedFirstTurn = true
  state.abilityUsesLeft = 1
  state.actedSlots = []
  state.movedSlots = []
  state.pending = null
  state.playedCardThisTurn = false
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

describe('bone and rift cards', () => {
  it('prints the new cards', () => {
    expect(getMonster('boneling')).toMatchObject({ points: 0, maxHp: 30, darkCharge: true })
    expect(getMonster('boneling').weakness).toBeUndefined()
    expect(getMonster('keeper_of_the_catacombs')).toMatchObject({ points: 2, maxHp: 100, darkCharge: true })
    expect(getMonster('keeper_of_the_catacombs').weakness).toBeUndefined()
    expect(getMonster('skeleton_mage')).toMatchObject({ points: 3, maxHp: 100, darkCharge: true })
    expect(getMonster('skeleton_mage').weakness).toBeUndefined()
    expect(getMonster('skeleton_mage').abilities.find((ability) => ability.id === 'anti_heal')?.ranged).toBe(true)
    expect(getCard('darklight_portal')).toMatchObject({ kind: 'effect', effectId: 'darklightPortal' })
    expect(getCard('runestone_fires')).toMatchObject({ kind: 'effect', effectId: 'runestoneFires' })
    expect(getCard('eye_of_the_rift')).toMatchObject({ kind: 'effect', name: "Eye o' the Rift", effectId: 'eyeOfTheRift' })
    expect(cardMatchesSearchType('boneling', 'shadow')).toBe(true)
    expect(cardMatchesSearchType('skeleton_mage', 'shadow')).toBe(true)
    expect(cardMatchesSearchType('keeper_of_the_catacombs', 'dark_charge')).toBe(true)
    expect(cardMatchesSearchType('skeleton_mage', 'dark_charge')).toBe(true)
  })

  it('plays a Boneling active only, and locks the opponent onto your Bonelings', () => {
    const state = main(game())
    state.players[0].hand = [{ instanceId: 'bone-hand', defId: 'boneling' }]
    const plays = listLegalActions(state).filter(
      (candidate) => candidate.type === 'PLAY_MONSTER' && candidate.handIndex === 0,
    )
    expect(plays.every((candidate) => candidate.type === 'PLAY_MONSTER' && candidate.stance === 'active')).toBe(true)
    expect(plays.some((candidate) => candidate.type === 'PLAY_MONSTER' && candidate.stance === 'withdrawn')).toBe(false)

    put(state.players[0], 0, 'boneling', { energy: 1 })
    put(state.players[0], 1, 'horned')
    put(state.players[1], 0, 'blob', { energy: 1 })
    const enemyStabs = listLegalActions(main(state, 1)).filter(
      (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'wakkle',
    )
    expect(enemyStabs).toHaveLength(1)
    expect(enemyStabs[0]).toMatchObject({ target: monsterTarget(0, 0) })

    const yours = main(game())
    put(yours.players[0], 0, 'boneling')
    put(yours.players[0], 1, 'horned', { hp: 40 })
    put(yours.players[1], 0, 'boneling')
    put(yours.players[1], 1, 'horned', { hp: 40 })
    yours.players[0].hand = [{ instanceId: 'potion', defId: 'health_potion' }]
    const heals = listLegalActions(yours).filter((candidate) => candidate.type === 'PLAY_EFFECT')
    const keys = heals.map((candidate) =>
      candidate.type === 'PLAY_EFFECT' ? candidate.targets.map((target) => `${target.player}-${target.slot}`).join(',') : '',
    )
    expect(keys).toContain('0-1')
    expect(keys).toContain('1-0')
    expect(keys).toContain('1-1')
  })

  it('lets ranged and any-card attacks target non-Bonelings while Bonelings are in play', () => {
    const state = main(game())
    put(state.players[0], 0, 'boneling')
    put(state.players[0], 1, 'horned')
    put(state.players[1], 0, 'skeleton_mage', { energy: 1 })
    const shots = listLegalActions(main(state, 1)).filter(
      (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'anti_heal',
    )
    expect(shots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: monsterTarget(0, 0) }),
        expect.objectContaining({ target: monsterTarget(0, 1) }),
      ]),
    )
    expect(shots).toHaveLength(2)

    put(state.players[1], 0, 'molika', { energy: 2 })
    const underground = listLegalActions(main(state, 1)).filter(
      (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'underground',
    )
    expect(underground).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: monsterTarget(0, 0) }),
        expect.objectContaining({ target: monsterTarget(0, 1) }),
      ]),
    )

    put(state.players[1], 0, 'blob', { energy: 1 })
    state.players[1].hand = [{ instanceId: 'archer', defId: 'long_range_archer' }]
    const archer = listLegalActions(main(state, 1)).filter(
      (candidate) => candidate.type === 'PLAY_EFFECT',
    )
    const keys = archer.map((candidate) =>
      candidate.type === 'PLAY_EFFECT'
        ? candidate.targets.map((target) => `${target.player}-${target.slot}`).join(',')
        : '',
    )
    expect(keys).toContain('0-0')
    expect(keys).toContain('0-1')

    const melee = listLegalActions(main(state, 1)).filter(
      (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'wakkle',
    )
    expect(melee).toHaveLength(1)
    expect(melee[0]).toMatchObject({ target: monsterTarget(0, 0) })
  })

  it('kills a Boneling that would withdraw, and leaves a stuck Boneling alone', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob')
    put(state.players[0], 1, 'boneling')
    state.players[0].hand = [{ instanceId: 'march', defId: 'quick_march' }]
    const marching = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'PLAY_EFFECT' && candidate.handIndex === 0),
    )
    const finished = applyAction(
      applyAction(marching, { type: 'MARCH_TOGGLE', slot: 1 }),
      { type: 'MARCH_FINISH' },
    )
    expect(finished.players[0].field[1]).toBeNull()
    expect(finished.players[0].discard.some((card) => card.defId === 'boneling')).toBe(true)
    expect(finished.players[0].field[0]?.stance).toBe('active')

    const stuck = main(game())
    put(stuck.players[0], 0, 'stormling', { energy: 2 })
    put(stuck.players[1], 0, 'boneling', {
      hp: 80,
      statuses: [{ kind: 'goo', turns: 1, skipNextTick: false }],
    })
    put(stuck.players[1], 1, 'blob')
    const blasted = use(stuck, 'gale', (candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.player === 1)
    expect(blasted.pending).toBeNull()
    expect(blasted.players[1].field[0]?.stance).toBe('active')
    expect(blasted.players[1].field[0]?.hp).toBe(50)

    const forced = main(game())
    put(forced.players[0], 0, 'stormling', { energy: 2 })
    put(forced.players[1], 0, 'boneling', { hp: 80 })
    put(forced.players[1], 1, 'blob')
    const choosing = use(forced, 'gale', (candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.player === 1)
    expect(choosing.pending?.kind).toBe('forceWithdraw')
    const dead = applyAction(choosing, { type: 'FORCE_WITHDRAW', accept: true })
    expect(dead.players[1].field[0]).toBeNull()
    expect(dead.players[1].discard.some((card) => card.defId === 'boneling')).toBe(true)
    expect(dead.players[1].field[1]).toBeTruthy()
  })

  it('destroys a discarded card and places an active Boneling, growing a slot when the row is full', () => {
    const state = main(game())
    put(state.players[0], 0, 'keeper_of_the_catacombs', { energy: 1 })
    put(state.players[1], 0, 'blob')
    expect(listLegalActions(state).some((candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'bring_forth_the_dead')).toBe(false)
    state.players[0].discard = [{ instanceId: 'gone', defId: 'blob' }]
    const bringing = use(state, 'bring_forth_the_dead')
    expect(bringing.pending?.kind).toBe('bringForth')
    const placing = applyAction(bringing, { type: 'CATACOMB_PICK', instanceId: 'gone' })
    expect(placing.players[0].removed.map((card) => card.instanceId)).toContain('gone')
    expect(placing.players[0].discard).toHaveLength(0)
    expect(placing.pending).toMatchObject({ kind: 'placeBoneling', remaining: 1 })
    const placed = applyAction(placing, { type: 'PLACE_BONELING', slot: 1 })
    expect(placed.pending).toBeNull()
    expect(placed.players[0].field[1]).toMatchObject({ defId: 'boneling', stance: 'active', hp: 30 })

    const full = main(game())
    put(full.players[0], 0, 'keeper_of_the_catacombs', { energy: 1 })
    for (let slot = 1; slot < full.players[0].field.length; slot++) put(full.players[0], slot, 'blob')
    put(full.players[1], 0, 'blob')
    full.players[0].discard = [{ instanceId: 'gone-2', defId: 'coffee' }]
    const fullBring = use(full, 'bring_forth_the_dead')
    const fullPlace = applyAction(fullBring, { type: 'CATACOMB_PICK', instanceId: 'gone-2' })
    const grew = applyAction(
      fullPlace,
      action(fullPlace, (candidate) => candidate.type === 'PLACE_BONELING'),
    )
    expect(grew.players[0].field.at(-1)).toMatchObject({ defId: 'boneling', stance: 'active', ownsExtraSlot: true })
  })

  it('summons two active Bonelings and spends three energy', () => {
    const state = main(game())
    put(state.players[0], 0, 'skeleton_mage', { energy: 3 })
    put(state.players[1], 0, 'blob')
    const placing = use(state, 'summon_bonelings')
    expect(placing.pending).toMatchObject({ kind: 'placeBoneling', remaining: 2 })
    expect(placing.players[0].field[0]?.energy).toBe(0)
    const first = applyAction(placing, { type: 'PLACE_BONELING', slot: 1 })
    const second = applyAction(first, { type: 'PLACE_BONELING', slot: 2 })
    expect(second.pending).toBeNull()
    expect(second.abilityUsesLeft).toBe(0)
    expect(second.players[0].field[1]).toMatchObject({ defId: 'boneling', stance: 'active' })
    expect(second.players[0].field[2]).toMatchObject({ defId: 'boneling', stance: 'active' })
  })

  it('stacks permanent shadow damage on attacks a monster deals', () => {
    const state = main(game())
    put(state.players[0], 0, 'skeleton_mage', { energy: 1 })
    put(state.players[0], 1, 'boneling', { energy: 1 })
    put(state.players[1], 0, 'blob', { hp: 80 })
    expect(listLegalActions(state).some((candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'cloud_of_darkness')).toBe(false)
    state.players[0].discard = [
      { instanceId: 'ash-1', defId: 'blob' },
      { instanceId: 'ash-2', defId: 'coffee' },
    ]
    const choosing = use(state, 'cloud_of_darkness')
    expect(choosing.players[0].field[0]?.energy).toBe(1)
    const skipped = applyAction(choosing, { type: 'CLOUD_FINISH' })
    expect(skipped.pending).toBeNull()
    expect(skipped.players[0].discard).toHaveLength(2)

    const again = main(game())
    put(again.players[0], 0, 'skeleton_mage', { energy: 1 })
    put(again.players[0], 1, 'boneling', { energy: 1 })
    put(again.players[1], 0, 'blob', { hp: 80 })
    again.players[0].discard = [
      { instanceId: 'ash-1', defId: 'blob' },
      { instanceId: 'ash-2', defId: 'coffee' },
    ]
    const open = use(again, 'cloud_of_darkness')
    const marked = applyAction(
      applyAction(open, { type: 'CLOUD_TOGGLE', instanceId: 'ash-1' }),
      { type: 'CLOUD_TOGGLE', instanceId: 'ash-2' },
    )
    const blessing = applyAction(marked, { type: 'CLOUD_FINISH' })
    expect(blessing.players[0].removed.map((card) => card.instanceId).sort()).toEqual(['ash-1', 'ash-2'])
    expect(blessing.pending).toMatchObject({ kind: 'cloudBless', remaining: 2 })
    const once = applyAction(blessing, { type: 'CLOUD_BLESS', target: monsterTarget(0, 1) })
    const twice = applyAction(once, { type: 'CLOUD_BLESS', target: monsterTarget(0, 1) })
    expect(twice.pending).toBeNull()
    expect(twice.players[0].field[1]?.shadowBonus).toBe(20)
    twice.abilityUsesLeft = 1
    twice.actedSlots = []
    const hit = use(twice, 'hollow_scratch', (candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.player === 1)
    expect(hit.players[1].field[0]?.hp).toBe(40)
    expect(hit.players[0].field[1]?.shadowBonus).toBe(20)
  })

  it('lets Anti-heal strike while withdrawn and ignore defense', () => {
    const fromBack = main(game())
    put(fromBack.players[0], 0, 'skeleton_mage', { energy: 1, stance: 'withdrawn' })
    put(fromBack.players[1], 0, 'blob', { hp: 80 })
    const backHit = use(fromBack, 'anti_heal')
    expect(backHit.players[1].field[0]?.hp).toBe(50)

    const intoBack = main(game())
    put(intoBack.players[0], 0, 'skeleton_mage', { energy: 1 })
    put(intoBack.players[1], 0, 'blob', { hp: 80, stance: 'withdrawn' })
    const frontHit = use(intoBack, 'anti_heal')
    expect(frontHit.players[1].field[0]?.hp).toBe(50)
    expect(frontHit.players[1].field[0]?.stance).toBe('withdrawn')

    const armored = main(game())
    put(armored.players[0], 0, 'skeleton_mage', { energy: 1 })
    put(armored.players[1], 0, 'orc', { hp: 80 })
    const pierced = use(armored, 'anti_heal')
    expect(pierced.players[1].field[0]?.hp).toBe(50)
  })

  it('sets one monster to 0 HP and gives another energy and an extra action', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob')
    put(state.players[0], 1, 'boneling')
    put(state.players[1], 0, 'blob')
    state.players[0].hand = [{ instanceId: 'fires', defId: 'runestone_fires' }]
    const resolved = applyAction(state, {
      type: 'PLAY_EFFECT',
      handIndex: 0,
      targets: [monsterTarget(0, 0), monsterTarget(0, 1)],
    })
    expect(resolved.players[0].field[0]).toBeNull()
    expect(resolved.players[0].discard.some((card) => card.defId === 'blob')).toBe(true)
    expect(resolved.players[0].field[1]).toMatchObject({ energy: 3, extraAbilityUses: 1, hp: 30 })

    const endure = main(game())
    put(endure.players[0], 0, 'unending_legionary', { unending: true, hp: 80 })
    put(endure.players[0], 1, 'boneling')
    put(endure.players[1], 0, 'blob')
    endure.players[0].hand = [{ instanceId: 'fires-2', defId: 'runestone_fires' }]
    const saved = applyAction(endure, {
      type: 'PLAY_EFFECT',
      handIndex: 0,
      targets: [monsterTarget(0, 0), monsterTarget(0, 1)],
    })
    expect(saved.players[0].field[0]).toMatchObject({ defId: 'unending_legionary', hp: 10, stance: 'active' })
    expect(saved.players[0].field[1]).toMatchObject({ energy: 3, extraAbilityUses: 1 })
  })

  it('plays one discarded card as part of Darklight Portal', () => {
    const empty = main(game())
    put(empty.players[0], 0, 'blob')
    empty.players[0].hand = [{ instanceId: 'portal', defId: 'darklight_portal' }]
    const nothing = applyAction(empty, { type: 'PLAY_EFFECT', handIndex: 0, targets: [] })
    expect(nothing.pending).toBeNull()
    expect(nothing.playedCardThisTurn).toBe(true)
    expect(nothing.players[0].discard.map((card) => card.defId)).toEqual(['darklight_portal'])

    const state = main(game())
    put(state.players[0], 0, 'blob', { energy: 0 })
    put(state.players[1], 0, 'blob')
    state.players[0].hand = [
      { instanceId: 'portal', defId: 'darklight_portal' },
      { instanceId: 'potion', defId: 'health_potion' },
    ]
    state.players[0].discard = [{ instanceId: 'brew', defId: 'coffee' }]
    const opened = applyAction(state, { type: 'PLAY_EFFECT', handIndex: 0, targets: [] })
    expect(opened.pending).toMatchObject({ kind: 'playCards', from: 'discard', limit: 1, played: 0 })
    expect(opened.playedCardThisTurn).toBe(true)
    const played = applyAction(
      opened,
      action(
        opened,
        (candidate) =>
          candidate.type === 'PLAY_EFFECT' &&
          candidate.fromDiscard === true &&
          candidate.targets.length === 1 &&
          candidate.targets[0].kind === 'monster' &&
          candidate.targets[0].player === 0 &&
          candidate.targets[0].slot === 0,
      ),
    )
    expect(played.pending).toBeNull()
    expect(played.playedCardThisTurn).toBe(true)
    expect(played.players[0].field[0]?.energy).toBe(3)
    expect(played.players[0].hand.map((card) => card.defId)).toEqual(['health_potion'])
    expect(played.players[0].discard.map((card) => card.defId).sort()).toEqual(['coffee', 'darklight_portal'])
    expect(listLegalActions(played).some((candidate) => candidate.type === 'PLAY_EFFECT' && !candidate.fromDiscard)).toBe(false)
  })

  it("discards any of the top cards and puts the rest back without drawing", () => {
    const state = main(game())
    put(state.players[0], 0, 'blob')
    put(state.players[1], 0, 'blob')
    const top = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ instanceId: id, defId: 'blob' }))
    state.players[0].deck = top
    state.players[0].hand = [{ instanceId: 'eye', defId: 'eye_of_the_rift' }]
    const handSize = state.players[0].hand.length
    const looking = applyAction(state, { type: 'PLAY_EFFECT', handIndex: 0, targets: [] })
    expect(looking.pending?.kind).toBe('riftEye')
    if (looking.pending?.kind !== 'riftEye') throw new Error('expected rift')
    expect(looking.pending.cards.map((card) => card.instanceId)).toEqual(['a', 'b', 'c', 'd'])
    const marked = applyAction(
      applyAction(looking, { type: 'RIFT_TOGGLE', instanceId: 'a' }),
      { type: 'RIFT_TOGGLE', instanceId: 'b' },
    )
    const ordering = applyAction(marked, { type: 'RIFT_CONFIRM' })
    expect(ordering.pending).toMatchObject({ kind: 'riftEye', stage: 'order' })
    const first = applyAction(ordering, { type: 'RIFT_ORDER', instanceId: 'd' })
    const done = applyAction(first, { type: 'RIFT_ORDER', instanceId: 'c' })
    expect(done.pending).toBeNull()
    expect(done.players[0].deck.map((card) => card.instanceId)).toEqual(['d', 'c', 'e', 'f'])
    expect(done.players[0].discard.map((card) => card.instanceId)).toEqual(['eye', 'a', 'b'])
    expect(done.players[0].hand).toHaveLength(handSize - 1)

    const short = main(game())
    put(short.players[0], 0, 'blob')
    short.players[0].deck = [
      { instanceId: 'only-1', defId: 'blob' },
      { instanceId: 'only-2', defId: 'coffee' },
    ]
    short.players[0].hand = [{ instanceId: 'eye-2', defId: 'eye_of_the_rift' }]
    const shortLook = applyAction(short, { type: 'PLAY_EFFECT', handIndex: 0, targets: [] })
    const shortDone = applyAction(
      applyAction(
        applyAction(shortLook, { type: 'RIFT_TOGGLE', instanceId: 'only-2' }),
        { type: 'RIFT_CONFIRM' },
      ),
      { type: 'RIFT_ORDER', instanceId: 'only-1' },
    )
    expect(shortDone.players[0].deck.map((card) => card.instanceId)).toEqual(['only-1'])
    expect(shortDone.players[0].discard.map((card) => card.defId)).toEqual(['eye_of_the_rift', 'coffee'])
  })
})
