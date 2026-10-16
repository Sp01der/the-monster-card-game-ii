import {
  BREWABLE_WEAKNESSES,
  chaosFireworksSpend,
  countWoodySpears,
  countsAsElementalCard,
  getCard,
  getMonster,
  hasDarkCharge,
  hasGoldAffinity,
  isBlobMonster,
  isFireMonster,
  isOrcOrGoblin,
  isPlant,
  monsterAbilities,
} from './catalog'
import { abilityNeedsChoice, abilityNeedsTarget } from './combat'
import { abilityCostsTeamAction, getCircleAdjacent } from './damage'
import {
  activePlayer,
  canAfford,
  canReceiveEnergy,
  goldPayments,
  emptySlots,
  isDamageProtected,
  isFrozen,
  isGooed,
  monsterAt,
  targetInstanceId,
} from './helpers'
import {
  abilityTargets,
  anyCardTargets,
  anyMonsterTargets,
  canUseAbilityWhileWithdrawn,
  effectTargetOptions,
  offersEquipmentTargets,
  withHostEquipment,
  withoutProtected,
} from './targeting'
import type { AbilityChoice, AbilityDef, GameAction, GameState, PlayerState } from './types'

function canChangeStance(monster: NonNullable<PlayerState['field'][number]>): boolean {
  return !isGooed(monster) && !monster.statuses.some((s) => s.kind === 'cling')
}

const DAMAGE_SPECIALS = new Set([
  'guardiansBlade',
  'smash',
  'ironTail',
  'openFourthFloor',
  'underground',
  'groundShaker',
  'scent',
  'burningSpear',
  'vineWhip',
])

function abilityDealsDamage(ability: AbilityDef): boolean {
  if (ability.special && DAMAGE_SPECIALS.has(ability.special)) return true
  return ability.effects.some(
    (effect) =>
      effect.type === 'damage' ||
      effect.type === 'rollDamage' ||
      effect.type === 'chanceBoostDamage',
  )
}

function canForgeKeystone(player: PlayerState): boolean {
  if (player.hand.length < 3) return false
  return player.field.some(
    (monster) =>
      monster?.defId === 'colossus' &&
      !monster.equipment.some((equipment) => equipment.defId === 'colossus_keystone'),
  )
}

function noTargetEffect(effectId: string): boolean {
  return [
    'stormBolts',
    'rainOfGoo',
    'churnWaters',
    'blizzard',
    'iceMirror',
    'quickMarch',
    'starlightPortal',
    'command',
    'scrollWisdom',
    'famine',
    'treasureHoard',
    'magicFertilizer',
  ].includes(effectId)
}

const EXTRA_COST_SPECIALS = new Set([
  'charge',
  'lightningNeedle',
  'flurryOfBlows',
  'solarFlare',
  'zap',
])

function expandGoldPayments(state: GameState, actions: GameAction[]): GameAction[] {
  const player = activePlayer(state)
  const expanded: GameAction[] = []
  for (const action of actions) {
    if (action.type !== 'USE_ABILITY') {
      expanded.push(action)
      continue
    }
    const monster = player.field[action.slot]
    const ability = monster ? monsterAbilities(monster).find((a) => a.id === action.abilityId) : undefined
    if (!monster || !ability || (monster.gold ?? 0) <= 0) {
      expanded.push(action)
      continue
    }
    const lingering = player.lingeringEnergy && ability.special !== 'lingeringEnergy'
    const printedSpend =
      ability.special === 'chaosFireworks'
        ? chaosFireworksSpend(player, action.slot)
        : ability.cost.spend
    const extraCost = EXTRA_COST_SPECIALS.has(ability.special ?? '') ? (action.extraEnergy ?? 0) : 0
    const require = lingering
      ? ability.cost.require + printedSpend + extraCost
      : ability.cost.require
    const spend = lingering ? 0 : printedSpend + extraCost
    const payments = goldPayments(monster, require, spend)
    if (payments.length === 0) continue
    if (payments.length === 1 && payments[0].goldRequire === 0 && payments[0].goldSpend === 0) {
      expanded.push(action)
      continue
    }
    for (const payment of payments) {
      expanded.push({ ...action, goldRequire: payment.goldRequire, goldSpend: payment.goldSpend })
    }
  }
  return expanded
}

