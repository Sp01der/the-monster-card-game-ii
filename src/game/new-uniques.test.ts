import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { cardMatchesSearchType, getCard, getMonster, hasGoldAffinity, isPlunderer } from './catalog'
import { adjustedCost } from './damage'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { GameState, PlayerState } from './types'

function game(rng: () => number = () => 1): GameState {
  const state = createGame(
    [
      { name: 'P1', cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'], topMonsterIndex: 0 },
      { name: 'P2', cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'], topMonsterIndex: 0 },
    ],
    { skipHandoff: true, rng },
  )
  state.players[0]!.isFirstTurn = false
  state.players[0]!.hasFinishedFirstTurn = true
  state.players[1]!.isFirstTurn = false
  state.players[1]!.hasFinishedFirstTurn = true
  state.phase = 'main'
  state.abilityUsesLeft = 1
  state.rng = rng
  return state
}

function put(
  player: PlayerState,
  slot: number,
  defId: string,
  extra: Partial<NonNullable<PlayerState['field'][0]>> = {},
) {
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

describe('new uniques', () => {
  it('prints the new Unique cards and plunderer families', () => {
    expect(getMonster('harry_the_hero')).toMatchObject({ points: 4, maxHp: 120, unique: true })
    expect(getMonster('horror_of_the_deep')).toMatchObject({ points: 6, maxHp: 300, unique: true })
    expect(getMonster('tenilius_icilius')).toMatchObject({
      points: 2,
      maxHp: 100,
      unique: true,
      weakness: 'fire',
    })
    expect(getMonster('gorruk_warchieftan')).toMatchObject({
      points: 4,
      maxHp: 140,
      defense: 1,
      unique: true,
      goldAffinity: true,
      families: ['orc'],
    })
    expect(getMonster('orc').families).toContain('orc')
    expect(getMonster('goblin_magician').families).toContain('goblin')
    expect(getMonster('loot_goblin').families).toContain('goblin')
    expect(getMonster('hill_troll').families).toContain('troll')
    expect(isPlunderer('gorruk_warchieftan')).toBe(true)
    expect(cardMatchesSearchType('orc', 'orc')).toBe(true)
    expect(cardMatchesSearchType('goblin_magician', 'goblin')).toBe(true)
    expect(cardMatchesSearchType('loot_goblin', 'goblin')).toBe(true)
    expect(cardMatchesSearchType('hill_troll', 'troll')).toBe(true)
    expect(cardMatchesSearchType('gorruk_warchieftan', 'orc')).toBe(true)
    expect(cardMatchesSearchType('blob', 'orc')).toBe(false)
    const yentir = getCard('yentir_starforged')
    expect(yentir.kind).toBe('equipment')
    if (yentir.kind === 'equipment') expect(yentir.specialText).toContain('lose 1 point')
  })

  it('loses a point when Yentir is played', () => {
    const state = game()
    put(state.players[0]!, 0, 'blob')
    put(state.players[1]!, 0, 'blob')
    state.players[0]!.hand.push({ instanceId: 'yentir', defId: 'yentir_starforged' })
    const index = state.players[0]!.hand.findIndex((card) => card.defId === 'yentir_starforged')
    state.players[0]!.points = 1
    const next = applyAction(state, { type: 'PLAY_EQUIPMENT', handIndex: index, slot: 0 })
    expect(next.players[0]!.points).toBe(0)
    expect(next.winner).toBe(1)
    expect(next.players[0]!.field[0]?.equipment[0]?.defId).toBe('yentir_starforged')
  })

  it('rolls Really BIG Axe and then gives energy from Golden Energy', () => {
    let state = game(() => 6)
    put(state.players[0]!, 0, 'harry_the_hero', { energy: 4 })
    put(state.players[1]!, 0, 'blob', { hp: 100, maxHp: 100 })
    state = applyAction(
      state,
      listLegalActions(state).find(
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'really_big_axe',
      )!,
    )
    expect(state.players[1]!.field[0]?.hp).toBe(40)

    state = game(() => 1)
    put(state.players[0]!, 0, 'harry_the_hero', { energy: 4 })
    put(state.players[1]!, 0, 'blob', { hp: 100, maxHp: 100 })
    state.players[1]!.field[0]!.equipment = [
      { instanceId: 'sword', defId: 'sword', hp: 30, maxHp: 30 },
    ]
    state = applyAction(
      state,
      listLegalActions(state).find(
        (a) =>
          a.type === 'USE_ABILITY' &&
          a.abilityId === 'golden_energy' &&
          a.target?.kind === 'monster' &&
          a.target.slot === 0,
      )!,
    )
    expect(state.players[1]!.field[0]?.hp).toBe(40)
    expect(state.pending).toMatchObject({ kind: 'goldenEnergy' })
    state = applyAction(state, {
      type: 'GOLDEN_ENERGY',
      target: { kind: 'equipment', player: 1, slot: 0, equipmentIndex: 0 },
    })
    expect(state.players[1]!.field[0]?.energy).toBe(1)
    expect(state.pending).toBeNull()
  })

  it('lets Monsters & Elements skip the play and still deal every elemental type', () => {
    let state = game()
    put(state.players[0]!, 0, 'harry_the_hero', { energy: 2 })
    put(state.players[1]!, 0, 'blob', { hp: 100, maxHp: 100 })
    state = applyAction(
      state,
      listLegalActions(state).find(
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'monsters_and_elements',
      )!,
    )
    expect(state.pending).toMatchObject({ kind: 'playCards', freePlay: true, monstersOnly: true })
    state = applyAction(state, { type: 'PORTAL_FINISH' })
    expect(state.pending).toMatchObject({ kind: 'elementalStrike' })
    state = applyAction(
      state,
      listLegalActions(state).find((a) => a.type === 'ELEMENTAL_STRIKE')!,
    )
    // Blob is weak to water, so the one all-type hit is 40 × 1.5 = 60.
    expect(state.players[1]!.field[0]?.hp).toBe(40)
    expect(state.pending).toBeNull()
  })

  it('rolls Paralyzing Fear on each Shadows Rising hit and drags a withdrawn monster', () => {
    let state = game(() => 1)
    put(state.players[0]!, 0, 'horror_of_the_deep', { energy: 1 })
    put(state.players[1]!, 0, 'blob', { hp: 100, maxHp: 100 })
    state = applyAction(
      state,
      listLegalActions(state).find(
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'shadows_rising',
      )!,
    )
    state = applyAction(
      state,
      listLegalActions(state).find((a) => a.type === 'PENDING_TARGET')!,
    )
    expect(state.players[1]!.field[0]?.hp).toBe(90)
    expect(state.players[1]!.field[0]?.stance).toBe('withdrawn')
    expect(state.players[1]!.field[0]?.paralyzedBy).toBe(0)
    expect(state.pending).toMatchObject({ kind: 'multiHit', remaining: 2 })

    state = game(() => 6)
    put(state.players[0]!, 0, 'horror_of_the_deep', { energy: 2 })
    put(state.players[1]!, 0, 'blob', { hp: 100, maxHp: 100, stance: 'withdrawn' })
    state = applyAction(
      state,
      listLegalActions(state).find(
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'dragged_to_the_deep',
      )!,
    )
    state = applyAction(
      state,
      listLegalActions(state).find((a) => a.type === 'DRAGGED_DEEP')!,
    )
    expect(state.players[1]!.field[0]?.stance).toBe('active')
    expect(state.players[1]!.field[0]?.hp).toBe(60)
    expect(state.players[1]!.field[0]?.paralyzedBy).toBeUndefined()
  })

  it('makes Feed the Beast hit one card for each player', () => {
    let state = game(() => 6)
    put(state.players[0]!, 0, 'horror_of_the_deep', { energy: 3, hp: 300, maxHp: 300 })
    put(state.players[1]!, 0, 'blob', { hp: 100, maxHp: 100 })
    state = applyAction(
      state,
      listLegalActions(state).find(
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'feed_the_beast',
      )!,
    )
    expect(state.pending).toMatchObject({ kind: 'feedBeast' })
    const first = listLegalActions(state).find((a) => a.type === 'FEED_BEAST')!
    state = applyAction(state, first)
    const second = listLegalActions(state).find((a) => a.type === 'FEED_BEAST')!
    state = applyAction(state, second)
    expect(state.pending).toBeNull()
    expect(state.players[0]!.field[0]?.hp).toBe(220)
    expect(state.players[1]!.field[0]?.hp).toBe(20)
  })

  it('adds a filled energy cost with Chilling Winds and gains spent energy with Aqua Nova', () => {
    let state = game()
    put(state.players[0]!, 0, 'blob', { energy: 1 })
    put(state.players[1]!, 0, 'tenilius_icilius')
    state = applyAction(
      state,
      listLegalActions(state).find((a) => a.type === 'USE_ABILITY' && a.abilityId === 'wakkle')!,
    )
    expect(state.players[1]!.field[0]?.energy).toBe(1)

    state = game()
    put(state.players[0]!, 0, 'tenilius_icilius', { energy: 3 })
    put(state.players[1]!, 0, 'orc', { energy: 1 })
    state = applyAction(
      state,
      listLegalActions(state).find(
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'chilling_winds',
      )!,
    )
    const orc = state.players[1]!.field[0]!
    expect(orc.chillSpendUntil).toBe(0)
    expect(adjustedCost(orc, { require: 0, spend: 1 })).toEqual({ require: 0, spend: 2 })
  })

  it('gives plunderers Warcry damage, a free use, gold, and Gold Affinity', () => {
    let state = game(() => 1)
    put(state.players[0]!, 0, 'gorruk_warchieftan', { energy: 3 })
    put(state.players[0]!, 1, 'orc')
    put(state.players[1]!, 0, 'blob', { hp: 100, maxHp: 100 })
    expect(hasGoldAffinity(state.players[0]!.field[1]!, state)).toBe(true)
    state = applyAction(
      state,
      listLegalActions(state).find((a) => a.type === 'USE_ABILITY' && a.abilityId === 'warcry')!,
    )
    expect(state.players[0]!.tribeAttackBonus).toBe(10)
    expect(state.pending).toMatchObject({ kind: 'warcryPick' })
    state = applyAction(state, { type: 'WARCRY_PICK', slot: 1 })
    expect(state.players[0]!.field[1]?.extraAbilityUses).toBe(1)
    expect(state.pending).toBeNull()

    state = game(() => 1)
    put(state.players[0]!, 0, 'gorruk_warchieftan', { energy: 2 })
    put(state.players[1]!, 0, 'blob', { hp: 100, maxHp: 100 })
    state = applyAction(
      state,
      listLegalActions(state).find(
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'dragonbone_spear',
      )!,
    )
    expect(state.players[1]!.field[0]?.hp).toBe(70)
    expect(state.players[0]!.field[0]?.gold).toBe(1)
  })

  it('freezes up to three monsters with Deep Freeze and only damages equipment', () => {
    let state = game()
    put(state.players[0]!, 0, 'tenilius_icilius', { energy: 5 })
    put(state.players[0]!, 1, 'orc', { hp: 80, maxHp: 80 })
    put(state.players[1]!, 0, 'blob', { hp: 100, maxHp: 100 })
    state.players[1]!.field[0]!.equipment = [
      { instanceId: 'sword', defId: 'sword', hp: 30, maxHp: 30 },
    ]
    state = applyAction(
      state,
      listLegalActions(state).find(
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'deep_freeze',
      )!,
    )
    expect(state.pending).toMatchObject({ kind: 'deepFreeze', remaining: 3 })
    state = applyAction(state, {
      type: 'DEEP_FREEZE',
      target: { kind: 'equipment', player: 1, slot: 0, equipmentIndex: 0 },
    })
    state = applyAction(state, {
      type: 'DEEP_FREEZE',
      target: { kind: 'monster', player: 0, slot: 1 },
    })
    state = applyAction(state, {
      type: 'DEEP_FREEZE',
      target: { kind: 'monster', player: 1, slot: 0 },
    })
    expect(state.pending).toBeNull()
    expect(state.players[0]!.field[1]?.statuses.some((status) => status.kind === 'frozen')).toBe(true)
    expect(state.players[1]!.field[0]?.statuses.some((status) => status.kind === 'frozen')).toBe(true)
    expect(state.players[1]!.field[0]?.equipment[0]?.hp).toBe(20)
  })

  it('clears Paralyzing Fear and Chilling Winds when that player starts a turn', () => {
    let state = game()
    put(state.players[0]!, 0, 'horror_of_the_deep')
    put(state.players[1]!, 0, 'blob')
    state.players[1]!.field[0]!.paralyzedBy = 0
    state.players[1]!.field[0]!.chillSpendUntil = 0
    for (const player of state.players) player.hand = []
    state.phase = 'end'
    state.awaitingHandoff = false
    state = applyAction(state, { type: 'END_TURN' })
    expect(state.activePlayer).toBe(1)
    expect(state.players[1]!.field[0]?.paralyzedBy).toBe(0)
    expect(state.players[1]!.field[0]?.chillSpendUntil).toBe(0)
    state.phase = 'end'
    state.awaitingHandoff = false
    state.endStepResolved = false
    state = applyAction(state, { type: 'END_TURN' })
    expect(state.activePlayer).toBe(0)
    expect(state.players[1]!.field[0]?.paralyzedBy).toBeUndefined()
    expect(state.players[1]!.field[0]?.chillSpendUntil).toBeUndefined()
  })
})
