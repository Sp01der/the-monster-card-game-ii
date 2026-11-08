import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import {
  cardMatchesSearchType,
  countsAsElectricCard,
  countsAsPoisonCard,
  getCard,
} from './catalog'
import { applyAction } from './reducer'
import { createGame } from './setup'
import { destroyEquipment } from './helpers'
import type { FieldMonster, GameAction, GameState, PlayerState } from './types'
import { abilityLines, withBladeCost } from '../ui/cardText'

function game(): GameState {
  return createGame(
    { name: 'P1', cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'], topMonsterIndex: 0 },
    { name: 'P2', cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'], topMonsterIndex: 0 },
    { skipHandoff: true, shuffleRandom: () => 0, rng: () => 1 },
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
  return state
}

function action(state: GameState, predicate: (candidate: GameAction) => boolean): GameAction {
  const found = listLegalActions(state).find(predicate)
  if (!found) throw new Error('Action not found')
  return found
}

const sword = { instanceId: 'sword', defId: 'sword', hp: 30, maxHp: 30 }
const stone = (defId: string) => ({ instanceId: defId, defId, hp: 20, maxHp: 20 })

describe('runestones, tomes, and blobs', () => {
  it('treats every elemental type as one hit', () => {
    const state = main(game())
    put(state.players[0], 0, 'starbeam_elemental', { energy: 1, shadowBonus: 10 })
    put(state.players[1], 0, 'blue_blob')
    const next = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'elemental_shard'),
    )
    // 20 + 10 shadow, weakness once (×1.5 → 50), defense once (−10) = 40.
    expect(next.players[1].field[0]?.hp).toBe(30)
    expect(cardMatchesSearchType('starbeam_elemental', 'fire')).toBe(true)
    expect(cardMatchesSearchType('starbeam_elemental', 'poison')).toBe(true)
    expect(countsAsElectricCard('starbeam_elemental')).toBe(true)
    expect(countsAsPoisonCard('starbeam_elemental')).toBe(true)

    const extreme = main(game())
    put(extreme.players[0], 0, 'starbeam_elemental', { energy: 1 })
    put(extreme.players[1], 0, 'lovnis_weed', { hp: 60, maxHp: 60 })
    const doubled = applyAction(
      extreme,
      action(extreme, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'elemental_shard'),
    )
    expect(doubled.players[1].field[0]?.hp).toBe(20)
  })

  it('searches the deck and then plays any monster for free', () => {
    const state = main(game())
    put(state.players[0], 0, 'elemental_summoner', { energy: 2 })
    put(state.players[1], 0, 'blob')
    state.players[0].deck = [
      { instanceId: 'potion', defId: 'health_potion' },
      { instanceId: 'plant', defId: 'snapatrap' },
      { instanceId: 'red', defId: 'red_blob' },
    ]
    state.players[0].hand = [{ instanceId: 'spare', defId: 'blob' }]
    const choosing = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'summon'),
    )
    const found = applyAction(
      choosing,
      action(choosing, (candidate) => candidate.type === 'SUMMON_TYPE' && candidate.element === 'plant'),
    )
    expect(found.players[0].deck.map((card) => card.defId)).toEqual(['health_potion', 'red_blob'])
    expect(found.players[0].hand.map((card) => card.defId)).toEqual(['blob', 'snapatrap'])
    expect(found.pending).toMatchObject({ kind: 'playCards', freePlay: true, monstersOnly: true, limit: 1 })
    const played = applyAction(
      found,
      action(found, (candidate) => candidate.type === 'PLAY_MONSTER' && candidate.slot === 1),
    )
    expect(played.players[0].field[1]?.defId).toBe('blob')
    expect(played.playedCardThisTurn).toBe(false)
    expect(played.cardsPlayedThisTurn ?? 0).toBe(0)
  })

  it('remembers each effect once, including a card played from discard', () => {
    const state = main(game())
    put(state.players[0], 0, 'tomebinder_wizard', { energy: 2, hp: 100, maxHp: 100 })
    put(state.players[1], 0, 'blob')
    state.players[0].hand = [{ instanceId: 'potion', defId: 'health_potion' }]
    const first = applyAction(state, {
      type: 'PLAY_EFFECT',
      handIndex: 0,
      targets: [{ kind: 'monster', player: 0, slot: 0 }],
    })
    expect(first.players[0].field[0]?.tome).toEqual(['health_potion'])
    first.players[0].hand = [{ instanceId: 'potion2', defId: 'health_potion' }]
    first.playedCardThisTurn = false
    const second = applyAction(first, {
      type: 'PLAY_EFFECT',
      handIndex: 0,
      targets: [{ kind: 'monster', player: 0, slot: 0 }],
    })
    expect(second.players[0].field[0]?.tome).toEqual(['health_potion'])

    const dark = main(game())
    put(dark.players[0], 0, 'tomebinder_wizard', { hp: 100, maxHp: 100 })
    put(dark.players[1], 0, 'blob')
    dark.players[0].hand = [{ instanceId: 'portal', defId: 'darklight_portal' }]
    dark.players[0].discard = [{ instanceId: 'brew', defId: 'coffee' }]
    const opened = applyAction(dark, { type: 'PLAY_EFFECT', handIndex: 0, targets: [] })
    const fromDiscard = applyAction(
      opened,
      action(
        opened,
        (candidate) => candidate.type === 'PLAY_EFFECT' && candidate.fromDiscard === true,
      ),
    )
    expect(fromDiscard.players[0].field[0]?.tome).toEqual(['darklight_portal', 'coffee'])
  })

  it('casts a tome copy immediately without spending the card play, and the wizard deals the damage', () => {
    const state = main(game())
    put(state.players[0], 0, 'tomebinder_wizard', {
      energy: 2,
      hp: 100,
      maxHp: 100,
      attackBonus: 10,
      tome: ['long_range_archer'],
    })
    put(state.players[1], 0, 'blob', { hp: 80, maxHp: 80 })
    const picking = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'arcane_tome'),
    )
    const cast = applyAction(
      picking,
      action(picking, (candidate) => candidate.type === 'TOME_PICK'),
    )
    const hit = applyAction(
      cast,
      action(
        cast,
        (candidate) =>
          candidate.type === 'TOME_CAST' &&
          candidate.targets[0]?.player === 1,
      ),
    )
    expect(hit.players[1].field[0]?.hp).toBe(50)
    expect(hit.playedCardThisTurn).toBe(false)
    expect(hit.players[0].field[0]?.tome).toEqual(['long_range_archer'])
  })

  it('discards a card, then deals 40 blast and burns for 3 turns', () => {
    const state = main(game())
    put(state.players[0], 0, 'tomebinder_wizard', { energy: 2, hp: 100, maxHp: 100 })
    put(state.players[1], 0, 'blob', { hp: 50, maxHp: 50 })
    state.players[0].hand = [{ instanceId: 'spare', defId: 'blob' }]
    const discarding = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'fireball'),
    )
    const aiming = applyAction(
      discarding,
      action(discarding, (candidate) => candidate.type === 'FIREBALL_DISCARD'),
    )
    expect(aiming.players[0].discard.map((card) => card.defId)).toEqual(['blob'])
    const burned = applyAction(
      aiming,
      action(aiming, (candidate) => candidate.type === 'FIREBALL_SHOT'),
    )
    expect(burned.players[1].field[0]?.hp).toBe(10)
    expect(burned.players[1].field[0]?.statuses.find((status) => status.kind === 'burn')?.turns).toBe(3)

    const empty = main(game())
    put(empty.players[0], 0, 'tomebinder_wizard', { energy: 2, hp: 100, maxHp: 100 })
    put(empty.players[1], 0, 'blob')
    empty.players[0].hand = []
    expect(
      listLegalActions(empty).some(
        (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'fireball',
      ),
    ).toBe(false)
  })

  it('replaces a blob, keeps its equipment, and spends the card play', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', {
      stance: 'withdrawn',
      energy: 2,
      statuses: [{ kind: 'burn', turns: 2, skipNextTick: false }],
      equipment: [sword, stone('resilience')],
      maxHp: 70,
      hp: 40,
    })
    state.players[0].hand = [{ instanceId: 'big', defId: 'big_blob' }]
    expect(
      listLegalActions(state).some(
        (candidate) => candidate.type === 'PLAY_MONSTER' && candidate.handIndex === 0,
      ),
    ).toBe(false)
    const points = state.players[0].points
    const replaced = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'REPLACE_MONSTER'),
    )
    expect(replaced.players[0].points).toBe(points)
    expect(replaced.playedCardThisTurn).toBe(true)
    expect(replaced.players[0].field[0]).toMatchObject({
      defId: 'big_blob',
      stance: 'withdrawn',
      energy: 0,
      statuses: [],
      maxHp: 120,
      hp: 120,
    })
    expect(replaced.players[0].field[0]?.equipment.map((equipment) => equipment.defId)).toEqual([
      'sword',
      'resilience',
    ])
    expect(replaced.players[0].discard.map((card) => card.defId)).toEqual(['blob'])

    const opening = main(game())
    opening.players[0].isFirstTurn = true
    opening.abilityUsesLeft = 0
    put(opening.players[0], 0, 'blob')
    opening.players[0].hand = [{ instanceId: 'big', defId: 'big_blob' }]
    const openingActions = listLegalActions(opening)
    expect(openingActions.some((candidate) => candidate.type === 'PLAY_MONSTER')).toBe(false)
    expect(openingActions.some((candidate) => candidate.type === 'REPLACE_MONSTER')).toBe(true)
  })

  it('places two of the matching small blob when a big blob dies', () => {
    const red = main(game())
    put(red.players[0], 0, 'blob', { energy: 2 })
    put(red.players[1], 0, 'big_red_blob', { hp: 10, maxHp: 110 })
    const slain = applyAction(
      red,
      action(red, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'wakkle'),
    )
    expect(slain.pending).toMatchObject({ kind: 'spawnBlobs', defId: 'red_blob', remaining: 2 })
    const placed = applyAction(
      slain,
      action(slain, (candidate) => candidate.type === 'SPAWN_BLOB'),
    )
    expect(placed.players[1].field.some((monster) => monster?.defId === 'red_blob')).toBe(true)

    const blue = main(game())
    put(blue.players[0], 0, 'blob', { energy: 2 })
    put(blue.players[1], 0, 'big_blue_blob', { hp: 10, maxHp: 110 })
    const frozen = applyAction(
      blue,
      action(blue, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'wakkle'),
    )
    expect(frozen.pending).toMatchObject({ kind: 'spawnBlobs', defId: 'blue_blob' })
  })

  it('applies the three runestones and ignores attack damage', () => {
    const state = main(game())
    put(state.players[0], 0, 'runestone_enchantress', { energy: 2 })
    put(state.players[0], 1, 'blob', { hp: 10, maxHp: 50 })
    put(state.players[1], 0, 'blob')
    const choosing = applyAction(
      state,
      action(
        state,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'enchant_stone' &&
          candidate.target?.kind === 'monster' &&
          candidate.target.player === 0 &&
          candidate.target.slot === 1,
      ),
    )
    const attached = applyAction(
      choosing,
      action(choosing, (candidate) => candidate.type === 'ENCHANT_STONE' && candidate.defId === 'resilience'),
    )
    expect(attached.players[0].field[1]).toMatchObject({ maxHp: 70, hp: 40 })

    const strong = main(game())
    put(strong.players[0], 0, 'blob', { energy: 2, equipment: [stone('strength')] })
    put(strong.players[1], 0, 'blob', { hp: 50, maxHp: 50, equipment: [stone('strength')] })
    const hit = applyAction(
      strong,
      action(
        strong,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'wakkle' &&
          candidate.target?.kind === 'monster',
      ),
    )
    // 20 + 10 strength, then the defender's strength defense subtracts 10.
    expect(hit.players[1].field[0]?.hp).toBe(30)
    const gear = hit.players[1].field[0]?.equipment[0]
    expect(gear?.hp).toBe(20)

    const proof = main(game())
    put(proof.players[0], 0, 'blob', { energy: 2 })
    put(proof.players[1], 0, 'blob', { equipment: [stone('efficiency')] })
    const ignored = applyAction(
      proof,
      action(
        proof,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'wakkle' &&
          candidate.target?.kind === 'equipment',
      ),
    )
    expect(ignored.players[1].field[0]?.equipment[0]?.hp).toBe(20)
    expect(ignored.players[1].field[0]?.hp).toBe(50)

    destroyEquipment(attached, attached.players[0], 1, 0)
    expect(attached.players[0].field[1]).toMatchObject({ maxHp: 50, hp: 40 })
  })

  it('turns one filled cost into a kept cost, then stacks the lifesteal zero', () => {
    const monster = {
      instanceId: 'blob',
      defId: 'blob',
      hp: 50,
      maxHp: 50,
      stance: 'active' as const,
      energy: 1,
      pendingEnergy: 0,
      statuses: [],
      equipment: [stone('efficiency')],
    }
    const shown = withBladeCost(abilityLines(getCard('blob')), monster)
    expect(shown.find((line) => line.id === 'wakkle')?.cost).toEqual({ require: 1, spend: 0 })
    const withBlade = withBladeCost(abilityLines(getCard('blob')), {
      ...monster,
      equipment: [stone('efficiency'), { instanceId: 'blade', defId: 'lifesteal_blade', hp: 30, maxHp: 30 }],
    })
    expect(withBlade.find((line) => line.id === 'wakkle')?.cost).toEqual({ require: 2, spend: 0 })

    const state = main(game())
    put(state.players[0], 0, 'blob', { energy: 1, equipment: [stone('efficiency')] })
    put(state.players[1], 0, 'blob')
    const next = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'wakkle'),
    )
    expect(next.players[0].field[0]?.energy).toBe(1)
    expect(next.players[1].field[0]?.hp).toBe(30)
  })

  it('attaches a random runestone only when the target loses energy', () => {
    const dry = main(game())
    put(dry.players[0], 0, 'blob')
    put(dry.players[1], 0, 'blob')
    dry.players[0].hand = [{ instanceId: 'enchant', defId: 'enchant' }]
    const missed = applyAction(dry, {
      type: 'PLAY_EFFECT',
      handIndex: 0,
      targets: [{ kind: 'monster', player: 1, slot: 0 }],
    })
    expect(missed.players[1].field[0]?.equipment).toEqual([])

    const charged = main(game())
    charged.rng = () => 6
    put(charged.players[0], 0, 'blob')
    put(charged.players[1], 0, 'blob', { energy: 1 })
    charged.players[0].hand = [{ instanceId: 'enchant', defId: 'enchant' }]
    const hit = applyAction(charged, {
      type: 'PLAY_EFFECT',
      handIndex: 0,
      targets: [{ kind: 'monster', player: 1, slot: 0 }],
    })
    expect(hit.players[1].field[0]?.energy).toBe(0)
    expect(hit.players[1].field[0]?.equipment.map((equipment) => equipment.defId)).toEqual(['efficiency'])
  })

  it('grants usable energy to an adjacent card after Ancient Powers', () => {
    const state = main(game())
    put(state.players[0], 0, 'starbeam_elemental', { energy: 3 })
    put(state.players[0], 1, 'blob', { energy: 0 })
    put(state.players[1], 0, 'blob', { hp: 100, maxHp: 100 })
    const choosing = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'ancient_powers'),
    )
    expect(choosing.players[1].field[0]?.hp).toBe(70)
    expect(choosing.pending?.kind).toBe('starbeamEnergy')
    const granted = applyAction(
      choosing,
      action(
        choosing,
        (candidate) =>
          candidate.type === 'STARBEAM_ENERGY' &&
          candidate.target.player === 0 &&
          candidate.target.slot === 1,
      ),
    )
    expect(granted.players[0].field[1]?.energy).toBe(1)
    expect(granted.players[0].field[1]?.pendingEnergy).toBe(0)
  })

  it('weakens for two turns and freezes ice-weak targets', () => {
    const state = main(game())
    put(state.players[0], 0, 'shadow_sprite', { energy: 2 })
    put(state.players[1], 0, 'blob', { hp: 50, maxHp: 50 })
    const weakened = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'vile_shadows'),
    )
    expect(weakened.players[1].field[0]?.hp).toBe(40)
    expect(weakened.players[1].field[0]?.statuses.find((status) => status.kind === 'weakened')).toMatchObject({
      turns: 2,
    })

    const blue = main(game())
    put(blue.players[0], 0, 'blue_blob', { energy: 2 })
    put(blue.players[1], 0, 'wyvern', { hp: 120, maxHp: 120 })
    const frozen = applyAction(
      blue,
      action(blue, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'freezing_goop'),
    )
    expect(frozen.players[1].field[0]?.statuses.map((status) => status.kind).sort()).toEqual(['frozen', 'goo'])
    expect(frozen.players[1].field[0]?.statuses.find((status) => status.kind === 'frozen')?.turns).toBe(2)

    const plain = main(game())
    put(plain.players[0], 0, 'blue_blob', { energy: 2 })
    put(plain.players[1], 0, 'blob')
    const goo = applyAction(
      plain,
      action(plain, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'freezing_goop'),
    )
    expect(goo.players[1].field[0]?.statuses.map((status) => status.kind)).toEqual(['goo'])
    const wakkle = getCard('blue_blob')
    expect(wakkle.kind === 'monster' && wakkle.abilities[0].cost).toEqual({ require: 0, spend: 1 })
  })

  it('goos and burns, then repeats on a 6', () => {
    const quiet = main(game())
    put(quiet.players[0], 0, 'big_red_blob', { energy: 2, hp: 110, maxHp: 110 })
    put(quiet.players[1], 0, 'blob')
    const once = applyAction(
      quiet,
      action(quiet, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'big_red_splat'),
    )
    expect(once.pending).toBeNull()
    expect(once.players[1].field[0]?.statuses.map((status) => status.kind).sort()).toEqual(['burn', 'goo'])
    expect(once.players[1].field[0]?.statuses.find((status) => status.kind === 'burn')?.turns).toBe(3)

    const again = main(game())
    again.rng = () => 6
    put(again.players[0], 0, 'big_blue_blob', { energy: 2, hp: 110, maxHp: 110 })
    put(again.players[1], 0, 'blob')
    const repeated = applyAction(
      again,
      action(again, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'big_blue_splat'),
    )
    expect(repeated.pending).toMatchObject({ kind: 'repeatGoo', also: 'frozen' })
    expect(repeated.players[1].field[0]?.statuses.find((status) => status.kind === 'frozen')?.turns).toBe(2)
  })
})