function listHandPlayActions(state: GameState, player: PlayerState): GameAction[] {
  const actions: GameAction[] = []
  for (let handIndex = 0; handIndex < player.hand.length; handIndex++) {
    const card = player.hand[handIndex]
    const def = getCard(card.defId)
    if (def.kind === 'monster') {
      if (emptySlots(player).length === 0) continue
      for (const slot of emptySlots(player)) {
        actions.push({ type: 'PLAY_MONSTER', handIndex, slot, stance: 'active' })
        actions.push({ type: 'PLAY_MONSTER', handIndex, slot, stance: 'withdrawn' })
      }
    } else if (def.kind === 'effect') {
      if (noTargetEffect(def.effectId)) {
        actions.push({ type: 'PLAY_EFFECT', handIndex, targets: [] })
        continue
      }
      for (const targets of effectTargetOptions(state, def.effectId)) {
        actions.push({ type: 'PLAY_EFFECT', handIndex, targets })
      }
    } else if (def.kind === 'equipment') {
      for (let slot = 0; slot < player.field.length; slot++) {
        const monster = monsterAt(player, slot)
        if (monster && !monster.equipment.some((e) => e.defId === def.id)) {
          actions.push({ type: 'PLAY_EQUIPMENT', handIndex, slot })
        }
      }
    }
  }
  return actions
}

export function listLegalActions(state: GameState): GameAction[] {
  if (state.winner !== null) return []
  if (state.pending) {
    const pending = state.pending
    if (pending.kind === 'hoardChoice') {
      return [
        { type: 'HOARD_CHOICE', mode: 'gold' },
        { type: 'HOARD_CHOICE', mode: 'card' },
      ]
    }
    if (pending.kind === 'assignGold') {
      const owner = state.players[pending.owner]
      const actions: GameAction[] = []
      for (let slot = 0; slot < owner.field.length; slot++) {
        const monster = owner.field[slot]
        if (monster && hasGoldAffinity(monster)) actions.push({ type: 'ASSIGN_GOLD', slot })
      }
      return actions
    }
    if (pending.kind === 'stormType') {
      return [
        { type: 'STORM_TYPE', damageType: 'electric' },
        { type: 'STORM_TYPE', damageType: 'water' },
      ]
    }
    if (pending.kind === 'forceWithdraw') {
      return [
        { type: 'FORCE_WITHDRAW', accept: true },
        { type: 'FORCE_WITHDRAW', accept: false },
      ]
    }
    if (pending.kind === 'rainChoice') {
      const actions: GameAction[] = []
      const owner = state.players[pending.owner]
      if (
        owner.hand.some((c) => getCard(c.defId).name.toLowerCase().includes('blob')) &&
        emptySlots(owner).length > 0
      ) {
        actions.push({ type: 'RAIN_CHOOSE_MODE', mode: 'blobs' })
      }
      if (anyMonsterTargets(state).length >= 3) {
        actions.push({ type: 'RAIN_CHOOSE_MODE', mode: 'goo' })
      }
      return actions
    }
    if (pending.kind === 'multiHit' || pending.kind === 'repeatGoo') {
      const source = state.players[pending.sourcePlayer].field[pending.sourceSlot]
      if (!source) return []
      let targets =
        pending.kind === 'multiHit' && pending.scope === 'any'
          ? withoutProtected(state, anyCardTargets(state))
          : abilityTargets(state, pending.sourcePlayer, source, {
              id: 'pending',
              name: 'pending',
              cost: { require: 0, spend: 0 },
              effects: [{ type: 'damage', amount: 1 }],
            })
      if (pending.kind === 'multiHit' && pending.scope !== 'any' && (pending.amount > 0 || pending.strike)) {
        targets = withHostEquipment(state, withoutProtected(state, targets))
      }
      if (pending.kind === 'multiHit' && pending.excludeInstanceIds?.length) {
        const excluded = new Set(pending.excludeInstanceIds)
        targets = targets.filter((target) => {
          const id = targetInstanceId(state, target)
          return !id || !excluded.has(id)
        })
      }
      return targets.map((target) => ({ type: 'PENDING_TARGET', target }))
    }
    if (pending.kind === 'eldersEye') {
      return pending.cards
        .filter((card) => !pending.order.includes(card.instanceId))
        .map((card) => ({ type: 'ELDERS_PICK' as const, instanceId: card.instanceId }))
    }
    if (pending.kind === 'keystone') {
      const owner = state.players[pending.owner]
      const actions: GameAction[] = [{ type: 'KEYSTONE_CANCEL' }]
      for (const card of owner.hand) {
        if (
          pending.chosenInstanceIds.includes(card.instanceId) ||
          pending.chosenInstanceIds.length < 3
        ) {
          actions.push({ type: 'KEYSTONE_TOGGLE', instanceId: card.instanceId })
        }
      }
      if (pending.chosenInstanceIds.length === 3) {
        owner.field.forEach((monster, slot) => {
          if (
            monster?.defId === 'colossus' &&
            !monster.equipment.some((equipment) => equipment.defId === 'colossus_keystone')
          ) {
            actions.push({ type: 'KEYSTONE_ATTACH', slot })
          }
        })
      }
      return actions
    }
    if (pending.kind === 'trickery') {
      const deck = state.players[pending.opponent].deck
      return Array.from({ length: deck.length + 1 }, (_, deckIndex) => ({
        type: 'TRICKERY_PLACE' as const,
        deckIndex,
      }))
    }
    if (pending.kind === 'spawnBlobs') {
      const owner = state.players[pending.owner]
      const result: GameAction[] = []
      for (const slot of emptySlots(owner)) {
        result.push({ type: 'SPAWN_BLOB', slot, stance: 'active' })
        result.push({ type: 'SPAWN_BLOB', slot, stance: 'withdrawn' })
      }
      return result
    }
    if (pending.kind === 'rainBlobs') {
      const owner = state.players[pending.owner]
      const result: GameAction[] =
        pending.played > 0 ? [{ type: 'RAIN_FINISH_BLOBS' }] : []
      owner.hand.forEach((card, handIndex) => {
        if (!getCard(card.defId).name.toLowerCase().includes('blob')) return
        for (const slot of emptySlots(owner)) {
          result.push({ type: 'RAIN_PLAY_BLOB', handIndex, slot, stance: 'active' })
          result.push({ type: 'RAIN_PLAY_BLOB', handIndex, slot, stance: 'withdrawn' })
        }
      })
      return result
    }
    if (pending.kind === 'rainGoo') {
      return anyMonsterTargets(state)
        .filter((target) => {
          if (target.kind !== 'monster') return false
          const m = state.players[target.player].field[target.slot]
          return Boolean(m && !pending.chosenInstanceIds.includes(m.instanceId))
        })
        .map((target) => ({ type: 'RAIN_GOO_TARGET', target }))
    }
    if (pending.kind === 'bury') {
      return [
        ...state.players[pending.owner].hand.map((card) => ({
          type: 'BURY_TOGGLE' as const,
          instanceId: card.instanceId,
        })),
        { type: 'BURY_FINISH' as const },
      ]
    }
    if (pending.kind === 'discardPick') {
      return state.players[pending.pileOwner].discard.map((card) => ({
        type: 'PICK_DISCARD' as const,
        instanceId: card.instanceId,
      }))
    }
    if (pending.kind === 'freezeTargets') {
      const source = state.players[pending.sourcePlayer].field[pending.sourceSlot]
      if (!source) return []
      return abilityTargets(
        state,
        pending.sourcePlayer,
        source,
        {
          id: 'pending-freeze',
          name: 'pending-freeze',
          cost: { require: 0, spend: 0 },
          effects: [{ type: 'status', status: 'frozen', turns: pending.turns }],
        },
      )
        .filter((target) => {
          if (target.kind !== 'monster') return false
          const monster = state.players[target.player].field[target.slot]
          return Boolean(monster && !pending.chosenInstanceIds.includes(monster.instanceId))
        })
        .map((target) => ({ type: 'FREEZE_TARGET' as const, target }))
    }
    if (pending.kind === 'handDiscard') {
      const hand = state.players[pending.player].hand
      const marked = state.players[pending.player].spyMarkInstanceId
      const forced = marked ? hand.filter((card) => card.instanceId === marked) : []
      const choices = forced.length > 0 ? forced : hand
      return choices.map((card) => ({
        type: 'DISCARD_FROM_HAND' as const,
        instanceId: card.instanceId,
      }))
    }
    if (pending.kind === 'spy') {
      const opponent = state.players[pending.owner === 0 ? 1 : 0]
      return [
        { type: 'SPY_SKIP' as const },
        ...opponent.hand.map((card) => ({ type: 'SPY_MARK' as const, instanceId: card.instanceId })),
      ]
    }
    if (pending.kind === 'griefDestroy') {
      return [
        { type: 'GRIEF_FINISH' as const },
        ...state.players[pending.owner].discard
          .filter(
            (card) =>
              pending.chosenInstanceIds.includes(card.instanceId) ||
              pending.chosenInstanceIds.length < 2,
          )
          .map((card) => ({
            type: 'GRIEF_TOGGLE' as const,
            instanceId: card.instanceId,
          })),
      ]
    }
    if (pending.kind === 'transmuteHand') {
      return state.players[pending.owner].hand.map((card) => ({
        type: 'TRANSMUTE_DESTROY' as const,
        instanceId: card.instanceId,
      }))
    }
    if (pending.kind === 'transmuteFetch') {
      const owner = state.players[pending.owner]
      return [...owner.discard, ...owner.deck].map((card) => ({
        type: 'TRANSMUTE_FETCH' as const,
        instanceId: card.instanceId,
      }))
    }
    if (pending.kind === 'brewWeakness') {
      return BREWABLE_WEAKNESSES.map((damageType) => ({
        type: 'BREW_WEAKNESS' as const,
        damageType,
      }))
    }
    if (pending.kind === 'plasmaCannon') {
      const source = state.players[pending.sourcePlayer].field[pending.sourceSlot]
      if (!source) return []
      const actions: GameAction[] = [{ type: 'PLASMA_ROLL' }]
      if (pending.hits >= 1) {
        for (const target of withHostEquipment(
          state,
          withoutProtected(
            state,
            abilityTargets(
              state,
              pending.sourcePlayer,
              source,
              {
                id: 'pending-plasma',
                name: 'pending-plasma',
                cost: { require: 0, spend: 0 },
                effects: [{ type: 'damage', amount: 1, damageType: 'electric' }],
              },
            ),
          ),
        )) {
          actions.push({ type: 'PLASMA_FIRE', target })
        }
      }
      return actions
    }
    if (pending.kind === 'soundWave') {
      const actions: GameAction[] = []
      if (pending.chosenInstanceIds.length > 0) actions.push({ type: 'SOUND_WAVE_FINISH' })
      if (pending.chosenInstanceIds.length < 3) {
        for (const target of withHostEquipment(
          state,
          withoutProtected(state, anyMonsterTargets(state)),
        )) {
          const instanceId = targetInstanceId(state, target)
          if (!instanceId || pending.chosenInstanceIds.includes(instanceId)) continue
          actions.push({ type: 'SOUND_WAVE_TARGET', target })
        }
      }
      return actions
    }
    if (pending.kind === 'march') {
      const owner = state.players[pending.owner]
      const actions: GameAction[] = [{ type: 'MARCH_FINISH' }]
      for (let slot = 0; slot < owner.field.length; slot++) {
        const monster = monsterAt(owner, slot)
        if (monster && canChangeStance(monster)) {
          actions.push({ type: 'MARCH_TOGGLE', slot })
        }
      }
      return actions
    }
    if (pending.kind === 'playCards') {
      return [...listHandPlayActions(state, state.players[pending.owner]), { type: 'PORTAL_FINISH' }]
    }
    if (pending.kind === 'fairyHeal') {
      return anyCardTargets(state).map((target) => ({ type: 'FAIRY_HEAL' as const, target }))
    }
    if (pending.kind === 'placeWeed') {
      const owner = state.players[pending.owner]
      const open = emptySlots(owner)
      const slots = open.length > 0 ? open : [owner.field.length]
      const result: GameAction[] = []
      for (const slot of slots) {
        result.push({ type: 'PLACE_WEED', slot, stance: 'active' })
        result.push({ type: 'PLACE_WEED', slot, stance: 'withdrawn' })
      }
      return result
    }
  }
  if (state.awaitingHandoff) return [{ type: 'CONFIRM_HANDOFF' }]

  const player = activePlayer(state)
  const actions: GameAction[] = []

  // Ungoo can be done whenever you have energy, outside the main action
  for (let slot = 0; slot < player.field.length; slot++) {
    const m = monsterAt(player, slot)
    if (m && isGooed(m) && m.energy >= 1) {
      actions.push({ type: 'UNGOO', slot })
    }
    if (m?.statuses.some((s) => s.kind === 'cling') && m.energy >= 1) {
      actions.push({ type: 'RESIST_CLING', slot })
    }
  }

  switch (state.phase) {
    case 'draw': {
      // First turn never enters draw (starts in main).
      if (player.deck.length > 0) actions.push({ type: 'DRAW' })
      actions.push({ type: 'SKIP_DRAW' })
      break
    }
    case 'main': {
      if (player.isFirstTurn) {
        for (let handIndex = 0; handIndex < player.hand.length; handIndex++) {
          const card = player.hand[handIndex]
          const def = getCard(card.defId)
          if (def.kind !== 'monster') continue
          for (const slot of emptySlots(player)) {
            actions.push({ type: 'PLAY_MONSTER', handIndex, slot, stance: 'active' })
            actions.push({ type: 'PLAY_MONSTER', handIndex, slot, stance: 'withdrawn' })
          }
        }
        if (state.playedCardThisTurn) {
          actions.push({ type: 'SKIP_MAIN' })
        }
        break
      }

      for (let slot = 0; slot < player.field.length; slot++) {
        const monster = monsterAt(player, slot)
        if (!monster || isFrozen(monster) || isGooed(monster)) continue
        const acted = state.actedSlots.includes(slot)
        const extraUse = (monster.extraAbilityUses ?? 0) > 0
        if (acted && !extraUse) continue
        for (const ability of monsterAbilities(monster)) {
          if (!canUseAbilityWhileWithdrawn(monster, ability)) continue
          if (
            ability.special !== 'chaosFireworks' &&
            !canAfford(monster, ability.cost.require, ability.cost.spend)
          ) {
            continue
          }
          if (ability.id === 'improvised_weapon' && monster.equipment.length === 0) continue
          const costsTeam = abilityCostsTeamAction(monster, ability)
          if (!acted && costsTeam && state.abilityUsesLeft <= 0 && !extraUse) continue
          if (ability.special === 'trickery' && state.players[player.id === 0 ? 1 : 0].hand.length === 0) continue
          if (ability.special === 'drawOne' && player.deck.length === 0) continue
          if (ability.special === 'drawTwo' && player.deck.length === 0) continue
          if (ability.special === 'lostTreasure' && player.discard.length === 0) continue
          if (
            ability.special === 'sunkenPlunder' &&
            state.players[player.id === 0 ? 1 : 0].discard.length === 0
          ) continue
          if (
            (ability.special === 'freezeTwo' || ability.special === 'frostBreath') &&
            abilityTargets(state, player.id, monster, ability).length < 2
          ) continue
          if (
            ability.special === 'chillingScreech' &&
            abilityTargets(state, player.id, monster, ability).length === 0
          ) continue
          if (ability.special === 'gleam') {
            const allies = player.field.flatMap((ally, allySlot) =>
              ally ? [{ kind: 'monster' as const, player: player.id, slot: allySlot }] : [],
            )
            for (const target of withHostEquipment(state, allies)) {
              actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id, target })
            }
            continue
          }
          if (ability.special === 'healingLight') {
            for (const target of withHostEquipment(state, anyMonsterTargets(state))) {
              actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id, target })
            }
            continue
          }
          if (ability.special === 'chorus') {
            for (const target of withHostEquipment(
              state,
              withoutProtected(state, abilityTargets(state, player.id, monster, ability)),
            )) {
              actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id, target })
            }
            continue
          }
          if (ability.special === 'knightsHonour') {
            actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id })
            continue
          }
          if (ability.special === 'chaosFireworks') {
            if (monster.energy < chaosFireworksSpend(player, slot)) continue
            actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id })
            continue
          }
          if (
            ability.special === 'spy' ||
            ability.special === 'griefBolt' ||
            ability.special === 'storm' ||
            ability.special === 'plasmaCannon' ||
            ability.special === 'lingeringEnergy' ||
            ability.special === 'channel' ||
            ability.special === 'wormStorm' ||
            ability.special === 'sunburn' ||
            ability.special === 'overheat' ||
            ability.special === 'eyeFlash'
          ) {
            actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id })
            continue
          }
          if (ability.special === 'soundWave') {
            if (anyMonsterTargets(state).length === 0) continue
            actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id })
            continue
          }
          if (ability.special === 'transmutation') {
            if (player.hand.length === 0) continue
            if (player.discard.length + player.deck.length === 0) continue
            actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id })
            continue
          }
          if (
            ability.special === 'burningBreath' ||
            ability.special === 'bottleToxins' ||
            ability.special === 'poisonGas'
          ) {
            for (const first of anyMonsterTargets(state)) {
              if (first.kind !== 'monster') continue
              for (const second of getCircleAdjacent(state, first.player, first.slot)) {
                actions.push({
                  type: 'USE_ABILITY',
                  slot,
                  abilityId: ability.id,
                  targets: [first, second],
                })
              }
            }
            continue
          }

          if (ability.special === 'burrow') {
            if (canChangeStance(monster)) {
              actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id })
            }
            continue
          }
          if (ability.special === 'magicDoor') {
            for (const target of getCircleAdjacent(state, player.id, slot)) {
              if (target.kind !== 'monster' || target.player !== player.id) continue
              const ally = state.players[target.player].field[target.slot]
              if (!ally || !canChangeStance(ally)) continue
              actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id, target })
            }
            continue
          }
          if (
            ability.special === 'meatShield' ||
            ability.special === 'guard' ||
            ability.special === 'ancientGuardian' ||
            ability.special === 'treasureKeepers'
          ) {
            if (monster.stance !== 'active' && !canChangeStance(monster)) continue
            for (let allySlot = 0; allySlot < player.field.length; allySlot++) {
              if (allySlot === slot) continue
              const ally = player.field[allySlot]
              if (!ally) continue
              if (ability.special === 'meatShield' && !isOrcOrGoblin(ally.defId)) continue
              actions.push({
                type: 'USE_ABILITY',
                slot,
                abilityId: ability.id,
                target: { kind: 'monster', player: player.id, slot: allySlot },
              })
            }
            continue
          }
          if (ability.special === 'theft') {
            for (const owner of state.players) {
              for (let hostSlot = 0; hostSlot < owner.field.length; hostSlot++) {
                const host = owner.field[hostSlot]
                if (!host || host.stance !== 'active') continue
                if (owner.id === player.id && hostSlot === slot) continue
                host.equipment.forEach((equipment, equipmentIndex) => {
                  if (monster.equipment.some((held) => held.defId === equipment.defId)) return
                  actions.push({
                    type: 'USE_ABILITY',
                    slot,
                    abilityId: ability.id,
                    target: {
                      kind: 'equipment',
                      player: owner.id,
                      slot: hostSlot,
                      equipmentIndex,
                    },
                  })
                })
              }
            }
            continue
          }
          if (ability.special === 'teamAttack') {
            if (countWoodySpears(state.players, player.hand) > 0) {
              actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id })
            }
            continue
          }
          if (ability.special === 'tripleChomp' || ability.special === 'multiply') {
            actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id })
            continue
          }
          if (
            ability.special === 'relentless' ||
            ability.special === 'attack' ||
            ability.special === 'drawTwo'
          ) {
            actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id })
            continue
          }
          if (ability.special === 'downpour') {
            if (withoutProtected(state, anyCardTargets(state)).length === 0) continue
            actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id })
            continue
          }
          if (ability.special === 'magicMusic' || ability.special === 'bringTheStorm') {
            if (abilityTargets(state, player.id, monster, ability).length === 0) continue
            actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id })
            continue
          }
          if (ability.special === 'stormCommand') {
            for (let allySlot = 0; allySlot < player.field.length; allySlot++) {
              const ally = player.field[allySlot]
              if (!ally || !countsAsElementalCard(ally.defId)) continue
              actions.push({
                type: 'USE_ABILITY',
                slot,
                abilityId: ability.id,
                target: { kind: 'monster', player: player.id, slot: allySlot },
              })
            }
            continue
          }
          if (ability.special === 'gale' || ability.special === 'tailGale') {
            for (const owner of state.players) {
              for (let hostSlot = 0; hostSlot < owner.field.length; hostSlot++) {
                const host = owner.field[hostSlot]
                if (!host || isDamageProtected(state, host)) continue
                actions.push({
                  type: 'USE_ABILITY',
                  slot,
                  abilityId: ability.id,
                  target: { kind: 'monster', player: owner.id, slot: hostSlot },
                })
                host.equipment.forEach((_, equipmentIndex) => {
                  actions.push({
                    type: 'USE_ABILITY',
                    slot,
                    abilityId: ability.id,
                    target: {
                      kind: 'equipment',
                      player: owner.id,
                      slot: hostSlot,
                      equipmentIndex,
                    },
                  })
                })
              }
            }
            continue
          }
          if (ability.special === 'healingHands') {
            for (const target of anyCardTargets(state)) {
              const host = state.players[target.player].field[target.slot]
              if (!host || isFireMonster(host.defId)) continue
              actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id, target })
            }
            continue
          }
          if (ability.special === 'growth') {
            for (let allySlot = 0; allySlot < player.field.length; allySlot++) {
              const ally = player.field[allySlot]
              if (!ally || !isPlant(ally.defId)) continue
              actions.push({
                type: 'USE_ABILITY',
                slot,
                abilityId: ability.id,
                target: { kind: 'monster', player: player.id, slot: allySlot },
              })
            }
            continue
          }
          if (ability.special === 'vineWhip') {
            for (const owner of state.players) {
              for (let hostSlot = 0; hostSlot < owner.field.length; hostSlot++) {
                const host = owner.field[hostSlot]
                if (!host || host.stance !== 'withdrawn' || isDamageProtected(state, host)) continue
                actions.push({
                  type: 'USE_ABILITY',
                  slot,
                  abilityId: ability.id,
                  target: { kind: 'monster', player: owner.id, slot: hostSlot },
                })
              }
            }
            continue
          }
          if (ability.special === 'groundShaker') {
            for (const target of anyMonsterTargets(state)) {
              if (target.kind !== 'monster') continue
              if (getCircleAdjacent(state, target.player, target.slot).length < 2) continue
              const center = state.players[target.player].field[target.slot]
              if (center && isDamageProtected(state, center)) continue
              actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id, target })
            }
            continue
          }

          const choices: (AbilityChoice | undefined)[] = abilityNeedsChoice(ability)
            ? ['firePunchFull', 'firePunchBurn']
            : [undefined]

          for (const choice of choices) {
            if (ability.targetMode === 'twoAnyMonsters') {
              const targets = anyMonsterTargets(state).filter((t) => {
                if (t.kind !== 'monster') return false
                return (state.players[t.player].field[t.slot]?.energy ?? 0) > 0
              })
              const destinations = anyMonsterTargets(state)
              for (const source of targets) {
                for (const target of destinations) {
                  if (JSON.stringify(source) === JSON.stringify(target)) continue
                  actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id, targets: [source, target] })
                }
              }
            } else if (
              abilityNeedsTarget(ability, choice) ||
              ['waterClaw', 'waterGush', 'bigSplat', 'burningGoo', 'swarm', 'cling',
                'healOther', 'charge', 'discharge', 'mudball', 'waterJet', 'hunt',
                'iceyBeak', 'frostbite', 'frozenSting', 'lightningNeedle',
                'flurryOfBlows', 'lavaClaw', 'magmaGush', 'solarFlare',
                'stampede', 'rocket', 'pilfer', 'imilithiasBrew',
                'zap', 'collect', 'supply',
                'guardiansBlade', 'smash', 'ironTail', 'openFourthFloor', 'underground',
                'greatAxe', 'dwarvenSpirit', 'dragonTalons',
                'scent', 'burningSpear', 'greenHeal']
                .includes(ability.special ?? '')
            ) {
              let targets =
                ability.targetMode === 'anyMonster' || ability.targetMode === 'otherMonster'
                  ? anyMonsterTargets(state)
                  : abilityTargets(state, player.id, monster, ability)
              if (ability.targetMode === 'otherMonster') {
                targets = targets.filter(
                  (t) => !(t.kind === 'monster' && t.player === player.id && t.slot === slot),
                )
              }
              if (ability.special === 'collect' || ability.special === 'supply') {
                targets = targets.filter((t) => t.kind === 'monster' && t.player === player.id)
              }
              if (ability.special === 'collect') {
                targets = targets.filter(
                  (t) => t.kind === 'monster' && (state.players[t.player].field[t.slot]?.energy ?? 0) > 0,
                )
              }
              if (abilityDealsDamage(ability) || offersEquipmentTargets(ability)) {
                if (ability.special !== 'healOther') targets = withoutProtected(state, targets)
              }
              if (offersEquipmentTargets(ability)) targets = withHostEquipment(state, targets)
              for (const target of targets) {
                if (
                  ability.special === 'charge' ||
                  ability.special === 'lightningNeedle' ||
                  ability.special === 'flurryOfBlows' ||
                  ability.special === 'solarFlare' ||
                  ability.special === 'zap' ||
                  ability.special === 'collect' ||
                  ability.special === 'supply'
                ) {
                  const resources = monster.energy + (monster.gold ?? 0)
                  const maxExtra =
                    ability.special === 'solarFlare' || ability.special === 'zap'
                      ? Math.min(1, resources - ability.cost.require)
                      : ability.special === 'flurryOfBlows'
                        ? Math.min(3, resources - ability.cost.require)
                        : ability.special === 'lightningNeedle'
                          ? Math.min(3, resources - ability.cost.spend)
                          : ability.special === 'collect' && target.kind === 'monster'
                            ? state.players[target.player].field[target.slot]?.energy ?? 0
                            : ability.special === 'supply'
                              ? monster.energy
                              : resources - ability.cost.spend
                  const minExtra =
                    ability.special === 'flurryOfBlows' ||
                    ability.special === 'collect' ||
                    ability.special === 'supply'
                      ? 1
                      : 0
                  for (let extraEnergy = minExtra; extraEnergy <= maxExtra; extraEnergy++) {
                    actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id, target, choice, extraEnergy })
                  }
                } else {
                  actions.push({ type: 'USE_ABILITY', slot, abilityId: ability.id, target, choice })
                }
              }
            } else {
              actions.push({
                type: 'USE_ABILITY',
                slot,
                abilityId: ability.id,
                choice,
              })
            }
          }
        }
      }

      if (!state.playedCardThisTurn) {
        actions.push(...listHandPlayActions(state, player))
      }
      if (canForgeKeystone(player)) actions.push({ type: 'BEGIN_KEYSTONE' })

      actions.push({ type: 'SKIP_MAIN' })
      break
    }
    case 'move': {
      if (!state.movedThisTurn) {
        for (let slot = 0; slot < player.field.length; slot++) {
          const m = monsterAt(player, slot)
          if (!m || isGooed(m) || m.statuses.some((s) => s.kind === 'cling')) continue
          if (m.stance === 'active') actions.push({ type: 'WITHDRAW', slot })
          else actions.push({ type: 'ADVANCE', slot })
        }
      }
      actions.push({ type: 'SKIP_MOVE' })
      break
    }
    case 'energy': {
      for (let slot = 0; slot < player.field.length; slot++) {
        const monster = monsterAt(player, slot)
        if (!monster || !canReceiveEnergy(monster)) continue
        const useBanner = state.bannerEnergyPool > 0 && getMonster(monster.defId).points <= 2
        const blobEnergy = state.blobEnergyPool > 0 && isBlobMonster(monster.defId)
        if (state.energyPool > 0 || blobEnergy || useBanner) {
          actions.push({ type: 'ATTACH_ENERGY', slot })
        }
      }
      for (let slot = 0; slot < player.field.length; slot++) {
        const charged = monsterAt(player, slot)
        if (!charged || !hasDarkCharge(charged) || !canReceiveEnergy(charged)) continue
        for (const card of player.discard) {
          actions.push({ type: 'DARK_CHARGE', slot, discardInstanceId: card.instanceId })
        }
      }
      if (state.energyPool > 0 || state.blobEnergyPool > 0 || state.bannerEnergyPool > 0) actions.push({ type: 'SKIP_ENERGY' })
      else actions.push({ type: 'END_TURN' })
      break
    }
    case 'end': {
      actions.push({ type: 'END_TURN' })
      break
    }
  }

  return expandGoldPayments(state, actions)
}

const UNDOABLE_PHASE_ACTIONS = new Set<GameAction['type']>([
  'SKIP_DRAW',
  'SKIP_MAIN',
  'SKIP_MOVE',
  'SKIP_ENERGY',
  'FINISH_ENERGY',
  'END_TURN',
])

/** Phase skips and turn ends. Rolls, abilities, and card plays are not undoable. */
export function isUndoablePhaseAction(action: GameAction): boolean {
  return UNDOABLE_PHASE_ACTIONS.has(action.type)
}

export function isLegalAction(state: GameState, action: GameAction): boolean {
  const legal = listLegalActions(state)
  return legal.some((a) => actionsEqual(a, action))
}

export function actionsEqual(a: GameAction, b: GameAction): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
