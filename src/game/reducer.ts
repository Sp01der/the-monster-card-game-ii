import { actionsEqual, listLegalActions } from './actions'
import { redrawOpeningHand } from './setup'
import {
  chaosFireworksSpend,
  countElectricCardsInPlay,
  countOtherStormlings,
  countPoisonCardsInPlay,
  countWoodySpears,
  countsAsElementalCard,
  cardMatchesSearchType,
  ELEMENTAL_TYPES,
  getCard,
  getMonster,
  replacementBlobHost,
  getWeaknesses,
  identityDefId,
  hasGoldAffinity,
  canUseDarkCharge,
  hasDarkCharge,
  isBlobMonster,
  isBoneling,
  isFireMonster,
  isOrcOrGoblin,
  isPlant,
  monsterAbilities,
} from './catalog'
import {
  abilityNeedsChoice,
  dealDamageToTarget,
  healTarget,
  resolveAbility,
  takeLastDealt,
} from './combat'
import {
  abilityCostsTeamAction,
  adjustedCost,
  getCircleAdjacent,
  hasFishingRod,
  hasSpareEnergy,
  lensHarmFaces,
  lensSuccessFaces,
} from './damage'
import { highFaces, lowFaces } from './dice'
import {
  allocId,
  applyResilience,
  applyStatus,
  attachCreatedEquipment,
  activePlayer,
  becomeEthereal,
  beginProtection,
  canReceiveEnergy,
  countEtherealCards,
  captureCardSnapshot,
  checkLosses,
  cloneState,
  collapseEmptyExtraSlots,
  discardMonster,
  grantEnergy,
  hasKeystone,
  liftEquipment,
  liftMonster,
  clearNegativeStatuses,
  isClinged,
  isGooed,
  log,
  makeCard,
  releaseHeld,
  releaseProtection,
  removeResilience,
  restoreSnapshot,
  otherPlayer,
  placeMonsterOnField,
  randomRunestone,
  recordHeal,
  removeMonsterWithoutPoints,
  resolveTarget,
  rollDie,
  spendEnergy,
  targetFromInstanceId,
  targetInstanceId,
} from './helpers'
import {
  anyCardTargets,
  effectIsUntargeted,
  effectTargetOptions,
  withoutProtected,
} from './targeting'
import {
  HAND_SIZE_LIMIT,
  type CardSnapshot,
  type DamageType,
  type FieldMonster,
  type GameAction,
  type GameState,
  type HandCard,
  type PlayerId,
  type PlayerState,
  type TargetRef,
} from './types'

function assertLegal(state: GameState, action: GameAction): void {
  const legal = listLegalActions(state)
  if (!legal.some((a) => actionsEqual(a, action))) {
    throw new Error(`Illegal action: ${JSON.stringify(action)}`)
  }
}

function clearPending(state: GameState): void {
  state.pending = state.pendingStack.pop() ?? null
  if (state.pending?.kind === 'mirrorContinue') {
    const continued = state.pending
    beginMirrorCopy(state, continued.pactOwner, continued.pactOwner, continued.defId, 'self')
  }
}

function defIdInMatch(state: GameState, instanceId: string): string | undefined {
  for (const player of state.players) {
    for (const card of [...player.deck, ...player.hand, ...player.discard, ...player.removed]) {
      if (card.instanceId === instanceId) return card.defId
    }
    for (const entry of player.ethereal ?? []) {
      if (entry.card.instanceId === instanceId) return entry.card.defId
    }
    for (const monster of player.field) {
      if (!monster) continue
      if (monster.instanceId === instanceId) return monster.defId
      for (const equipment of monster.equipment) {
        if (equipment.instanceId === instanceId) return equipment.defId
      }
    }
  }
  return undefined
}

function beginMirrorCopy(
  state: GameState,
  actorId: 0 | 1,
  pactOwner: 0 | 1,
  defId: string,
  role: 'opponent' | 'self',
): void {
  const actor = state.players[actorId]
  const card = makeCard(state, defId)
  actor.hand.push(card)
  state.pending = {
    kind: 'playCards',
    owner: actorId,
    played: 0,
    from: 'hand',
    limit: 1,
    onlyInstanceId: card.instanceId,
    freePlay: true,
    mirrorRole: role,
    pactOwner,
    copiedDefId: defId,
  }
  log(state, `${actor.name} may play a copy of ${getCard(defId).name}.`)
}

function destroyPermanently(state: GameState, player: PlayerState, card: HandCard): void {
  player.removed.push(card)
  log(state, `${player.name} destroys ${getCard(card.defId).name} permanently.`)
}

function takeCard(pile: HandCard[], instanceId: string): HandCard | undefined {
  const index = pile.findIndex((card) => card.instanceId === instanceId)
  if (index < 0) return undefined
  const [card] = pile.splice(index, 1)
  return card
}

function beginForcedDiscard(
  state: GameState,
  playerId: PlayerId,
  remaining: number,
  thenPlayers: PlayerId[] = [],
): void {
  const count = Math.min(remaining, state.players[playerId].hand.length)
  if (count > 0) {
    state.pending = {
      kind: 'handDiscard',
      player: playerId,
      remaining: count,
      thenPlayers: thenPlayers.length > 0 ? thenPlayers : undefined,
    }
    return
  }
  if (thenPlayers.length > 0) {
    beginForcedDiscard(state, thenPlayers[0], 1, thenPlayers.slice(1))
    return
  }
  if (state.pending?.kind === 'handDiscard') clearPending(state)
}

function resumePlayCardsAfter(state: GameState, before: GameState['pending']): void {
  if (before?.kind !== 'playCards') return
  const played = before.played + 1
  if (before.limit !== undefined && played >= before.limit) {
    if (before.mirrorRole === 'opponent' && before.pactOwner !== undefined && before.copiedDefId) {
      if (state.pending === before) {
        beginMirrorCopy(state, before.pactOwner, before.pactOwner, before.copiedDefId, 'self')
      } else {
        state.pendingStack.push({
          kind: 'mirrorContinue',
          pactOwner: before.pactOwner,
          defId: before.copiedDefId,
        })
      }
      return
    }
    if (state.pending === before) clearPending(state)
    return
  }
  const resumed = { ...before, played }
  if (state.pending === null || state.pending === before) {
    state.pending = resumed
  } else {
    state.pendingStack.push(resumed)
  }
}

function resolveZeroHp(state: GameState, player: PlayerState, slot: number): void {
  const monster = player.field[slot]
  if (!monster || monster.hp > 0) return
  if (monster.unending) {
    monster.hp = Math.min(monster.maxHp, 10)
    log(state, `${getMonster(monster.defId).name} endures at ${monster.hp} HP.`)
    return
  }
  discardMonster(state, player, slot, 'slain')
  checkLosses(state)
}

function dieInsteadOfWithdraw(state: GameState, playerId: PlayerId, slot: number): void {
  const player = state.players[playerId]
  const monster = player.field[slot]
  if (!monster) return
  log(state, `${getMonster(monster.defId).name} cannot withdraw and dies instead.`)
  monster.hp = 0
  resolveZeroHp(state, player, slot)
}

function beginMainPhase(state: GameState): void {
  state.phase = 'main'
  state.drewThisTurn = true
  const player = activePlayer(state)
  // One paid team action; free abilities / Ruby Ring do not spend it.
  // Each card may still only act once (tracked in actedSlots).
  const bonus = player.isFirstTurn ? 0 : (player.bonusTeamActions ?? 0)
  state.abilityUsesLeft = player.isFirstTurn ? 0 : 1 + bonus
  if (!player.isFirstTurn) player.bonusTeamActions = 0
  state.actedSlots = []
  state.movedSlots = []
  state.skipEnergyPhase = false
  state.endStepResolved = false
  player.attackBonus = 0
  for (const monster of player.field) {
    if (monster) {
      monster.sparkedThisTurn = false
      monster.freeActionThisTurn = false
      monster.extraAbilityUses = 0
      monster.unending = false
      monster.illuminatedThisTurn = false
      monster.honourGuardUntilNextTurn = false
      monster.pegasusUsedThisTurn = false
    }
  }
}

/** Leave the energy phase; force a discard if the hand is over the limit. */
function finishEnergyPhase(state: GameState): void {
  state.phase = 'end'
  state.energyPool = 0
  state.blobEnergyPool = 0
  state.bannerEnergyPool = 0
  const player = activePlayer(state)
  const excess = player.hand.length - HAND_SIZE_LIMIT
  if (excess > 0) {
    beginForcedDiscard(state, player.id, excess)
    log(state, `${player.name} must discard down to ${HAND_SIZE_LIMIT}.`)
  }
}

function beginEnergyPhase(state: GameState): void {
  const player = activePlayer(state)
  if (player.skipEnergyPhases > 0) {
    player.skipEnergyPhases -= 1
    player.bonusEnergy = 0
    state.skipEnergyPhase = false
    log(state, `${player.name}'s energy phase is skipped.`)
    finishEnergyPhase(state)
    return
  }
  if (state.skipEnergyPhase) {
    log(state, `${player.name}'s energy phase is skipped.`)
    finishEnergyPhase(state)
    return
  }
  state.phase = 'energy'
  const sparkSucceeded = player.field.some((m) => m?.sparkedThisTurn)
  const fairies = player.field.filter((m) => m && identityDefId(m) === 'yellow_fairy').length
  state.energyPool = (sparkSucceeded ? 3 : 1) + fairies + (player.bonusEnergy ?? 0)
  player.bonusEnergy = 0
  state.blobEnergyPool = player.field.filter(
    (monster) =>
      monster &&
      (identityDefId(monster) === 'yellow_blob' || identityDefId(monster) === 'big_yellow_blob'),
  ).length
  state.bannerEnergyPool = player.field.filter((m) => m && identityDefId(m) === 'unending_bannerman').length
  for (let slot = 0; slot < player.field.length; slot++) {
    const monster = player.field[slot]
    if (!monster) continue
    const crystals = monster.equipment.filter((e) => e.defId === 'energy_crystal').length
    if (crystals > 0 && grantEnergy(state, monster, crystals) > 0) {
      log(state, `${getMonster(monster.defId).name} gains ${crystals} energy from Energy Crystal.`)
    }
    if (hasKeystone(monster) && grantEnergy(state, monster, 1) > 0) {
      log(state, `${getMonster(monster.defId).name} gains 1 energy from Colossus Keystone.`)
    }
    if (
      getMonster(identityDefId(monster)).idleEnergy &&
      !state.actedSlots.includes(slot) &&
      !state.movedSlots.includes(slot) &&
      grantEnergy(state, monster, 1) > 0
    ) {
      log(state, `${getMonster(monster.defId).name} gains 1 energy for remaining unused.`)
    }
  }
  if (player.field.some((monster) => monster && monster.statuses.some((status) => status.kind === 'stone' && status.cure === 'skipEnergy'))) {
    state.pending = { kind: 'stoneCure', owner: player.id }
    log(state, 'You may skip this energy phase to remove Stone from a monster.')
  }
}

function purgeStatusImmunity(state: GameState): void {
  for (const player of state.players) {
    for (const monster of player.field) {
      if (monster) clearNegativeStatuses(state, monster)
    }
  }
}

function resolveEndStep(state: GameState): void {
  purgeStatusImmunity(state)
  const player = activePlayer(state)

  for (const monster of player.field) {
    if (!monster) continue
    const rings = monster.equipment.filter((eq) => eq.defId === 'emerald_ring').length
    if (rings === 0) continue
    const heal = 10 * rings
    const nextHp = Math.min(monster.maxHp, monster.hp + heal)
    recordHeal(state, nextHp - monster.hp)
    if (nextHp !== monster.hp) {
      monster.hp = nextHp
      log(state, `${getMonster(monster.defId).name} heals ${heal} from Emerald Ring (now ${monster.hp} HP).`)
    }
  }

  // Cling damage triggers at the end of the Rarkling owner's turn.
  for (const source of player.field) {
    if (!source || source.defId !== 'rarkling' || !source.clingTargetInstanceId) continue
    if (source.energy <= 0) {
      for (const p of state.players) {
        for (const m of p.field) {
          if (!m) continue
          m.statuses = m.statuses.filter(
            (s) => s.kind !== 'cling' || s.sourceInstanceId !== source.instanceId,
          )
        }
      }
      source.clingTargetInstanceId = undefined
      continue
    }
    for (const targetPlayer of state.players) {
      const targetSlot = targetPlayer.field.findIndex(
        (m) => m?.instanceId === source.clingTargetInstanceId,
      )
      if (targetSlot >= 0) {
        dealDamageToTarget(
          state,
          source,
          { kind: 'monster', player: targetPlayer.id, slot: targetSlot },
          10,
        )
      }
    }
  }

  const fairies = player.field.filter((monster) => monster?.defId === 'green_fairy').length
  if (fairies > 0) {
    state.pending = { kind: 'fairyHeal', owner: player.id, remaining: fairies }
    log(state, `Green Fairy: choose a card to heal 10 HP (${fairies} remaining).`)
    return
  }
  tickStatuses(state)
  healShrines(state)
  queueArrowShots(state)
}

function tickStatuses(state: GameState): void {
  const player = activePlayer(state)
  for (let slot = 0; slot < player.field.length; slot++) {
    const monster = player.field[slot]
    if (!monster) continue
    if (monster.equipment.some((equipment) => equipment.defId === 'saphire_ring')) {
      clearNegativeStatuses(state, monster)
      continue
    }

    const nextStatuses = []
    let slainBy: PlayerId | undefined
    for (const status of [...monster.statuses]) {
      if (status.kind === 'goo' || status.kind === 'cling' || status.kind === 'stone') {
        nextStatuses.push(status)
        continue
      }

      if (status.skipNextTick) {
        nextStatuses.push({ ...status, skipNextTick: false })
        continue
      }

      if ((status.kind === 'burn' || status.kind === 'poison') && status.sourcePlayer !== undefined && status.sourcePlayer !== player.id) {
        slainBy = status.sourcePlayer
      }
      if (status.kind === 'burn') {
        const endured = monster.unending && monster.hp - 20 <= 0
        if (endured) monster.hp = Math.min(monster.maxHp, 10)
        else monster.hp -= 20
        log(
          state,
          endured
            ? `${getMonster(monster.defId).name} takes 20 burn damage but endures at ${monster.hp} HP.`
            : `${getMonster(monster.defId).name} takes 20 burn damage (${Math.max(0, monster.hp)} HP left).`,
        )
      }
      if (status.kind === 'poison') {
        const acted = state.actedSlots.includes(slot) || state.movedSlots.includes(slot)
        const damage = acted ? 30 : 10
        const endured = monster.unending && monster.hp - damage <= 0
        if (endured) monster.hp = Math.min(monster.maxHp, 10)
        else monster.hp -= damage
        log(
          state,
          endured
            ? `${getMonster(monster.defId).name} takes ${damage} poison damage but endures at ${monster.hp} HP.`
            : `${getMonster(monster.defId).name} takes ${damage} poison damage (${Math.max(0, monster.hp)} HP left).`,
        )
      }

      const turnsLeft = status.turns - 1
      if (turnsLeft > 0) {
        nextStatuses.push({ ...status, turns: turnsLeft, skipNextTick: false })
      } else {
        log(state, `${status.kind} wore off on ${getMonster(monster.defId).name}.`)
      }
    }
    monster.statuses = nextStatuses

    if (monster.hp <= 0) {
      discardMonster(state, player, slot, 'slain', slainBy)
    }
  }
  checkLosses(state)
}

function expireHauntedMists(state: GameState, player: PlayerState): void {
  const kept = []
  for (const entry of player.ethereal ?? []) {
    if (entry.card.defId !== 'haunted_mists') {
      kept.push(entry)
      continue
    }
    player.discard.push(entry.card)
    log(state, `Haunted Mists fades from ${player.name}.`)
  }
  player.ethereal = kept.length > 0 ? kept : undefined
}

function expireStalks(state: GameState, playerId: PlayerId): void {
  for (const player of state.players) {
    for (const monster of player.field) {
      if (!monster?.stalkedBy) continue
      monster.stalkedBy = monster.stalkedBy.filter((source) => source !== playerId)
      if (monster.stalkedBy.length === 0) monster.stalkedBy = undefined
    }
  }
}

function healShrines(state: GameState): void {
  for (const player of state.players) {
    for (const entry of player.ethereal ?? []) {
      const monster = entry.attachedMonster
      if (!monster) continue
      const before = monster.hp
      monster.hp = Math.min(monster.maxHp, monster.hp + 10)
      recordHeal(state, monster.hp - before)
      if (monster.hp !== before) {
        log(state, `${getMonster(monster.defId).name} heals 10 from Shrine of Healing (now ${monster.hp} HP).`)
      }
    }
  }
}

function sealedArchers(state: GameState): { owner: PlayerId; instanceId: string }[] {
  const found: { owner: PlayerId; instanceId: string }[] = []
  for (const player of state.players) {
    for (const monster of player.field) {
      if (monster?.abilitiesSealed) found.push({ owner: player.id, instanceId: monster.instanceId })
    }
  }
  return found
}

function queueArrowShots(state: GameState): void {
  const archers = sealedArchers(state)
  const first = archers[0]
  if (!first) return
  state.pending = {
    kind: 'arrowVolley',
    owner: first.owner,
    instanceId: first.instanceId,
    queue: archers.slice(1),
  }
  log(state, 'Unrelenting Arrows may deal 10 damage to a card.')
}

function scheduledReturns(state: GameState, playerId: PlayerId) {
  const queue: { controller: PlayerId; instanceId: string; attached: boolean }[] = []
  for (const player of state.players) {
    for (const entry of player.ethereal ?? []) {
      if (entry.monster && entry.returnPlayer === playerId) {
        queue.push({ controller: player.id, instanceId: entry.monster.instanceId, attached: false })
      }
    }
  }
  return queue
}

function beginEtherealReturns(state: GameState): void {
  const queue = scheduledReturns(state, state.activePlayer)
  const waiting = []
  for (const item of queue) {
    const owner = state.players[item.controller]
    if (owner.field.every((monster) => monster !== null)) {
      const entry = (owner.ethereal ?? []).find((candidate) => candidate.monster?.instanceId === item.instanceId)
      if (entry?.monster) {
        owner.ethereal = (owner.ethereal ?? []).filter((candidate) => candidate !== entry)
        if (owner.ethereal.length === 0) owner.ethereal = undefined
        removeMonsterWithoutPoints(state, owner.id, entry.monster)
      }
      continue
    }
    waiting.push(item)
  }
  if (waiting.length === 0) return
  state.pending = { kind: 'etherealReturn', owner: state.activePlayer, queue: waiting }
  log(state, 'Choose an empty slot for the returning monster.')
}

function passTurn(state: GameState): void {
  const player = activePlayer(state)
  player.isFirstTurn = false
  player.hasFinishedFirstTurn = true
  player.healedLastTurn = player.healedThisTurn ?? 0
  player.healedThisTurn = 0
  if (player.blockEffects) player.blockEffects = undefined

  player.attackBonus = 0

  if (player.extraTurn) {
    player.extraTurn = false
    state.playedCardThisTurn = false
    state.cardsPlayedThisTurn = 0
    state.movedThisTurn = false
    state.movedSlots = []
    state.attachedEnergyThisTurn = false
    state.energyPool = 0
    state.blobEnergyPool = 0
    state.bannerEnergyPool = 0
    state.endStepResolved = false
    state.awaitingHandoff = true
    state.phase = 'draw'
    state.drewThisTurn = false
    state.abilityUsesLeft = 0
    state.actedSlots = []
    expireStalks(state, player.id)
    if (player.silenceNextTurn) {
      player.blockEffects = true
      player.silenceNextTurn = undefined
    }
    expireHauntedMists(state, player)
    log(state, `${player.name} takes another turn. Pass the device to ${player.name}.`)
    return
  }

  const nextId = otherPlayer(state.activePlayer)
  state.activePlayer = nextId
  state.playedCardThisTurn = false
  state.cardsPlayedThisTurn = 0
  state.movedThisTurn = false
  state.movedSlots = []
  state.attachedEnergyThisTurn = false
  state.energyPool = 0
  state.blobEnergyPool = 0
  state.bannerEnergyPool = 0
  state.endStepResolved = false
  state.awaitingHandoff = true

  const nextPlayer = activePlayer(state)
  expireStalks(state, nextPlayer.id)
  if (nextPlayer.silenceNextTurn) {
    nextPlayer.blockEffects = true
    nextPlayer.silenceNextTurn = undefined
  }
  expireHauntedMists(state, nextPlayer)
  if (nextPlayer.isFirstTurn) {
    beginMainPhase(state)
  } else {
    state.phase = 'draw'
    state.drewThisTurn = false
    state.abilityUsesLeft = 0
    state.actedSlots = []
  }
  log(state, `Pass the device to ${nextPlayer.name}.`)
}

function targetMonster(state: GameState, target: TargetRef | undefined): FieldMonster | null {
  if (!target || target.kind !== 'monster') return null
  return resolveTarget(state, target)?.monster ?? null
}

function dealsIceDamage(defId: string): boolean {
  return getMonster(defId).abilities.some(
    (ability) =>
      ability.effects.some(
        (effect) =>
          (effect.type === 'damage' ||
            effect.type === 'rollDamage' ||
            effect.type === 'chanceBoostDamage') &&
          effect.damageType === 'ice',
      ) ||
      ['iceyBeak', 'frostbite', 'frozenSting'].includes(ability.special ?? ''),
  )
}

function targetCurrentHp(state: GameState, target: TargetRef): number | null {
  const monster = state.players[target.player].field[target.slot]
  if (!monster) return null
  if (target.kind === 'equipment') return monster.equipment[target.equipmentIndex]?.hp ?? null
  return monster.hp
}

function absorbTarget(
  state: GameState,
  player: PlayerState,
  slot: number,
  target: TargetRef | undefined,
): void {
  const absorber = player.field[slot]
  if (!absorber || !target) return
  if (absorber.held) {
    const previous = absorber.held
    absorber.held = undefined
    releaseHeld(state, null, null, previous)
  }
  const live = player.field[slot]
  if (!live) return
  const hp = targetCurrentHp(state, target)
  if (hp === null || hp > live.hp) {
    log(state, 'Absorb has no legal target.')
    return
  }
  if (target.kind === 'monster' && target.player === player.id && target.slot === slot) return
  if (target.kind === 'monster') {
    const lifted = liftMonster(state, state.players[target.player], target.slot)
    if (!lifted) return
    live.held = { kind: 'monster', owner: target.player, fromSlot: target.slot, monster: lifted }
    log(state, `${getMonster(lifted.defId).name} is placed under ${getMonster(live.defId).name}.`)
  } else {
    const host = state.players[target.player].field[target.slot]
    const hostId = host?.instanceId
    const lifted = liftEquipment(state.players[target.player], target.slot, target.equipmentIndex)
    if (!lifted || !hostId) return
    live.held = {
      kind: 'equipment',
      owner: target.player,
      hostInstanceId: hostId,
      equipment: lifted,
    }
    log(state, `${getCard(lifted.defId).name} is placed under ${getMonster(live.defId).name}.`)
  }
  checkLosses(state)
}

function gooChargedTarget(state: GameState, target: TargetRef): void {
  const monster = targetMonster(state, target)
  if (!monster || target.kind !== 'monster') return
  applyStatus(monster, 'goo', 1, 1, undefined, target.player === state.activePlayer)
}

function chargedBlobTargets(state: GameState): TargetRef[] {
  const targets: TargetRef[] = []
  for (const player of state.players) {
    for (let slot = 0; slot < player.field.length; slot++) {
      const monster = player.field[slot]
      if (monster && isBlobMonster(monster.defId) && canReceiveEnergy(monster)) {
        targets.push({ kind: 'monster', player: player.id, slot })
      }
    }
  }
  return targets
}

function offerChargedEnergy(
  state: GameState,
  sourcePlayer: PlayerId,
  sourceSlot: number,
  again: boolean,
): void {
  const blobs = chargedBlobTargets(state)
  if (blobs.length === 1) {
    const only = blobs[0]
    const monster = only ? state.players[only.player].field[only.slot] : null
    if (monster && grantEnergy(state, monster, 1) > 0) {
      log(state, `${getMonster(monster.defId).name} gains 1 energy.`)
    }
  } else if (blobs.length > 1) {
    state.pending = { kind: 'chargedSplat', sourcePlayer, sourceSlot, step: 'energy', again }
    return
  }
  if (again) {
    state.pending = { kind: 'chargedSplat', sourcePlayer, sourceSlot, step: 'goo', again: false }
  }
}

function applySplat(
  state: GameState,
  player: PlayerState,
  slot: number,
  target: TargetRef | undefined,
  also: 'burn' | 'frozen',
): void {
  const attacker = player.field[slot]
  const monster = targetMonster(state, target)
  if (monster && target) {
    const skip = target.player === state.activePlayer
    applyStatus(monster, 'goo', 1, 1, undefined, skip)
    applyStatus(monster, also, also === 'burn' ? 3 : 2, 1, undefined, skip, player.id)
  }
  if (attacker && lensSuccessFaces(attacker, highFaces(1)).includes(rollDie(state))) {
    state.pending = { kind: 'repeatGoo', sourcePlayer: player.id, sourceSlot: slot, also }
  }
}

function resolveSpecialAbility(
  state: GameState,
  player: PlayerState,
  slot: number,
  special: string,
  action: Extract<GameAction, { type: 'USE_ABILITY' }>,
  energyBeforeSpend: number,
  requiredEnergy: number,
  skipSpend = false,
): void {
  const attacker = player.field[slot]
  if (!attacker) return
  const target = action.target
  switch (special) {
    case 'waterClaw':
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          energyBeforeSpend >= 2 ? 30 : 20,
          'untyped',
          false,
          requiredEnergy,
        )
      }
      break
    case 'waterGush':
      if (lensSuccessFaces(attacker, highFaces(5)).includes(rollDie(state)) && target) {
        const hitTarget =
          dealDamageToTarget(state, attacker, target, 20, 'water', false, requiredEnergy) ?? target
        const monster = targetMonster(state, hitTarget)
        if (monster) {
          applyStatus(monster, 'wet', 3, 1, undefined, hitTarget.player === state.activePlayer)
        }
      } else log(state, 'Water Gush missed.')
      break
    case 'spark':
      if (lensSuccessFaces(attacker, highFaces(3)).includes(rollDie(state))) {
        attacker.sparkedThisTurn = true
        log(state, 'Spark succeeds: base energy pool becomes 3.')
      } else log(state, 'Spark failed.')
      break
    case 'trickery': {
      const opponent = state.players[otherPlayer(player.id)]
      if (opponent.hand.length === 0) break
      const index = Math.floor(state.random() * opponent.hand.length)
      const [card] = opponent.hand.splice(index, 1)
      state.pending = { kind: 'trickery', owner: player.id, opponent: opponent.id, card }
      break
    }
    case 'bigSplat': {
      const monster = targetMonster(state, target)
      if (monster) {
        applyStatus(
          monster,
          'goo',
          1,
          1,
          undefined,
          target?.player === state.activePlayer,
        )
      }
      if (lensSuccessFaces(attacker, highFaces(1)).includes(rollDie(state))) {
        state.pending = { kind: 'repeatGoo', sourcePlayer: player.id, sourceSlot: slot }
      }
      break
    }
    case 'burningGoo': {
      const monster = targetMonster(state, target)
      if (!monster) break
      applyStatus(monster, 'goo', 1, 1, undefined, target?.player === state.activePlayer)
      if (getWeaknesses(monster.defId).includes('fire')) {
        applyStatus(monster, 'burn', 1, 1, undefined, target?.player === state.activePlayer)
      }
      break
    }
    case 'swarm': {
      const ally = target?.kind === 'monster' ? state.players[target.player].field[target.slot] : null
      if (!ally || target?.player !== player.id || !isBlobMonster(ally.defId)) break
      ally.extraAbilityUses = (ally.extraAbilityUses ?? 0) + 1
      log(state, `${getMonster(ally.defId).name} may take a free action.`)
      break
    }
    case 'cling': {
      for (const p of state.players) {
        for (const m of p.field) {
          if (!m) continue
          m.statuses = m.statuses.filter(
            (s) => s.kind !== 'cling' || s.sourceInstanceId !== attacker.instanceId,
          )
        }
      }
      attacker.clingTargetInstanceId = undefined
      const monster = targetMonster(state, target)
      if (monster && attacker.energy > 0 && applyStatus(monster, 'cling', 999, 1, attacker.instanceId)) {
        attacker.clingTargetInstanceId = monster.instanceId
      }
      break
    }
    case 'plasmaVolley': {
      const roll = rollDie(state)
      const hits = roll <= 2 ? 1 : roll <= 4 ? 2 : 3
      state.pending = {
        kind: 'multiHit', sourcePlayer: player.id, sourceSlot: slot,
        remaining: hits, amount: 20, damageType: 'electric',
        requiredEnergy,
      }
      break
    }
    case 'sizzlingShell':
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: 2,
        amount: 20,
        damageType: 'fire',
        requiredEnergy,
        statusChanceFaces: lensSuccessFaces(attacker, highFaces(2)),
        status: 'burn',
        statusTurns: 2,
      }
      break
    case 'healOther':
      if (target) healTarget(state, target, 20)
      break
    case 'energize':
      for (const m of player.field) if (m) grantEnergy(state, m, 1)
      state.skipEnergyPhase = true
      log(state, `All of ${player.name}'s monsters gain 1 energy.`)
      break
    case 'charge': {
      const extra = action.extraEnergy ?? 0
      if (!skipSpend) attacker.energy -= extra
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          20 + extra * 20,
          'untyped',
          false,
          requiredEnergy,
        )
      }
      break
    }
    case 'transferal': {
      const [sourceRef, destinationRef] = action.targets ?? []
      const source = targetMonster(state, sourceRef)
      const destination = targetMonster(state, destinationRef)
      if (source && destination && canReceiveEnergy(destination)) {
        const amount = Math.min(2, source.energy)
        source.energy -= amount
        grantEnergy(state, destination, amount)
        log(state, `Transferred ${amount} energy.`)
      }
      state.skipEnergyPhase = true
      break
    }
    case 'discharge':
      if (lensSuccessFaces(attacker, highFaces(4)).includes(rollDie(state)) && target) {
        dealDamageToTarget(state, attacker, target, 30, 'electric', false, requiredEnergy)
      }
      else log(state, 'Discharge missed.')
      break
    case 'drawOne': {
      const card = player.deck.shift()
      if (card) {
        player.hand.push(card)
        log(state, `${player.name} draws a card.`)
      }
      break
    }
    case 'mudball': {
      const roll = rollDie(state)
      const amount = roll <= 3 ? 10 : roll <= 5 ? 20 : 10
      if (target) {
        const hitTarget =
          dealDamageToTarget(state, attacker, target, amount, 'water', false, requiredEnergy) ??
          target
        if (roll === 6) {
          const monster = targetMonster(state, hitTarget)
          if (monster) {
            applyStatus(monster, 'wet', 3, 1, undefined, hitTarget.player === state.activePlayer)
          }
        }
      }
      break
    }
    case 'waterJet':
      if (lensSuccessFaces(attacker, highFaces(5)).includes(rollDie(state)) && target) {
        const hitTarget =
          dealDamageToTarget(state, attacker, target, 40, 'water', false, requiredEnergy) ?? target
        const monster = targetMonster(state, hitTarget)
        if (monster) {
          applyStatus(monster, 'wet', 3, 1, undefined, hitTarget.player === state.activePlayer)
        }
      } else {
        log(state, 'Water Jet missed.')
      }
      break
    case 'lostTreasure':
      state.pending = { kind: 'discardPick', owner: player.id, pileOwner: player.id }
      break
    case 'sunkenPlunder':
      state.pending = {
        kind: 'discardPick',
        owner: player.id,
        pileOwner: otherPlayer(player.id),
      }
      break
    case 'tentacleAttack':
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: 3,
        amount: 20,
        damageType: 'untyped',
        requiredEnergy,
      }
      break
    case 'absorb':
      state.pending = {
        kind: 'bury',
        owner: player.id,
        chosenInstanceIds: [],
        purpose: 'absorb',
        sourceSlot: slot,
        requiredEnergy,
      }
      break
    case 'hunt':
      state.pending = {
        kind: 'bury',
        owner: player.id,
        chosenInstanceIds: [],
        purpose: 'hunt',
        sourceSlot: slot,
        requiredEnergy,
        target,
      }
      break
    case 'iceyBeak':
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          energyBeforeSpend >= 2 ? 30 : 20,
          'ice',
          false,
          requiredEnergy,
        )
      }
      break
    case 'chillingScreech': {
      const count = player.field.filter((monster) => monster && dealsIceDamage(monster.defId)).length
      const legalTargets = state.players[otherPlayer(player.id)].field.filter(
        (monster) => monster?.stance === 'active',
      ).length || state.players[otherPlayer(player.id)].field.filter(Boolean).length
      const remaining = Math.min(count, legalTargets)
      if (remaining > 0) {
        state.pending = {
          kind: 'freezeTargets',
          sourcePlayer: player.id,
          sourceSlot: slot,
          remaining,
          turns: 2,
          chosenInstanceIds: [],
        }
      }
      break
    }
    case 'chill':
      for (const targetPlayer of state.players) {
        for (const monster of targetPlayer.field) {
          const frozen = monster?.statuses.find((status) => status.kind === 'frozen')
          if (frozen) frozen.turns += 1
        }
      }
      log(state, 'Every Frozen monster remains Frozen for one additional turn.')
      break
    case 'skipOpponentEnergy': {
      const opponent = state.players[otherPlayer(player.id)]
      opponent.skipEnergyPhases += 1
      log(state, `${opponent.name} will skip their next energy phase.`)
      break
    }
    case 'frostbite':
      if (target) {
        const hitTarget =
          dealDamageToTarget(state, attacker, target, 20, 'ice', false, requiredEnergy) ?? target
        const monster = targetMonster(state, hitTarget)
        if (monster) {
          applyStatus(
            monster,
            'frozen',
            energyBeforeSpend,
            1,
            undefined,
            hitTarget.player === state.activePlayer,
          )
        }
      }
      break
    case 'frozenSting': {
      const roll = rollDie(state)
      const amount = roll === 1 ? 10 : roll <= 3 ? 20 : roll <= 5 ? 30 : 20
      if (target) {
        const hitTarget =
          dealDamageToTarget(state, attacker, target, amount, 'ice', false, requiredEnergy) ?? target
        if (roll === 6) {
          const monster = targetMonster(state, hitTarget)
          if (monster) {
            applyStatus(
              monster,
              'frozen',
              2,
              1,
              undefined,
              hitTarget.player === state.activePlayer,
            )
          }
        }
      }
      break
    }
    case 'lightningNeedle': {
      const extra = Math.min(3, action.extraEnergy ?? 0)
      if (!skipSpend) attacker.energy -= extra
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          20 + extra * 20,
          'electric',
          false,
          requiredEnergy,
        )
      }
      break
    }
    case 'hauntingCry':
      for (const monster of player.field) {
        if (!monster) continue
        if (getMonster(monster.defId).abilities.filter((ability) => ability.ice).length >= 2) {
          grantEnergy(state, monster, 1)
        }
      }
      log(state, 'Monsters with at least two ice abilities gain 1 energy.')
      break
    case 'freezeTwo':
      state.pending = {
        kind: 'freezeTargets',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: 2,
        turns: 2,
        chosenInstanceIds: [],
      }
      break
    case 'frostBreath':
      state.pending = {
        kind: 'freezeTargets',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: 2,
        turns: 2,
        chosenInstanceIds: [],
        discardPlayer: otherPlayer(player.id),
      }
      break
    case 'gleam': {
      if (target) {
        healTarget(state, target, 10)
        const ally = targetMonster(state, target)
        if (ally) {
          ally.illuminatedThisTurn = true
          log(state, `${getMonster(ally.defId).name} is illuminated.`)
        }
      }
      break
    }
    case 'healingLight': {
      if (target?.kind === 'equipment') {
        healTarget(state, target, 20)
        break
      }
      const ally = target ? targetMonster(state, target) : undefined
      if (ally && target) {
        const clingSources = ally.statuses
          .filter((status) => status.kind === 'cling' && status.sourceInstanceId)
          .map((status) => status.sourceInstanceId!)
        ally.statuses = []
        for (const sourceId of clingSources) {
          for (const owner of state.players) {
            for (const monster of owner.field) {
              if (monster?.instanceId === sourceId) monster.clingTargetInstanceId = undefined
            }
          }
        }
        healTarget(state, target, 20)
        log(state, `${getMonster(ally.defId).name} is cleansed.`)
      }
      break
    }
    case 'chorus': {
      const others = player.field.filter((monster, index) => monster && index !== slot).length
      if (target) {
        dealDamageToTarget(state, attacker, target, 20 + others * 10, 'light', false, requiredEnergy)
      }
      break
    }
    case 'flurryOfBlows': {
      const hits = Math.min(3, Math.max(0, action.extraEnergy ?? 0))
      if (!skipSpend) attacker.energy -= hits
      if (target && hits > 0) {
        dealDamageToTarget(state, attacker, target, hits * 30, 'untyped', false, requiredEnergy)
      }
      break
    }
    case 'knightsHonour':
      attacker.honourGuardUntilNextTurn = true
      log(state, `${getMonster(attacker.defId).name} swears Knight's Honour.`)
      break
    case 'lavaClaw':
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          energyBeforeSpend >= 2 ? 30 : 20,
          'untyped',
          false,
          requiredEnergy,
        )
      }
      break
    case 'magmaGush':
      if (lensSuccessFaces(attacker, highFaces(5)).includes(rollDie(state)) && target) {
        const hitTarget =
          dealDamageToTarget(state, attacker, target, 40, 'fire', false, requiredEnergy) ?? target
        const monster = targetMonster(state, hitTarget)
        if (monster) {
          applyStatus(monster, 'burn', 3, 1, undefined, hitTarget.player === state.activePlayer)
        }
      } else log(state, 'Magma Gush missed.')
      break
    case 'solarFlare': {
      const extra = Math.min(1, action.extraEnergy ?? 0)
      if (!skipSpend) attacker.energy -= extra
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          extra > 0 ? 30 : 20,
          'light',
          false,
          requiredEnergy,
        )
      }
      break
    }
    case 'sunburn':
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: energyBeforeSpend >= 2 ? 4 : 3,
        amount: 10,
        damageType: 'fire',
        requiredEnergy,
      }
      break
    case 'overheat':
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: 3,
        amount: 10,
        damageType: 'fire',
        requiredEnergy,
        status: 'burn',
        statusTurns: 3,
      }
      break
    case 'eyeFlash':
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: 2,
        amount: 0,
        damageType: 'fire',
        requiredEnergy,
        status: 'burn',
        statusTurns: 2,
      }
      break
    case 'stampede':
      if (target?.kind === 'monster') {
        dealDamageToTarget(state, attacker, target, 30, 'fire', false, requiredEnergy)
        const splash =
          action.targets?.[1] ??
          getCircleAdjacent(state, target.player, target.slot).find((candidate) => {
            const monster = targetMonster(state, candidate)
            return Boolean(monster && monster.stance === 'withdrawn')
          })
        if (splash) {
          dealDamageToTarget(state, attacker, splash, 30, 'fire', false, requiredEnergy)
        }
      }
      break
    case 'rocket':
      resolveRocket(state, attacker, target, requiredEnergy)
      break
    case 'chaosFireworks': {
      const opponent = state.players[otherPlayer(player.id)]
      for (let i = 0; i < 3; i++) {
        const enemies = opponent.field
          .map((monster, enemySlot) => (monster ? enemySlot : -1))
          .filter((enemySlot) => enemySlot >= 0)
        if (enemies.length === 0) break
        const pick = enemies[Math.floor(state.random() * enemies.length)]
        log(state, `Chaos of Fireworks rockets slot ${pick + 1}.`)
        resolveRocket(
          state,
          attacker,
          { kind: 'monster', player: opponent.id, slot: pick },
          requiredEnergy,
        )
      }
      break
    }
    case 'pilfer':
      if (target) {
        dealDamageToTarget(state, attacker, target, 10, 'shadow', false, requiredEnergy)
      }
      beginForcedDiscard(state, otherPlayer(player.id), 1)
      break
    case 'spy':
      state.pending = { kind: 'spy', owner: player.id }
      break
    case 'griefBolt':
      state.pending = { kind: 'griefDestroy', owner: player.id, chosenInstanceIds: [] }
      break
    case 'bottleToxins': {
      const turns = countPoisonCardsInPlay(player)
      for (const ref of action.targets ?? []) {
        if (ref.kind !== 'monster') continue
        const hitTarget =
          dealDamageToTarget(state, attacker, ref, 10, 'poison', false, requiredEnergy) ?? ref
        const monster = targetMonster(state, hitTarget)
        if (monster && turns > 0) {
          applyStatus(
            monster,
            'poison',
            turns,
            1,
            undefined,
            hitTarget.player === state.activePlayer,
          )
        }
      }
      break
    }
    case 'transmutation':
      state.pending = { kind: 'transmuteHand', owner: player.id }
      break
    case 'imilithiasBrew':
      if (target) {
        state.pending = { kind: 'brewWeakness', owner: player.id, target }
      }
      break
    case 'zap': {
      const extra = Math.min(1, action.extraEnergy ?? 0)
      if (!skipSpend) attacker.energy -= extra
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          extra > 0 ? 40 : 20,
          'electric',
          false,
          requiredEnergy,
        )
      }
      break
    }
    case 'storm':
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: 4,
        amount: 10,
        damageType: 'electric',
        requiredEnergy,
        piercing: true,
      }
      break
    case 'plasmaCannon': {
      state.pending = {
        kind: 'plasmaCannon',
        sourcePlayer: player.id,
        sourceSlot: slot,
        hits: 0,
        misses: 0,
        requiredEnergy,
      }
      applyPlasmaRoll(state)
      break
    }
    case 'lingeringEnergy':
      player.lingeringEnergy = true
      log(state, `${player.name}'s next ability treats + as 0.`)
      break
    case 'soundWave':
      state.pending = {
        kind: 'soundWave',
        sourcePlayer: player.id,
        sourceSlot: slot,
        chosenInstanceIds: [],
        requiredEnergy,
      }
      break
    case 'collect': {
      const source = targetMonster(state, target)
      const amount = Math.min(action.extraEnergy ?? 0, source?.energy ?? 0)
      if (source && amount > 0 && canReceiveEnergy(attacker)) {
        source.energy -= amount
        grantEnergy(state, attacker, amount)
        log(state, `Collected ${amount} energy.`)
      }
      break
    }
    case 'supply': {
      const destination = targetMonster(state, target)
      const amount = Math.min(action.extraEnergy ?? 0, attacker.energy)
      if (destination && amount > 0 && canReceiveEnergy(destination)) {
        attacker.energy -= amount
        grantEnergy(state, destination, amount)
        log(state, `Supplied ${amount} energy.`)
      }
      break
    }
    case 'channel': {
      const gained = countElectricCardsInPlay(player, attacker.instanceId)
      const attached = grantEnergy(state, attacker, gained)
      log(state, `${getMonster(attacker.defId).name} Channels ${attached} energy.`)
      break
    }
    case 'guardiansBlade':
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          energyBeforeSpend >= 2 ? 40 : 20,
          'untyped',
          false,
          requiredEnergy,
        )
      }
      break
    case 'eldersEye': {
      const count = Math.min(3, player.deck.length)
      if (count === 0) {
        log(state, `${player.name}'s deck is empty.`)
        break
      }
      const cards = player.deck.splice(0, count)
      state.pending = { kind: 'eldersEye', owner: player.id, cards, order: [] }
      log(state, `${player.name} looks at the top ${count} card${count === 1 ? '' : 's'}.`)
      break
    }
    case 'groundShaker':
      if (target && target.kind === 'monster') {
        const neighbors = getCircleAdjacent(state, target.player, target.slot)
        if (neighbors.length >= 2) {
          for (const hit of [target, ...neighbors]) {
            dealDamageToTarget(state, attacker, hit, 20, 'earth', false, requiredEnergy)
          }
        }
      }
      break
    case 'meatShield':
    case 'guard':
    case 'ancientGuardian':
    case 'treasureKeepers': {
      const ward = targetMonster(state, target)
      if (!ward || !target || target.kind !== 'monster' || target.player !== player.id) break
      if (special === 'meatShield' && !isOrcOrGoblin(ward.defId)) break
      beginProtection(state, attacker, ward)
      break
    }
    case 'burrow':
      if (!isGooed(attacker) && !isClinged(attacker)) {
        const nextStance = attacker.stance === 'active' ? 'withdrawn' : 'active'
        if (nextStance === 'withdrawn' && isBoneling(attacker)) {
          dieInsteadOfWithdraw(state, player.id, slot)
          break
        }
        attacker.stance = nextStance
        if (nextStance === 'withdrawn') releaseProtection(state, attacker)
        if (!state.movedSlots.includes(slot)) state.movedSlots.push(slot)
        log(state, `${getMonster(attacker.defId).name} ${nextStance === 'active' ? 'advances' : 'withdraws'} with Burrow.`)
      }
      break
    case 'underground':
      if (target) dealDamageToTarget(state, attacker, target, 20, 'earth', false, requiredEnergy)
      break
    case 'ironTail':
      if (lensSuccessFaces(attacker, highFaces(4)).includes(rollDie(state)) && target) {
        const hit = dealDamageToTarget(state, attacker, target, 40, 'untyped', false, requiredEnergy)
        const monster = hit ? targetMonster(state, hit) : null
        if (monster && hit && applyStatus(monster, 'weakened', 1, 1, undefined, hit.player === state.activePlayer)) {
          log(state, `${getMonster(monster.defId).name} is Weakened.`)
        }
      } else log(state, 'Iron Tail Lash missed.')
      break
    case 'smash':
      if (target) {
        const roll = rollDie(state)
        const amount = roll <= 2 ? 30 : roll <= 4 ? 40 : 50
        const hit = dealDamageToTarget(state, attacker, target, amount, 'untyped', false, requiredEnergy)
        const monster = hit ? targetMonster(state, hit) : null
        if (monster && hit && applyStatus(monster, 'weakened', 1, 1, undefined, hit.player === state.activePlayer)) {
          log(state, `${getMonster(monster.defId).name} is Weakened.`)
        }
      }
      break
    case 'fortify':
      if ((attacker.fortifyHitsLeft ?? 0) > 0) {
        log(state, `${getMonster(attacker.defId).name}'s Fortify is already active.`)
      } else {
        attacker.fortifyHitsLeft = 2
        log(state, `${getMonster(attacker.defId).name} fortifies until it is hit twice.`)
      }
      break
    case 'quake':
      for (let oppSlot = 0; oppSlot < state.players[otherPlayer(player.id)].field.length; oppSlot++) {
        const monster = state.players[otherPlayer(player.id)].field[oppSlot]
        if (!monster) continue
        dealDamageToTarget(
          state,
          attacker,
          { kind: 'monster', player: otherPlayer(player.id), slot: oppSlot },
          10,
          'earth',
          false,
          requiredEnergy,
        )
      }
      break
    case 'openFourthFloor':
      if (target) {
        dealDamageToTarget(state, attacker, target, 20, 'untyped', false, requiredEnergy)
        const drawn = player.deck.shift()
        if (drawn) {
          player.hand.push(drawn)
          log(state, `${player.name} draws a card.`)
        }
      }
      break
    case 'magicDoor': {
      const moved = targetMonster(state, target)
      if (
        moved &&
        target &&
        target.kind === 'monster' &&
        target.player === player.id &&
        !isGooed(moved) &&
        !isClinged(moved)
      ) {
        const nextStance = moved.stance === 'active' ? 'withdrawn' : 'active'
        if (nextStance === 'withdrawn' && isBoneling(moved)) {
          dieInsteadOfWithdraw(state, target.player, target.slot)
          break
        }
        moved.stance = nextStance
        if (nextStance === 'withdrawn') releaseProtection(state, moved)
        if (!state.movedSlots.includes(target.slot)) state.movedSlots.push(target.slot)
        log(
          state,
          `${getMonster(moved.defId).name} ${nextStance === 'active' ? 'advances' : 'withdraws'} through Magic Door.`,
        )
      }
      break
    }
    case 'wormStorm':
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: 3,
        amount: 70,
        damageType: 'electric',
        requiredEnergy,
      }
      break
    case 'greatAxe':
      if (target) {
        const doubled = lensSuccessFaces(attacker, highFaces(4)).includes(rollDie(state))
        dealDamageToTarget(
          state,
          attacker,
          target,
          20,
          'untyped',
          false,
          requiredEnergy,
          doubled,
        )
      }
      break
    case 'dwarvenSpirit':
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          20 + (attacker.gold ?? 0) * 10,
          'untyped',
          false,
          requiredEnergy,
        )
      }
      break
    case 'gainGold':
      beginAssignGold(state, player, 1)
      break
    case 'theft': {
      if (!target || target.kind !== 'equipment') break
      const host = resolveTarget(state, target)
      const equipment = host?.monster.equipment[target.equipmentIndex]
      if (!host || !equipment) break
      if (attacker.equipment.some((held) => held.defId === equipment.defId)) break
      host.monster.equipment.splice(target.equipmentIndex, 1)
      attacker.equipment.push(equipment)
      log(
        state,
        `${getMonster(attacker.defId).name} steals ${getCard(equipment.defId).name} from ${getMonster(host.monster.defId).name}.`,
      )
      break
    }
    case 'dragonTalons':
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          energyBeforeSpend >= 3 ? 60 : 40,
          'untyped',
          false,
          requiredEnergy,
        )
      }
      break
    case 'burningBreath':
      for (const breathTarget of action.targets ?? []) {
        if (breathTarget.kind !== 'monster') continue
        const hit = dealDamageToTarget(
          state,
          attacker,
          breathTarget,
          60,
          'fire',
          false,
          requiredEnergy,
        )
        const burned = hit ? targetMonster(state, hit) : null
        if (burned) applyStatus(burned, 'burn', 3)
      }
      break
    case 'archersKeep': {
      const marked = new Set(player.damagedByInstanceIds ?? [])
      let hits = 0
      for (const owner of state.players) {
        for (let fieldSlot = 0; fieldSlot < owner.field.length; fieldSlot++) {
          const markedMonster = owner.field[fieldSlot]
          if (!markedMonster || !marked.has(markedMonster.instanceId)) continue
          hits += 1
          dealDamageToTarget(
            state,
            attacker,
            { kind: 'monster', player: owner.id, slot: fieldSlot },
            20,
          )
        }
      }
      if (hits === 0) log(state, 'No card has damaged your cards.')
      break
    }
    case 'poisonGas': {
      for (const ref of action.targets ?? []) {
        if (ref.kind !== 'monster') continue
        const hitTarget =
          dealDamageToTarget(state, attacker, ref, 20, 'poison', false, requiredEnergy) ?? ref
        const monster = targetMonster(state, hitTarget)
        if (
          monster &&
          lensSuccessFaces(attacker, highFaces(4)).includes(rollDie(state))
        ) {
          applyStatus(
            monster,
            'poison',
            3,
            1,
            undefined,
            hitTarget.player === state.activePlayer,
          )
        }
      }
      break
    }
    case 'greenHeal':
      if (target?.kind === 'monster') healTarget(state, target, 30)
      break
    case 'teamAttack': {
      const remaining = countWoodySpears(state.players, player.hand)
      if (remaining <= 0) break
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining,
        amount: 0,
        damageType: 'untyped',
        requiredEnergy,
        strike: 'spear',
      }
      break
    }
    case 'multiply':
      state.pending = { kind: 'placeWeed', owner: player.id }
      log(state, "Choose where to place Lovni's Weed.")
      break
    case 'scent': {
      if (!target) break
      const others = player.field.filter(
        (monster) =>
          monster &&
          monster.defId === 'lovnis_weed' &&
          monster.instanceId !== attacker.instanceId,
      ).length
      dealDamageToTarget(state, attacker, target, 10 + others * 10, 'poison', false, requiredEnergy)
      break
    }
    case 'tripleChomp':
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: attacker.hp < 70 ? 1 : attacker.hp < 130 ? 2 : 3,
        amount: 0,
        damageType: 'untyped',
        requiredEnergy,
        strike: 'chomp',
      }
      break
    case 'healingHands': {
      const host = target ? state.players[target.player].field[target.slot] : null
      if (target && host && !isFireMonster(host.defId)) healTarget(state, target, 30)
      break
    }
    case 'growth': {
      const monster = targetMonster(state, target)
      if (!monster || !isPlant(identityDefId(monster)) || target?.player !== player.id) break
      monster.maxHp += 20
      monster.hp += 20
      log(
        state,
        `${getMonster(monster.defId).name} grows to ${monster.hp}/${monster.maxHp} HP.`,
      )
      break
    }
    case 'vineWhip': {
      if (!target || target.kind !== 'monster') break
      dealDamageToTarget(state, attacker, target, 20, 'untyped', false, requiredEnergy)
      const monster = targetMonster(state, target)
      if (!monster || monster.stance !== 'withdrawn') break
      if (isGooed(monster) || isClinged(monster)) {
        log(state, `${getMonster(monster.defId).name} is stuck and does not advance.`)
        break
      }
      monster.stance = 'active'
      if (target.player === state.activePlayer && !state.movedSlots.includes(target.slot)) {
        state.movedSlots.push(target.slot)
      }
      log(state, `${getMonster(monster.defId).name} advances.`)
      break
    }
    case 'burningSpear': {
      if (target) {
        const hitTarget =
          dealDamageToTarget(state, attacker, target, 30, 'fire', false, requiredEnergy) ?? target
        const monster = targetMonster(state, hitTarget)
        if (monster) {
          applyStatus(
            monster,
            'burn',
            3,
            1,
            undefined,
            hitTarget.player === state.activePlayer,
          )
        }
      }
      const self = player.field[slot]
      if (self && lensHarmFaces(self, lowFaces(2)).includes(rollDie(state))) {
        dealDamageToTarget(
          state,
          null,
          { kind: 'monster', player: player.id, slot },
          20,
        )
      }
      break
    }
    case 'downpour': {
      const targets = withoutProtected(state, anyCardTargets(state))
      if (targets.length === 0) break
      const hits = Math.min(3, targets.length)
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: hits,
        amount: 10,
        damageType: 'water',
        requiredEnergy,
        status: 'wet',
        statusTurns: 3,
        scope: 'any',
        excludeInstanceIds: [],
      }
      log(state, `Downpour: choose ${hits} different card${hits === 1 ? '' : 's'}.`)
      break
    }
    case 'gale': {
      if (!target) break
      dealDamageToTarget(state, attacker, target, 30, 'wind', false, requiredEnergy)
      offerWithdraw(state, target, true)
      break
    }
    case 'tailGale': {
      if (!target) break
      dealDamageToTarget(state, attacker, target, 30, 'wind', false, requiredEnergy)
      offerWithdraw(state, target, false)
      break
    }
    case 'stormCommand': {
      const ally = target?.kind === 'monster' ? state.players[target.player].field[target.slot] : null
      if (!ally || target?.player !== player.id || !countsAsElementalCard(ally.defId)) break
      ally.extraAbilityUses = (ally.extraAbilityUses ?? 0) + 1
      log(state, `${getMonster(ally.defId).name} may take an additional action.`)
      break
    }
    case 'bringTheStorm': {
      const amount = 40 + countOtherStormlings(player, attacker.instanceId) * 10
      state.pending = {
        kind: 'stormType',
        sourcePlayer: player.id,
        sourceSlot: slot,
        amount,
        requiredEnergy,
      }
      log(state, `Bring the STORM will deal ${amount} damage. Choose electric or water.`)
      break
    }
    case 'relentless':
      attacker.extraAbilityUses = (attacker.extraAbilityUses ?? 0) + 1
      attacker.unending = true
      log(state, `${getMonster(attacker.defId).name} can act once more, and endures until its next turn.`)
      break
    case 'attack':
      state.abilityUsesLeft += 2
      player.attackBonus = (player.attackBonus ?? 0) + 10
      log(state, `${player.name}'s attacks deal +10 damage this turn.`)
      break
    case 'drawTwo': {
      let drawn = 0
      for (let i = 0; i < 2; i++) {
        const card = player.deck.shift()
        if (!card) break
        player.hand.push(card)
        drawn++
      }
      log(state, `${player.name} draws ${drawn} card${drawn === 1 ? '' : 's'}.`)
      break
    }
    case 'magicMusic':
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: 2,
        amount: 20,
        damageType: 'sonic',
        requiredEnergy,
      }
      break
    case 'bringForthTheDead':
      state.pending = { kind: 'bringForth', owner: player.id, sourceSlot: slot }
      log(state, 'Destroy a card in your discard, then place a Boneling.')
      break
    case 'summonBonelings':
      state.pending = { kind: 'placeBoneling', owner: player.id, remaining: 2 }
      log(state, 'Place two Bonelings.')
      break
    case 'cloudOfDarkness':
      state.pending = {
        kind: 'cloudDestroy',
        owner: player.id,
        sourceSlot: slot,
        chosenInstanceIds: [],
      }
      log(state, 'Choose any number of discarded cards to destroy.')
      break
    case 'shapeshift':
      state.pending = { kind: 'shapeshiftPick', owner: player.id, slot }
      log(state, 'Choose a monster card worth 3 points or less.')
      break
    case 'raid':
      if (target) {
        dealDamageToTarget(state, attacker, target, 30, 'untyped', false, requiredEnergy)
        if (takeLastDealt() > 0) {
          if (state.pending) state.pendingStack.push(state.pending)
          beginAssignGold(state, player, 1)
        }
      }
      break
    case 'speakerRally':
      for (const chosen of action.targets ?? []) {
        const monster = targetMonster(state, chosen)
        if (monster) grantEnergy(state, monster, 1)
      }
      attacker.speakerArmed = true
      log(state, `${getMonster(attacker.defId).name} rallies, and its passive awakens.`)
      break
    case 'uprising':
      state.pending = {
        kind: 'playCards',
        owner: player.id,
        played: 0,
        from: 'hand',
        monstersOnly: true,
        grantEnergy: 1,
      }
      log(state, 'Play any number of monsters. Each enters with 1 energy.')
      break
    case 'veridianFires':
      state.pending = { kind: 'veridianFires', owner: player.id, slot }
      log(state, 'Choose how much HP Veridian Fires spends.')
      break
    case 'veridianBloodcraft':
      state.pending = { kind: 'bloodcraft', owner: player.id, slot }
      log(state, 'Choose a sword, spear, shield, or Lifesteal Blade.')
      break
    case 'spellCasting': {
      const index = player.deck.findIndex((card) => getCard(card.defId).kind === 'effect')
      if (index >= 0) {
        const [found] = player.deck.splice(index, 1)
        player.hand.push(found)
        log(state, `${player.name} adds ${getCard(found.defId).name} to their hand.`)
      } else {
        log(state, `${player.name} finds no effect in their deck.`)
      }
      state.pending = {
        kind: 'playCards',
        owner: player.id,
        played: 0,
        from: 'hand',
        limit: 1,
        freePlay: true,
        effectsOnly: true,
        spellSourceInstanceId: attacker.instanceId,
      }
      log(state, 'You may play an effect for free.')
      break
    }
    case 'bigRedSplat':
      applySplat(state, player, slot, target, 'burn')
      break
    case 'bigBlueSplat':
      applySplat(state, player, slot, target, 'frozen')
      break
    case 'freezingGoop': {
      const monster = targetMonster(state, target)
      if (!monster || !target) break
      const skip = target.player === state.activePlayer
      applyStatus(monster, 'goo', 1, 1, undefined, skip)
      const weaknesses = monster.weaknessOverride
        ? [monster.weaknessOverride]
        : getWeaknesses(identityDefId(monster))
      if (weaknesses.includes('ice')) {
        applyStatus(monster, 'frozen', 2, 1, undefined, skip, player.id)
      }
      break
    }
    case 'fireball':
      state.pending = { kind: 'fireballDiscard', owner: player.id, slot }
      break
    case 'arcaneTome':
      state.pending = { kind: 'tomePick', owner: player.id, slot }
      break
    case 'summonElement':
      state.pending = { kind: 'summonType', owner: player.id, slot }
      break
    case 'enchantMonster':
      if (target?.kind === 'monster') {
        state.pending = { kind: 'enchantStone', owner: player.id, target }
      }
      break
    case 'blobAbsorb':
      absorbTarget(state, player, slot, target)
      break
    case 'chargedSplat':
      if (target) {
        const again = lensSuccessFaces(attacker, highFaces(1)).includes(rollDie(state))
        gooChargedTarget(state, target)
        offerChargedEnergy(state, player.id, slot, again)
      }
      break
    case 'stalk': {
      const marked = targetMonster(state, target)
      if (!marked || !target || target.kind !== 'monster') break
      marked.stalkedBy = [...new Set([...(marked.stalkedBy ?? []), player.id])]
      log(state, `${getMonster(marked.defId).name} is Stalked until ${player.name}'s next turn.`)
      break
    }
    case 'silence': {
      const opponent = state.players[otherPlayer(player.id)]
      opponent.silenceNextTurn = true
      log(state, `${opponent.name} may not play effects on their next turn.`)
      break
    }
    case 'unrelentingArrows':
      attacker.abilitiesSealed = true
      log(state, `${getMonster(attacker.defId).name} may not use an ability for the rest of the game.`)
      break
    case 'bodyGuard': {
      const guard = targetMonster(state, target)
      if (!guard || !target || target.kind !== 'monster' || target.player !== player.id) break
      if (guard.instanceId === attacker.instanceId) break
      beginProtection(state, guard, attacker)
      break
    }
    case 'tax': {
      const opponent = state.players[otherPlayer(player.id)]
      if (opponent.hand.length === 0) {
        attacker.gold = (attacker.gold ?? 0) + 1
        log(state, `${getMonster(attacker.defId).name} gains 1 gold.`)
        break
      }
      state.pending = { kind: 'tax', owner: opponent.id, sourcePlayer: player.id, sourceSlot: slot }
      log(state, `${opponent.name} gives a card from hand, or chooses a card they control to take 50 damage.`)
      break
    }
    case 'soar': {
      const chosen = targetMonster(state, target)
      if (!chosen || !target || target.kind !== 'monster') break
      if (chosen.instanceId === attacker.instanceId) break
      const targetOwner = state.players[target.player]
      becomeEthereal(state, targetOwner, target.slot, player.id)
      const selfSlot = player.field.findIndex((monster) => monster?.instanceId === attacker.instanceId)
      if (selfSlot >= 0) becomeEthereal(state, player, selfSlot, player.id)
      break
    }
    case 'dancingWind':
      if (target) dealDamageToTarget(state, attacker, target, 10, 'wind', false, requiredEnergy)
      {
        const selfSlot = player.field.findIndex((monster) => monster?.instanceId === attacker.instanceId)
        if (selfSlot >= 0) becomeEthereal(state, player, selfSlot)
      }
      break
    case 'renderAid': {
      for (const heal of action.targets ?? []) healTarget(state, heal, 30)
      player.bonusEnergy = (player.bonusEnergy ?? 0) + 1
      log(state, `${player.name} gains 1 additional energy in the energy phase.`)
      break
    }
    case 'wisdomWinds': {
      const count = countEtherealCards(state)
      if (count === 0) {
        log(state, 'No Ethereal cards are in play.')
        break
      }
      const receiver = state.players.some((side) => side.field.some((monster) => monster && canReceiveEnergy(monster)))
      if (!receiver) {
        log(state, 'No card can gain energy.')
        break
      }
      state.pending = { kind: 'wisdomEnergy', owner: player.id, slot, remaining: count }
      log(state, `Choose a card to gain 1 energy (${count} remaining).`)
      break
    }
    case 'stormComing':
      attacker.abilitiesUnlocked = true
      log(state, `${getMonster(attacker.defId).name} unlocks its other abilities.`)
      break
    case 'sandstorm':
      for (const side of state.players) {
        for (let index = 0; index < side.field.length; index++) {
          const monster = side.field[index]
          if (!monster || monster.instanceId === attacker.instanceId) continue
          dealDamageToTarget(
            state,
            attacker,
            { kind: 'monster', player: side.id, slot: index },
            30,
            'untyped',
            false,
            requiredEnergy,
            false,
            ['earth', 'wind'],
          )
        }
      }
      break
    case 'buriedAlive': {
      const victim = targetMonster(state, target)
      if (!victim) break
      if (victim.equipment.some((equipment) => equipment.defId === 'saphire_ring')) {
        log(state, `${getMonster(victim.defId).name} is immune to negative status effects.`)
        break
      }
      victim.clingTargetInstanceId = undefined
      for (const side of state.players) {
        for (const other of side.field) {
          if (other?.clingTargetInstanceId === victim.instanceId) other.clingTargetInstanceId = undefined
        }
      }
      victim.statuses = []
      if (applyStatus(victim, 'stone', 0, 1, undefined, false, player.id)) {
        const stone = victim.statuses.find((status) => status.kind === 'stone')
        if (stone) stone.cure = 'skipEnergy'
        log(state, `${getMonster(victim.defId).name} becomes Stone.`)
      }
      break
    }
    case 'ancientPowers': {
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          20,
          'untyped',
          false,
          requiredEnergy,
          false,
          [...ELEMENTAL_TYPES],
        )
      }
      const adjacent = getCircleAdjacent(state, player.id, slot)
      if (adjacent.length === 1) {
        const neighbor = targetMonster(state, adjacent[0])
        if (neighbor && grantEnergy(state, neighbor, 1) > 0) {
          log(state, `${getMonster(neighbor.defId).name} gains 1 energy.`)
        }
      } else if (adjacent.length > 1) {
        state.pending = { kind: 'starbeamEnergy', owner: player.id, slot }
      }
      break
    }
  }
}

function monsterIsStuck(monster: FieldMonster): boolean {
  return isGooed(monster) || isClinged(monster)
}

function forceWithdraw(state: GameState, playerId: PlayerId, slot: number): void {
  const player = state.players[playerId]
  const monster = player.field[slot]
  if (!monster || monster.stance === 'withdrawn') return
  if (monsterIsStuck(monster)) {
    log(state, `${getMonster(monster.defId).name} is stuck and does not withdraw.`)
    return
  }
  if (isBoneling(monster)) {
    dieInsteadOfWithdraw(state, playerId, slot)
    return
  }
  monster.stance = 'withdrawn'
  if (monster.protectingInstanceId) releaseProtection(state, monster)
  if (playerId === state.activePlayer && !state.movedSlots.includes(slot)) {
    state.movedSlots.push(slot)
  }
  log(state, `${getMonster(monster.defId).name} withdraws.`)
}

function offerWithdraw(state: GameState, target: TargetRef, optional: boolean): void {
  const monster = state.players[target.player].field[target.slot]
  if (!monster || monster.stance === 'withdrawn') return
  if (monsterIsStuck(monster)) {
    log(state, `${getMonster(monster.defId).name} is stuck and does not withdraw.`)
    return
  }
  if (!optional) {
    forceWithdraw(state, target.player, target.slot)
    return
  }
  state.pending = { kind: 'forceWithdraw', player: target.player, slot: target.slot }
  log(state, `Choose whether ${getMonster(monster.defId).name} withdraws.`)
}

function applyPlasmaRoll(state: GameState): void {
  const pending = state.pending
  if (!pending || pending.kind !== 'plasmaCannon') return
  const roll = rollDie(state)
  if (roll <= 2) {
    pending.misses += 1
    log(state, `Plasma Cannon miss (${pending.misses}/2).`)
    if (pending.misses >= 2) {
      log(state, 'Plasma Cannon fails.')
      clearPending(state)
    }
  } else {
    pending.hits += 1
    log(state, `Plasma Cannon hit (${pending.hits} × 20 = ${pending.hits * 20} electric).`)
  }
}

function resolveRocket(
  state: GameState,
  attacker: FieldMonster,
  target: TargetRef | undefined,
  requiredEnergy: number,
): void {
  if (!target || target.kind !== 'monster') return
  const adjacent = getCircleAdjacent(state, target.player, target.slot)
  dealDamageToTarget(state, attacker, target, 40, 'blast', false, requiredEnergy)
  for (const splash of adjacent) {
    if (!targetMonster(state, splash)) continue
    dealDamageToTarget(state, attacker, splash, 20, 'blast', false, requiredEnergy)
  }
}

function affinitySlots(player: PlayerState): number[] {
  const slots: number[] = []
  for (let slot = 0; slot < player.field.length; slot++) {
    const monster = player.field[slot]
    if (monster && hasGoldAffinity(monster)) slots.push(slot)
  }
  return slots
}

function drawOne(state: GameState, player: PlayerState): void {
  const card = player.deck.shift()
  if (!card) {
    log(state, `${player.name} has no cards to draw.`)
    return
  }
  player.hand.push(card)
  log(state, `${player.name} draws a card.`)
}

function beginAssignGold(
  state: GameState,
  player: PlayerState,
  count: number,
  drawAfter = false,
): void {
  if (count <= 0) return
  if (affinitySlots(player).length === 0) {
    log(state, `${player.name} gains ${count} gold, but no Gold Affinity card can hold it.`)
    if (drawAfter) drawOne(state, player)
    return
  }
  state.pending = { kind: 'assignGold', owner: player.id, remaining: count, drawAfter }
  log(state, `${player.name} gains ${count} gold. Choose a Gold Affinity card.`)
}

function cardPlayCounts(
  pending: GameState['pending'],
  effectId: string | undefined,
  replaying: boolean,
): boolean {
  if (replaying || effectId === 'recursion') return false
  if (pending?.kind === 'playCards' && (pending.freePlay || pending.from === 'discard')) return false
  return true
}

function noteCardPlay(state: GameState): void {
  state.playedCardThisTurn = true
  state.cardsPlayedThisTurn = (state.cardsPlayedThisTurn ?? 0) + 1
}

function takeReturningMonster(
  state: GameState,
  controller: PlayerId,
  instanceId: string,
  scheduled: boolean,
): FieldMonster | null {
  const owner = state.players[controller]
  const entries = owner.ethereal ?? []
  if (!scheduled) {
    const shrine = entries.find((entry) => entry.attachedMonster?.instanceId === instanceId)
    if (shrine?.attachedMonster) {
      const monster = shrine.attachedMonster
      shrine.attachedMonster = undefined
      return monster
    }
  }
  const index = entries.findIndex((entry) => entry.monster?.instanceId === instanceId)
  if (index < 0) return null
  const entry = entries[index]
  if (!entry?.monster) return null
  if (scheduled && entry.returnPlayer === undefined) return null
  if (!scheduled && entry.returnPlayer !== undefined) return null
  entries.splice(index, 1)
  owner.ethereal = entries.length > 0 ? entries : undefined
  return entry.monster
}

function bounceToHand(state: GameState, target: TargetRef): void {
  const resolved = resolveTarget(state, target)
  if (!resolved) return
  const owner = resolved.player
  if (target.kind === 'equipment') {
    const equipment = resolved.monster.equipment[target.equipmentIndex]
    if (!equipment) return
    if (equipment.defId === 'resilience') removeResilience(resolved.monster)
    resolved.monster.equipment.splice(target.equipmentIndex, 1)
    owner.hand.push({ instanceId: equipment.instanceId, defId: equipment.defId })
    log(state, `${getCard(equipment.defId).name} returns to ${owner.name}'s hand.`)
    return
  }
  const monster = resolved.monster
  if (monster.protectingInstanceId) releaseProtection(state, monster)
  for (const equipment of [...monster.equipment]) {
    owner.discard.push({ instanceId: equipment.instanceId, defId: equipment.defId })
  }
  monster.equipment = []
  owner.hand.push({ instanceId: monster.instanceId, defId: monster.defId })
  owner.field[resolved.slot] = null
  log(state, `${getMonster(monster.defId).name} returns to ${owner.name}'s hand.`)
  checkLosses(state)
}

function playEffect(
  state: GameState,
  handIndex: number,
  targets: TargetRef[],
  fromDiscard = false,
  actor?: PlayerState,
): void {
  const player = actor ?? activePlayer(state)
  const opening = state.pending
  const replaying = state.recursion?.replayingNow === true
  const pile = fromDiscard ? player.discard : player.hand
  const card = pile[handIndex]
  const def = getCard(card.defId)
  if (def.kind !== 'effect') throw new Error('Not an effect')

  pile.splice(handIndex, 1)
  player.discard.push(card)
  log(state, `${player.name} plays ${def.name}.`)
  noteWizrobe(state, player, def.effectId, opening, replaying)
  rememberInTomes(player, def.id)

  let rewindSnapshot: CardSnapshot | null = null
  let holdMists = false
  switch (def.effectId) {
    case 'heal_30':
      healTarget(state, targets[0], 30)
      break
    case 'energy_3': {
      const resolved = resolveTarget(state, targets[0])
      if (resolved && targets[0].kind === 'monster' && grantEnergy(state, resolved.monster, 3) > 0) {
        log(state, `${getMonster(resolved.monster.defId).name} gains 3 energy.`)
      }
      break
    }
    case 'damage_20_any':
      dealDamageToTarget(state, null, targets[0], 20)
      break
    case 'runestoneEnchant': {
      const resolved = resolveTarget(state, targets[0])
      if (!resolved || targets[0].kind !== 'monster') break
      if (resolved.monster.energy < 1) {
        log(state, `${getMonster(resolved.monster.defId).name} has no energy to lose.`)
        break
      }
      resolved.monster.energy -= 1
      attachCreatedEquipment(state, resolved.monster, randomRunestone(state))
      break
    }
    case 'anvil': {
      const roll = rollDie(state)
      if (highFaces(4).includes(roll)) {
        dealDamageToTarget(state, null, targets[0], 40)
      } else {
        log(state, 'Falling Anvil missed.')
      }
      break
    }
    case 'rally': {
      for (const t of targets) {
        const resolved = resolveTarget(state, t)
        if (resolved && t.kind === 'monster' && grantEnergy(state, resolved.monster, 1) > 0) {
          log(state, `${getMonster(resolved.monster.defId).name} gains 1 energy.`)
        }
      }
      break
    }
    case 'stormBolts': {
      for (const targetPlayer of state.players) {
        const friendly = targetPlayer.id === player.id
        const faces = friendly ? lowFaces(3) : highFaces(4)
        const damage = friendly ? 20 : 30
        for (let slot = 0; slot < targetPlayer.field.length; slot++) {
          if (!targetPlayer.field[slot]) continue
          if (faces.includes(rollDie(state))) {
            dealDamageToTarget(
              state,
              null,
              { kind: 'monster', player: targetPlayer.id, slot },
              damage,
              'electric',
            )
          }
        }
      }
      break
    }
    case 'rainOfGoo':
      state.pending = { kind: 'rainChoice', owner: player.id }
      break
    case 'treasureHoard':
      state.pending = { kind: 'hoardChoice', owner: player.id }
      break
    case 'magicFertilizer':
      for (const monster of player.field) {
        if (!monster || !isPlant(identityDefId(monster))) continue
        if (grantEnergy(state, monster, 1) > 0) {
          log(state, `${getMonster(monster.defId).name} gains 1 energy from Magic Fertilizer.`)
        }
      }
      break
    case 'whirlpool':
      state.pending = {
        kind: 'bury',
        owner: player.id,
        chosenInstanceIds: [],
        purpose: 'whirlpool',
        target: targets[0],
      }
      break
    case 'churnWaters':
      state.pending = {
        kind: 'bury',
        owner: player.id,
        chosenInstanceIds: [],
        purpose: 'churn',
      }
      break
    case 'blizzard':
      for (const targetPlayer of state.players) targetPlayer.skipEnergyPhases += 1
      log(state, 'All players will skip their next energy phase.')
      break
    case 'iceMirror':
      player.iceMirrorCharges += 1
      log(state, `${player.name} prepares an Ice Mirror.`)
      break
    case 'quickMarch':
      state.pending = { kind: 'march', owner: player.id, chosenSlots: [] }
      break
    case 'starlightPortal':
      state.pending = { kind: 'playCards', owner: player.id, played: 0 }
      break
    case 'darklightPortal': {
      const otherDiscarded = player.discard.some((candidate) => candidate !== card)
      if (!otherDiscarded) {
        log(state, `${player.name} has no other card in the discard.`)
        break
      }
      state.pending = { kind: 'playCards', owner: player.id, played: 0, from: 'discard', limit: 1 }
      log(state, 'Play one card from your discard.')
      break
    }
    case 'runestoneFires': {
      const sacrifice = targetMonster(state, targets[0])
      const beneficiary = targetMonster(state, targets[1])
      if (
        !sacrifice ||
        !beneficiary ||
        !targets[0] ||
        !targets[1] ||
        targets[0].kind !== 'monster' ||
        targets[1].kind !== 'monster' ||
        targets[0].player !== player.id ||
        targets[1].player !== player.id
      ) {
        break
      }
      sacrifice.hp = 0
      resolveZeroHp(state, player, targets[0].slot)
      const blessed = player.field[targets[1].slot]
      if (blessed) {
        grantEnergy(state, blessed, 3)
        blessed.extraAbilityUses = (blessed.extraAbilityUses ?? 0) + 1
        log(
          state,
          `${getMonster(blessed.defId).name} gains 3 energy and may take an additional action.`,
        )
      }
      break
    }
    case 'eyeOfTheRift': {
      const count = Math.min(4, player.deck.length)
      if (count === 0) {
        log(state, `${player.name}'s deck is empty.`)
        break
      }
      const cards = player.deck.splice(0, count)
      state.pending = {
        kind: 'riftEye',
        owner: player.id,
        cards,
        discarded: [],
        order: [],
        stage: 'discard',
      }
      log(state, `${player.name} looks at the top ${count} card${count === 1 ? '' : 's'}.`)
      break
    }
    case 'command':
      state.abilityUsesLeft += 1
      log(state, `${player.name} gains an extra action.`)
      break
    case 'scrollWisdom': {
      let drawn = 0
      for (let i = 0; i < 3; i++) {
        const nextCard = player.deck.shift()
        if (!nextCard) break
        player.hand.push(nextCard)
        drawn++
      }
      log(state, `${player.name} draws ${drawn} card${drawn === 1 ? '' : 's'}.`)
      break
    }
    case 'empower': {
      const resolved = resolveTarget(state, targets[0])
      if (resolved && targets[0].kind === 'monster') {
        grantEnergy(state, resolved.monster, 2)
        resolved.monster.freeActionThisTurn = true
        log(
          state,
          `${getMonster(resolved.monster.defId).name} gains 2 energy and may take a free action this turn.`,
        )
      }
      break
    }
    case 'daybreak': {
      dealDamageToTarget(state, null, targets[0], 20, 'light')
      const resolved = resolveTarget(state, targets[0])
      if (
        resolved &&
        targets[0].kind === 'monster' &&
        resolved.monster.stance === 'withdrawn' &&
        !isGooed(resolved.monster) &&
        !isClinged(resolved.monster)
      ) {
        resolved.monster.stance = 'active'
        log(state, `${getMonster(resolved.monster.defId).name} is forced into the open.`)
      }
      break
    }
    case 'famine': {
      const opponentId = otherPlayer(player.id)
      if (player.hand.length > 0) {
        beginForcedDiscard(
          state,
          player.id,
          1,
          state.players[opponentId].hand.length > 0 ? [opponentId] : [],
        )
      } else {
        beginForcedDiscard(state, opponentId, 1)
      }
      break
    }
    case 'goldenDie':
      state.goldenDice = [...(state.goldenDice ?? []), player.id]
      log(state, `${player.name} readies The Golden Die.`)
      break
    case 'timeWarp':
      player.points -= 1
      log(state, `${player.name} loses 1 point. Time bends.`)
      checkLosses(state)
      if (state.winner === null) {
        player.extraTurn = true
        log(state, `${player.name} will take another turn after this one.`)
      }
      break
    case 'inversion': {
      const slot = targets[0]?.kind === 'monster' ? targets[0].slot : -1
      const left = state.players[0].field[slot]
      const right = state.players[1].field[slot]
      if (!left || !right || targets[1]?.kind !== 'monster' || targets[1].slot !== slot) break
      const leftGear = { energy: left.energy, pendingEnergy: left.pendingEnergy, equipment: left.equipment }
      const rightGear = { energy: right.energy, pendingEnergy: right.pendingEnergy, equipment: right.equipment }
      state.players[0].field[slot] = right
      state.players[1].field[slot] = left
      right.energy = leftGear.energy
      right.pendingEnergy = leftGear.pendingEnergy
      right.equipment = leftGear.equipment
      left.energy = rightGear.energy
      left.pendingEnergy = rightGear.pendingEnergy
      left.equipment = rightGear.equipment
      log(state, `${getMonster(right.defId).name} and ${getMonster(left.defId).name} trade places and owners.`)
      break
    }
    case 'recursion':
      if (state.recursion?.owner === player.id) state.recursion.charges += 1
      else state.recursion = { owner: player.id, charges: 1, replaysLeft: 0 }
      log(state, 'The next effect will be played again after it resolves.')
      break
    case 'mirrorPact':
      state.pending = { kind: 'mirrorPick', owner: player.id }
      log(state, 'Choose any card in the match.')
      break
    case 'rewind':
      if (targets[0]) rewindSnapshot = captureCardSnapshot(state, targets[0])
      break
    case 'hauntedMists':
      holdMists = true
      break
    case 'targetedHurricane':
      if (targets[0]) bounceToHand(state, targets[0])
      break
  }

  if (holdMists) {
    const held = player.discard.pop()
    if (held) {
      state.pending = { kind: 'hauntedPick', owner: player.id, card: held }
      log(state, 'Destroy a card in your discard. Haunted Mists stays in play.')
    }
  }

  if (rewindSnapshot) {
    player.discard.pop()
    player.ethereal = [...(player.ethereal ?? []), { card, snapshot: rewindSnapshot }]
    log(state, `Rewind remembers ${getCard(rewindSnapshot.defId).name} and waits.`)
  }

  if (
    def.effectId !== 'recursion' &&
    !replaying &&
    state.recursion?.owner === player.id &&
    state.recursion.charges > 0
  ) {
    state.recursion.watchId = card.instanceId
    state.recursion.replaysLeft = state.recursion.charges
    state.recursion.charges = 0
    state.recursion.targets = structuredClone(targets)
    state.recursion.generation = (state.recursion.generation ?? 0) + 1
  }
  const spellSource = opening?.spellSourceInstanceId
  if (spellSource && state.pending && state.pending !== opening) {
    state.pending.spellSourceInstanceId = spellSource
  }
  if (cardPlayCounts(opening, def.effectId, replaying)) noteCardPlay(state)
}

function rememberInTomes(player: PlayerState, defId: string): void {
  for (const monster of player.field) {
    if (!monster || identityDefId(monster) !== 'tomebinder_wizard') continue
    if (monster.tome?.includes(defId)) continue
    monster.tome = [...(monster.tome ?? []), defId]
  }
}

function playEffectAsWizard(
  state: GameState,
  player: PlayerState,
  handIndex: number,
  targets: TargetRef[],
  wizardInstanceId: string,
): void {
  const marker: GameState['pending'] = {
    kind: 'playCards',
    owner: player.id,
    played: 0,
    from: 'hand',
    limit: 1,
    freePlay: true,
    effectsOnly: true,
    spellSourceInstanceId: wizardInstanceId,
  }
  state.pending = marker
  state.spellSourceInstanceId = wizardInstanceId
  playEffect(state, handIndex, targets, false, player)
  if (state.pending === marker) clearPending(state)
}

function noteWizrobe(
  state: GameState,
  player: PlayerState,
  effectId: string,
  opening: GameState['pending'],
  replaying: boolean,
): void {
  if (effectId === 'recursion') return
  if (!replaying && opening?.kind === 'playCards' && opening.from === 'discard') return
  let gained = false
  for (const monster of player.field) {
    if (!monster || identityDefId(monster) !== 'wizrobe') continue
    monster.attackBonus = (monster.attackBonus ?? 0) + 10
    gained = true
  }
  if (gained) log(state, "Wizrobe's attacks gain +10 damage.")
}

export function applyAction(state: GameState, action: GameAction): GameState {
  if (action.type === 'GOLDEN_FACE') {
    const pending = state.pending
    if (!pending || pending.kind !== 'goldenDie') throw new Error('No Golden Die choice')
    const next = cloneState(state)
    next.goldenDieFace = action.face
    next.pending = next.pendingStack.pop() ?? null
    return applyActionInner(next, pending.action)
  }
  const queued = state.goldenDice ?? []
  if (queued.length > 0 && state.goldenDieFace === undefined && state.pending?.kind !== 'goldenDie') {
    const probe = cloneState(state)
    let rolled = false
    probe.rng = () => {
      rolled = true
      return 6
    }
    try {
      applyActionInner(probe, action)
    } catch {
      // The real action reports the error if the roll was not what stopped the probe.
    }
    if (rolled) {
      const next = cloneState(state)
      if (next.pending) next.pendingStack.push(next.pending)
      next.pending = { kind: 'goldenDie', owner: queued[0], action }
      log(next, `${next.players[queued[0]].name} chooses the Golden Die.`)
      return next
    }
  }
  return applyActionInner(state, action)
}

function finishOpeningLook(state: GameState): void {
  const mulligan = state.openingMulligan
  if (!mulligan) return
  const choosing = state.activePlayer
  mulligan.decided[choosing] = true
  mulligan.revealed = false
  const other = choosing === 0 ? 1 : 0
  if (!mulligan.decided[other]) {
    state.activePlayer = other
    state.awaitingHandoff = true
    log(state, `Pass the device to ${state.players[other].name}.`)
    return
  }
  state.openingMulligan = undefined
  state.activePlayer = 0
  state.awaitingHandoff = true
  log(state, `Pass the device to ${state.players[0].name}.`)
}

function applyActionInner(state: GameState, action: GameAction): GameState {
  const next = cloneState(state)
  assertLegal(next, action)
  const carried = [next.pending, ...next.pendingStack].find((entry) => entry?.spellSourceInstanceId)
  if (carried?.spellSourceInstanceId) next.spellSourceInstanceId = carried.spellSourceInstanceId
  stampPendingUids(next)
  const pendingUidsAtStart = pendingUidSet(next)

  const player = activePlayer(next)

  switch (action.type) {
    case 'CONFIRM_HANDOFF': {
      next.awaitingHandoff = false
      if (next.openingMulligan && !next.openingMulligan.decided[next.activePlayer]) {
        log(next, `${player.name} looks at their opening hand.`)
        break
      }
      log(next, `${player.name}'s turn begins.`)
      beginEtherealReturns(next)
      break
    }
    case 'KEEP_OPENING_HAND':
      log(next, `${player.name} keeps their opening hand.`)
      finishOpeningLook(next)
      break
    case 'REDRAW_OPENING_HAND':
      redrawOpeningHand(next, player.id)
      if (next.openingMulligan) next.openingMulligan.revealed = true
      log(next, `${player.name} redraws their opening hand. The top monster stays.`)
      break
    case 'CONTINUE_OPENING_HAND':
      finishOpeningLook(next)
      break
    case 'DRAW': {
      const card = player.deck.shift()
      if (card) {
        player.hand.push(card)
        log(next, `${player.name} draws a card.`)
      }
      next.drewThisTurn = true
      beginMainPhase(next)
      break
    }
    case 'SKIP_DRAW': {
      next.drewThisTurn = true
      log(next, `${player.name} skips draw.`)
      beginMainPhase(next)
      break
    }
    case 'USE_ABILITY': {
      const monster = player.field[action.slot]
      if (!monster) throw new Error('No monster')
      const def = getMonster(monster.defId)
      const ability = monsterAbilities(monster).find((a) => a.id === action.abilityId)
      if (!ability) throw new Error('No ability')
      const extraLeftBefore = monster.extraAbilityUses ?? 0

      if (abilityNeedsChoice(ability) && !action.choice) {
        throw new Error('Choice required')
      }

      const printedSpend =
        ability.special === 'chaosFireworks'
          ? chaosFireworksSpend(player, action.slot)
          : ability.cost.spend
      const extra = action.extraEnergy ?? 0
      const extraIsCost = ['charge', 'lightningNeedle', 'flurryOfBlows', 'solarFlare', 'zap'].includes(
        ability.special ?? '',
      )
      const convertPlus = player.lingeringEnergy && ability.special !== 'lingeringEnergy'
      const extraCost = extraIsCost ? extra : 0
      const priced = adjustedCost(monster, { require: ability.cost.require, spend: printedSpend })
      const kept = priced.require
      const require = convertPlus ? kept + priced.spend + extraCost : kept
      const spend = convertPlus ? 0 : priced.spend + extraCost
      const goldRequire = action.goldRequire ?? 0
      const goldSpend = action.goldSpend ?? 0
      const gold = monster.gold ?? 0
      if (
        goldRequire + goldSpend > gold ||
        goldRequire > require ||
        goldSpend > spend ||
        monster.energy < require - goldRequire + (spend - goldSpend)
      ) {
        throw new Error('Cannot afford')
      }
      if (convertPlus) player.lingeringEnergy = false
      const energyBeforeSpend = monster.energy + gold
      monster.gold = gold - goldSpend
      if (!convertPlus) spendEnergy(monster, spend - goldSpend)
      const requiredEnergy = convertPlus ? kept + priced.spend + extra : kept

      log(
        next,
        `${player.name}'s ${def.name} uses ${ability.name}${
          action.choice === 'firePunchFull'
            ? ' (30 fire)'
            : action.choice === 'firePunchBurn'
              ? ' (10 fire + burn)'
              : convertPlus
                ? ' (Lingering Energy)'
                : ''
        }.`,
      )

      if (ability.special) {
        resolveSpecialAbility(
          next,
          player,
          action.slot,
          ability.special,
          action,
          energyBeforeSpend,
          requiredEnergy,
          convertPlus || extraIsCost,
        )
      } else {
        resolveAbility(next, player, action.slot, ability, action.target, action.choice, requiredEnergy)
      }

      const alreadyActed = next.actedSlots.includes(action.slot)
      const costsTeam = abilityCostsTeamAction(monster, ability)
      const useNormal = !alreadyActed && (!costsTeam || next.abilityUsesLeft > 0)
      if (extraLeftBefore > 0) {
        monster.extraAbilityUses = Math.max(0, (monster.extraAbilityUses ?? 0) - 1)
      } else if (useNormal) {
        next.actedSlots.push(action.slot)
        if (costsTeam) next.abilityUsesLeft = Math.max(0, next.abilityUsesLeft - 1)
      } else if (!alreadyActed) {
        next.actedSlots.push(action.slot)
      }
      const stalked = player.field[action.slot]
      if (stalked?.stalkedBy?.length) {
        dealDamageToTarget(
          next,
          null,
          { kind: 'monster', player: player.id, slot: action.slot },
          40,
          'shadow',
        )
      }
      if (hasFishingRod(monster) && hasSpareEnergy(monster, requiredEnergy)) {
        const drawn = player.deck.shift()
        if (drawn) {
          player.hand.push(drawn)
          log(next, `${player.name} draws a card from Fishing Rod.`)
        }
      }
      break
    }
    case 'PLAY_MONSTER': {
      const playPending = next.pending?.kind === 'playCards' ? next.pending : null
      const actor = playPending ? next.players[playPending.owner] : player
      const pile = action.fromDiscard ? actor.discard : actor.hand
      const card = pile[action.handIndex]
      const def = getCard(card.defId)
      if (def.kind !== 'monster') throw new Error('Not a monster')
      pile.splice(action.handIndex, 1)
      actor.field[action.slot] = {
        instanceId: card.instanceId,
        defId: card.defId,
        hp: def.maxHp,
        maxHp: def.maxHp,
        stance: action.stance,
        energy: 0,
        pendingEnergy: 0,
        statuses: [],
        equipment: [],
      }
      if (isBoneling(card.defId) && action.stance === 'withdrawn') {
        dieInsteadOfWithdraw(next, actor.id, action.slot)
      }
      const placed = actor.field[action.slot]
      if (placed && playPending?.grantEnergy) grantEnergy(next, placed, playPending.grantEnergy)
      if (cardPlayCounts(playPending, undefined, next.recursion?.replayingNow === true)) noteCardPlay(next)
      log(
        next,
        `${actor.name} plays ${def.name} ${action.stance} in slot ${action.slot + 1}.`,
      )
      resumePlayCardsAfter(next, playPending)
      break
    }
    case 'REPLACE_MONSTER': {
      const playPending = next.pending?.kind === 'playCards' ? next.pending : null
      const actor = playPending ? next.players[playPending.owner] : player
      const pile = action.fromDiscard ? actor.discard : actor.hand
      const card = pile[action.handIndex]
      const def = getCard(card.defId)
      const hostId = replacementBlobHost(def.id)
      const host = actor.field[action.slot]
      if (def.kind !== 'monster' || !hostId || host?.defId !== hostId) {
        throw new Error('Cannot replace')
      }
      const gear = host.equipment.slice()
      const stance = host.stance
      host.equipment = []
      pile.splice(action.handIndex, 1)
      discardMonster(next, actor, action.slot, 'removed')
      const monster: FieldMonster = {
        instanceId: card.instanceId,
        defId: card.defId,
        hp: def.maxHp,
        maxHp: def.maxHp,
        stance,
        energy: 0,
        pendingEnergy: 0,
        statuses: [],
        equipment: gear,
      }
      for (const equipment of gear) {
        if (equipment.defId === 'resilience') applyResilience(monster)
      }
      actor.field[action.slot] = monster
      if (playPending?.grantEnergy) grantEnergy(next, monster, playPending.grantEnergy)
      if (cardPlayCounts(playPending, undefined, next.recursion?.replayingNow === true)) noteCardPlay(next)
      log(next, `${actor.name} replaces ${getCard(hostId).name} with ${def.name}.`)
      resumePlayCardsAfter(next, playPending)
      break
    }
    case 'PLAY_EFFECT': {
      const beforePending = next.pending
      const actor =
        beforePending?.kind === 'playCards' || beforePending?.kind === 'replayEffect'
          ? next.players[beforePending.owner]
          : player
      if (beforePending?.spellSourceInstanceId) {
        next.spellSourceInstanceId = beforePending.spellSourceInstanceId
      }
      playEffect(next, action.handIndex, action.targets, action.fromDiscard === true, actor)
      if (beforePending?.kind === 'replayEffect' && next.pending === beforePending) {
        next.pending = null
      }
      resumePlayCardsAfter(next, beforePending)
      break
    }
    case 'PLAY_EQUIPMENT': {
      const playPending = next.pending?.kind === 'playCards' ? next.pending : null
      const actor = playPending ? next.players[playPending.owner] : player
      const pile = action.fromDiscard ? actor.discard : actor.hand
      const card = pile[action.handIndex]
      const def = getCard(card.defId)
      if (def.kind !== 'equipment') throw new Error('Not equipment')
      const monster = actor.field[action.slot]
      if (!monster) throw new Error('No monster')
      pile.splice(action.handIndex, 1)
      monster.equipment.push({
        instanceId: card.instanceId,
        defId: card.defId,
        hp: def.maxHp,
        maxHp: def.maxHp,
      })
      if (card.defId === 'resilience') applyResilience(monster)
      if (cardPlayCounts(playPending, undefined, next.recursion?.replayingNow === true)) noteCardPlay(next)
      log(next, `${actor.name} attaches ${def.name} to ${getMonster(monster.defId).name}.`)
      resumePlayCardsAfter(next, playPending)
      break
    }
    case 'SKIP_MAIN': {
      next.phase = 'move'
      log(next, `${player.name} proceeds to withdraw/advance.`)
      break
    }
    case 'WITHDRAW': {
      const m = player.field[action.slot]
      if (m) {
        if (isBoneling(m)) {
          dieInsteadOfWithdraw(next, player.id, action.slot)
        } else {
          m.stance = 'withdrawn'
          if (m.protectingInstanceId) releaseProtection(next, m)
          next.movedThisTurn = true
          if (!next.movedSlots.includes(action.slot)) next.movedSlots.push(action.slot)
          log(next, `${getMonster(m.defId).name} withdraws.`)
        }
      }
      beginEnergyPhase(next)
      break
    }
    case 'ADVANCE': {
      const m = player.field[action.slot]
      if (m) {
        m.stance = 'active'
        next.movedThisTurn = true
        if (!next.movedSlots.includes(action.slot)) next.movedSlots.push(action.slot)
        log(next, `${getMonster(m.defId).name} advances.`)
      }
      beginEnergyPhase(next)
      break
    }
    case 'SKIP_MOVE': {
      beginEnergyPhase(next)
      log(next, `${player.name} skips withdraw/advance.`)
      break
    }
    case 'ATTACH_ENERGY': {
      const m = player.field[action.slot]
      const useBanner = Boolean(m && next.bannerEnergyPool > 0 && getMonster(m.defId).points <= 2)
      const useBlob = Boolean(m && !useBanner && isBlobMonster(m.defId) && next.blobEnergyPool > 0)
      if (m && canReceiveEnergy(m) && (useBanner || useBlob || next.energyPool > 0)) {
        if (useBanner) next.bannerEnergyPool -= 1
        else if (useBlob) next.blobEnergyPool -= 1
        else next.energyPool -= 1
        grantEnergy(next, m, 1)
        next.attachedEnergyThisTurn = true
        log(next, `${player.name} attaches energy to ${getMonster(m.defId).name}.`)
      }
      if (
        next.energyPool <= 0 &&
        next.blobEnergyPool <= 0 &&
        next.bannerEnergyPool <= 0 &&
        !canUseDarkCharge(player)
      ) {
        finishEnergyPhase(next)
      }
      break
    }
    case 'FINISH_ENERGY': {
      finishEnergyPhase(next)
      break
    }
    case 'SKIP_ENERGY': {
      next.energyPool = 0
      next.blobEnergyPool = 0
      next.bannerEnergyPool = 0
      if (!canUseDarkCharge(player)) finishEnergyPhase(next)
      log(next, `${player.name} skips energy attach.`)
      break
    }
    case 'UNGOO': {
      const m = player.field[action.slot]
      if (m && isGooed(m) && m.energy >= 1) {
        m.energy -= 1
        m.statuses = m.statuses.filter((s) => s.kind !== 'goo')
        log(next, `${getMonster(m.defId).name} spends 1 energy to ungoo.`)
      }
      break
    }
    case 'RESIST_CLING': {
      const target = player.field[action.slot]
      const cling = target?.statuses.find((s) => s.kind === 'cling')
      if (target && cling && target.energy > 0) {
        target.energy -= 1
        for (const p of next.players) {
          const source = p.field.find((m) => m?.instanceId === cling.sourceInstanceId)
          if (!source) continue
          source.energy = Math.max(0, source.energy - 1)
          if (source.energy === 0) {
            source.clingTargetInstanceId = undefined
            target.statuses = target.statuses.filter((s) => s !== cling)
          }
        }
      }
      break
    }
    case 'PENDING_TARGET': {
      const pending = next.pending
      if (!pending || (pending.kind !== 'multiHit' && pending.kind !== 'repeatGoo')) break
      const source = next.players[pending.sourcePlayer].field[pending.sourceSlot]
      if (!source) {
        clearPending(next)
        break
      }
      if (pending.kind === 'repeatGoo') {
        const target = targetMonster(next, action.target)
        if (target) {
          const skip = action.target.player === next.activePlayer
          applyStatus(target, 'goo', 1, 1, undefined, skip)
          if (pending.also === 'burn') {
            applyStatus(target, 'burn', 3, 1, undefined, skip, pending.sourcePlayer)
          }
          if (pending.also === 'frozen') {
            applyStatus(target, 'frozen', 2, 1, undefined, skip, pending.sourcePlayer)
          }
        }
        clearPending(next)
      } else {
        let amount = pending.amount
        let damageType = pending.damageType
        if (pending.strike === 'spear') {
          const roll = rollDie(next)
          amount = lensSuccessFaces(source, highFaces(2)).includes(roll) ? 30 : 20
          damageType = 'untyped'
        } else if (pending.strike === 'chomp') {
          const roll = rollDie(next)
          amount = roll <= 3 ? 30 : 40
          damageType = 'untyped'
        }
        const hitTarget =
          amount > 0
            ? (dealDamageToTarget(
                next,
                source,
                action.target,
                amount,
                damageType,
                pending.piercing ?? false,
                pending.requiredEnergy,
              ) ?? action.target)
            : action.target
        const apply =
          pending.status !== undefined &&
          (pending.statusChanceFaces
            ? pending.statusChanceFaces.includes(rollDie(next))
            : true)
        if (apply && pending.status) {
          const target = targetMonster(next, hitTarget)
          if (target) {
            applyStatus(
              target,
              pending.status,
              pending.statusTurns ?? 1,
              1,
              undefined,
              hitTarget.player === next.activePlayer,
            )
          }
        }
        const chosenId = targetInstanceId(next, action.target)
        if (pending.excludeInstanceIds && chosenId && !pending.excludeInstanceIds.includes(chosenId)) {
          pending.excludeInstanceIds.push(chosenId)
        }
        pending.remaining -= 1
        if (pending.remaining <= 0 || !listLegalActions(next).some((candidate) => candidate.type === 'PENDING_TARGET')) {
          clearPending(next)
        }
      }
      break
    }
    case 'TRICKERY_PLACE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'trickery') break
      next.players[pending.opponent].deck.splice(action.deckIndex, 0, pending.card)
      log(next, `${getCard(pending.card.defId).name} was placed into the opponent's deck.`)
      clearPending(next)
      break
    }
    case 'SPAWN_BLOB': {
      const pending = next.pending
      if (!pending || pending.kind !== 'spawnBlobs') break
      const owner = next.players[pending.owner]
      const def = getMonster(pending.defId)
      owner.field[action.slot] = {
        instanceId: allocId(next), defId: pending.defId, hp: def.maxHp, maxHp: def.maxHp,
        stance: action.stance, energy: 0, pendingEnergy: 0, statuses: [], equipment: [],
      }
      pending.remaining -= 1
      if (pending.remaining <= 0 || owner.field.every(Boolean)) {
        const queued = pending.queue.shift()
        if (queued) {
          next.pending = {
            kind: 'spawnBlobs',
            owner: queued.owner,
            remaining: queued.remaining,
            defId: queued.defId,
            queue: pending.queue,
          }
        } else {
          clearPending(next)
          if (!next.pending) checkLosses(next)
        }
      }
      break
    }
    case 'RAIN_CHOOSE_MODE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'rainChoice') break
      next.pending =
        action.mode === 'blobs'
          ? { kind: 'rainBlobs', owner: pending.owner, played: 0 }
          : { kind: 'rainGoo', owner: pending.owner, remaining: 3, chosenInstanceIds: [] }
      break
    }
    case 'RAIN_PLAY_BLOB': {
      const pending = next.pending
      if (!pending || pending.kind !== 'rainBlobs') break
      const owner = next.players[pending.owner]
      const card = owner.hand[action.handIndex]
      const def = card && getCard(card.defId)
      if (!card || def.kind !== 'monster' || !def.name.toLowerCase().includes('blob')) break
      owner.hand.splice(action.handIndex, 1)
      owner.field[action.slot] = {
        instanceId: card.instanceId, defId: card.defId, hp: def.maxHp, maxHp: def.maxHp,
        stance: action.stance, energy: 0, pendingEnergy: 0, statuses: [], equipment: [],
      }
      pending.played += 1
      break
    }
    case 'RAIN_FINISH_BLOBS':
      clearPending(next)
      break
    case 'RAIN_GOO_TARGET': {
      const pending = next.pending
      if (!pending || pending.kind !== 'rainGoo') break
      const target = targetMonster(next, action.target)
      if (!target || pending.chosenInstanceIds.includes(target.instanceId)) break
      applyStatus(
        target,
        'goo',
        1,
        1,
        undefined,
        action.target.player === next.activePlayer,
      )
      pending.chosenInstanceIds.push(target.instanceId)
      pending.remaining -= 1
      if (pending.remaining <= 0) clearPending(next)
      break
    }
    case 'BURY_TOGGLE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'bury') break
      const chosen = pending.chosenInstanceIds
      const index = chosen.indexOf(action.instanceId)
      if (index >= 0) {
        chosen.splice(index, 1)
      } else {
        chosen.push(action.instanceId)
      }
      break
    }
    case 'BURY_FINISH': {
      const pending = next.pending
      if (!pending || pending.kind !== 'bury') break
      const owner = next.players[pending.owner]
      const chosen = pending.chosenInstanceIds
        .map((id) => owner.hand.find((card) => card.instanceId === id))
        .filter((card): card is NonNullable<typeof card> => Boolean(card))
      const chosenIds = new Set(chosen.map((card) => card.instanceId))
      owner.hand = owner.hand.filter((card) => !chosenIds.has(card.instanceId))
      for (const card of chosen) {
        const deckIndex = Math.floor(next.random() * (owner.deck.length + 1))
        owner.deck.splice(deckIndex, 0, card)
      }
      log(next, `${owner.name} buries ${chosen.length} card${chosen.length === 1 ? '' : 's'}.`)

      if (pending.purpose === 'absorb' && chosen.length > 0 && pending.sourceSlot !== undefined) {
        next.pending = {
          kind: 'multiHit',
          sourcePlayer: pending.owner,
          sourceSlot: pending.sourceSlot,
          remaining: chosen.length,
          amount: 20,
          damageType: 'poison',
          requiredEnergy: pending.requiredEnergy ?? 0,
        }
      } else {
        if (pending.purpose === 'hunt' && pending.sourceSlot !== undefined && pending.target) {
          const source = owner.field[pending.sourceSlot]
          if (source) {
            dealDamageToTarget(
              next,
              source,
              pending.target,
              10 + chosen.length * 30,
              'untyped',
              false,
              pending.requiredEnergy ?? 0,
            )
          }
        } else if (pending.purpose === 'whirlpool' && pending.target && chosen.length > 0) {
          dealDamageToTarget(next, null, pending.target, chosen.length * 20, 'water')
        } else if (pending.purpose === 'churn') {
          for (let i = 0; i < chosen.length; i++) {
            const card = owner.deck.shift()
            if (card) owner.hand.push(card)
          }
          log(next, `${owner.name} draws ${chosen.length} card${chosen.length === 1 ? '' : 's'}.`)
        }
        clearPending(next)
      }
      break
    }
    case 'PICK_DISCARD': {
      const pending = next.pending
      if (!pending || pending.kind !== 'discardPick') break
      const pile = next.players[pending.pileOwner].discard
      const index = pile.findIndex((card) => card.instanceId === action.instanceId)
      if (index < 0) break
      const [card] = pile.splice(index, 1)
      next.players[pending.owner].hand.push(card)
      log(next, `${next.players[pending.owner].name} takes ${getCard(card.defId).name} from discard.`)
      clearPending(next)
      break
    }
    case 'FREEZE_TARGET': {
      const pending = next.pending
      if (!pending || pending.kind !== 'freezeTargets' || action.target.kind !== 'monster') break
      const target = targetMonster(next, action.target)
      if (!target || pending.chosenInstanceIds.includes(target.instanceId)) break
      applyStatus(
        target,
        'frozen',
        pending.turns,
        1,
        undefined,
        action.target.player === next.activePlayer,
      )
      pending.chosenInstanceIds.push(target.instanceId)
      pending.remaining -= 1
      if (pending.remaining <= 0) {
        const discardPlayer = pending.discardPlayer
        if (discardPlayer !== undefined && next.players[discardPlayer].hand.length > 0) {
          next.pending = { kind: 'handDiscard', player: discardPlayer, remaining: 1 }
        } else {
          clearPending(next)
        }
      }
      break
    }
    case 'DISCARD_FROM_HAND': {
      const pending = next.pending
      if (!pending || pending.kind !== 'handDiscard') break
      const discardPlayer = next.players[pending.player]
      const card = takeCard(discardPlayer.hand, action.instanceId)
      if (!card) break
      discardPlayer.discard.push(card)
      log(next, `${discardPlayer.name} discards ${getCard(card.defId).name}.`)
      if (discardPlayer.spyMarkInstanceId === card.instanceId) {
        discardPlayer.spyMarkInstanceId = undefined
      }
      pending.remaining -= 1
      if (pending.remaining > 0 && discardPlayer.hand.length > 0) break
      const rest = pending.thenPlayers ?? []
      if (rest.length > 0) beginForcedDiscard(next, rest[0], 1, rest.slice(1))
      else clearPending(next)
      break
    }
    case 'SPY_MARK': {
      const pending = next.pending
      if (!pending || pending.kind !== 'spy') break
      const opponent = next.players[otherPlayer(pending.owner)]
      opponent.spyMarkInstanceId = action.instanceId
      log(next, `${player.name} marks a card in ${opponent.name}'s hand.`)
      clearPending(next)
      break
    }
    case 'SPY_SKIP':
      clearPending(next)
      break
    case 'GRIEF_TOGGLE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'griefDestroy') break
      const index = pending.chosenInstanceIds.indexOf(action.instanceId)
      if (index >= 0) pending.chosenInstanceIds.splice(index, 1)
      else if (pending.chosenInstanceIds.length < 2) pending.chosenInstanceIds.push(action.instanceId)
      break
    }
    case 'GRIEF_FINISH': {
      const pending = next.pending
      if (!pending || pending.kind !== 'griefDestroy') break
      const owner = next.players[pending.owner]
      const destroyed: HandCard[] = []
      for (const instanceId of pending.chosenInstanceIds) {
        const card = takeCard(owner.discard, instanceId)
        if (card) destroyed.push(card)
      }
      for (const card of destroyed) destroyPermanently(next, owner, card)
      const count = destroyed.length
      if (count > 0) beginForcedDiscard(next, otherPlayer(pending.owner), count)
      else clearPending(next)
      break
    }
    case 'TRANSMUTE_DESTROY': {
      const pending = next.pending
      if (!pending || pending.kind !== 'transmuteHand') break
      const owner = next.players[pending.owner]
      const card = takeCard(owner.hand, action.instanceId)
      if (!card) break
      destroyPermanently(next, owner, card)
      next.pending = { kind: 'transmuteFetch', owner: pending.owner }
      break
    }
    case 'TRANSMUTE_FETCH': {
      const pending = next.pending
      if (!pending || pending.kind !== 'transmuteFetch') break
      const owner = next.players[pending.owner]
      const card = takeCard(owner.discard, action.instanceId) ?? takeCard(owner.deck, action.instanceId)
      if (!card) break
      owner.hand.push(card)
      log(next, `${owner.name} transmutes ${getCard(card.defId).name} into their hand.`)
      clearPending(next)
      break
    }
    case 'BREW_WEAKNESS': {
      const pending = next.pending
      if (!pending || pending.kind !== 'brewWeakness') break
      const monster = targetMonster(next, pending.target)
      if (monster) {
        monster.weaknessOverride = action.damageType as DamageType
        log(
          next,
          `${getMonster(monster.defId).name}'s weakness becomes ${action.damageType}.`,
        )
      }
      clearPending(next)
      break
    }
    case 'DARK_CHARGE': {
      const charged = player.field[action.slot]
      const card = takeCard(player.discard, action.discardInstanceId)
      if (charged && card && hasDarkCharge(charged)) {
        if (!canReceiveEnergy(charged)) {
          player.discard.push(card)
          log(next, `${getMonster(charged.defId).name} cannot gain energy without a Colossus Keystone.`)
        } else {
          destroyPermanently(next, player, card)
          grantEnergy(next, charged, 1)
          next.attachedEnergyThisTurn = true
          log(next, `${player.name} Dark Charges ${getMonster(charged.defId).name}.`)
        }
      }
      break
    }
    case 'PLASMA_ROLL':
      applyPlasmaRoll(next)
      break
    case 'PLASMA_FIRE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'plasmaCannon' || pending.hits < 1) break
      const source = next.players[pending.sourcePlayer].field[pending.sourceSlot]
      if (source) {
        dealDamageToTarget(
          next,
          source,
          action.target,
          pending.hits * 20,
          'electric',
          false,
          pending.requiredEnergy,
        )
      }
      clearPending(next)
      break
    }
    case 'SOUND_WAVE_TARGET': {
      const pending = next.pending
      if (!pending || pending.kind !== 'soundWave') break
      const instanceId = targetInstanceId(next, action.target)
      if (!instanceId || pending.chosenInstanceIds.includes(instanceId)) break
      if (pending.chosenInstanceIds.length >= 3) break
      pending.chosenInstanceIds.push(instanceId)
      break
    }
    case 'SOUND_WAVE_FINISH': {
      const pending = next.pending
      if (!pending || pending.kind !== 'soundWave') break
      const source = next.players[pending.sourcePlayer].field[pending.sourceSlot]
      for (const instanceId of pending.chosenInstanceIds) {
        const target = targetFromInstanceId(next, instanceId)
        if (!target) continue
        dealDamageToTarget(
          next,
          source,
          target,
          20,
          'sonic',
          false,
          pending.requiredEnergy,
        )
      }
      clearPending(next)
      break
    }
    case 'MARCH_TOGGLE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'march') break
      const index = pending.chosenSlots.indexOf(action.slot)
      if (index >= 0) pending.chosenSlots.splice(index, 1)
      else pending.chosenSlots.push(action.slot)
      break
    }
    case 'MARCH_FINISH': {
      const pending = next.pending
      if (!pending || pending.kind !== 'march') break
      const owner = next.players[pending.owner]
      for (const slot of pending.chosenSlots) {
        const monster = owner.field[slot]
        if (!monster) continue
        const nextStance = monster.stance === 'active' ? 'withdrawn' : 'active'
        if (nextStance === 'withdrawn' && isBoneling(monster)) {
          dieInsteadOfWithdraw(next, owner.id, slot)
          continue
        }
        monster.stance = nextStance
        if (monster.stance === 'withdrawn' && monster.protectingInstanceId) {
          releaseProtection(next, monster)
        }
        if (!next.movedSlots.includes(slot)) next.movedSlots.push(slot)
        log(next, `${getMonster(monster.defId).name} ${monster.stance === 'withdrawn' ? 'withdraws' : 'advances'}.`)
      }
      clearPending(next)
      break
    }
    case 'PORTAL_FINISH':
      clearPending(next)
      break
    case 'ELDERS_PICK': {
      const pending = next.pending
      if (!pending || pending.kind !== 'eldersEye') break
      if (pending.order.includes(action.instanceId)) break
      if (!pending.cards.some((card) => card.instanceId === action.instanceId)) break
      pending.order.push(action.instanceId)
      if (pending.order.length === pending.cards.length) {
        const ordered = pending.order.map(
          (id) => pending.cards.find((card) => card.instanceId === id)!,
        )
        player.deck.unshift(...ordered)
        const drawn = player.deck.shift()
        if (drawn) {
          player.hand.push(drawn)
          log(next, `${player.name} draws a card.`)
        }
        clearPending(next)
      }
      break
    }
    case 'BEGIN_KEYSTONE': {
      next.pending = { kind: 'keystone', owner: player.id, chosenInstanceIds: [] }
      log(next, `${player.name} begins forging a Colossus Keystone.`)
      break
    }
    case 'KEYSTONE_TOGGLE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'keystone') break
      const index = pending.chosenInstanceIds.indexOf(action.instanceId)
      if (index >= 0) pending.chosenInstanceIds.splice(index, 1)
      else if (pending.chosenInstanceIds.length < 3) pending.chosenInstanceIds.push(action.instanceId)
      break
    }
    case 'KEYSTONE_CANCEL': {
      if (next.pending?.kind === 'keystone') {
        clearPending(next)
        log(next, `${player.name} stops forging a Colossus Keystone.`)
      }
      break
    }
    case 'KEYSTONE_ATTACH': {
      const pending = next.pending
      const colossus = player.field[action.slot]
      if (
        !pending ||
        pending.kind !== 'keystone' ||
        pending.chosenInstanceIds.length !== 3 ||
        !colossus ||
        identityDefId(colossus) !== 'colossus' ||
        hasKeystone(colossus)
      ) {
        break
      }
      for (const instanceId of [...pending.chosenInstanceIds]) {
        const card = takeCard(player.hand, instanceId)
        if (card) destroyPermanently(next, player, card)
      }
      colossus.equipment.push({
        instanceId: allocId(next),
        defId: 'colossus_keystone',
        hp: 1,
        maxHp: 1,
      })
      log(next, `${player.name} attaches a Colossus Keystone to Colossus.`)
      clearPending(next)
      break
    }
    case 'HOARD_CHOICE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'hoardChoice' || pending.owner !== player.id) break
      clearPending(next)
      if (action.mode === 'gold') beginAssignGold(next, player, 3)
      else beginAssignGold(next, player, 1, true)
      break
    }
    case 'ASSIGN_GOLD': {
      const pending = next.pending
      if (!pending || pending.kind !== 'assignGold' || pending.owner !== player.id) break
      const monster = player.field[action.slot]
      if (!monster || !getMonster(monster.defId).goldAffinity) break
      monster.gold = (monster.gold ?? 0) + 1
      log(next, `${getMonster(monster.defId).name} receives 1 gold (now ${monster.gold}).`)
      pending.remaining -= 1
      if (pending.remaining <= 0) {
        const drawAfter = pending.drawAfter === true
        clearPending(next)
        if (drawAfter) drawOne(next, player)
      }
      break
    }
    case 'FAIRY_HEAL': {
      const pending = next.pending
      if (!pending || pending.kind !== 'fairyHeal') break
      healTarget(next, action.target, 10)
      pending.remaining -= 1
      if (pending.remaining <= 0) {
        clearPending(next)
        tickStatuses(next)
        healShrines(next)
        queueArrowShots(next)
        if (next.winner === null && next.pending === null) passTurn(next)
      }
      break
    }
    case 'PLACE_WEED': {
      const pending = next.pending
      if (!pending || pending.kind !== 'placeWeed') break
      const owner = next.players[pending.owner]
      const grows = action.slot === owner.field.length
      if (grows) owner.field.push(null)
      if (owner.field[action.slot]) break
      const def = getMonster('lovnis_weed')
      owner.field[action.slot] = {
        instanceId: allocId(next),
        defId: 'lovnis_weed',
        hp: def.maxHp,
        maxHp: def.maxHp,
        stance: action.stance,
        energy: 0,
        pendingEnergy: 0,
        statuses: [],
        equipment: [],
        ownsExtraSlot: grows ? true : undefined,
      }
      log(next, `${owner.name} places a Lovni's Weed (${action.stance}).`)
      clearPending(next)
      break
    }
    case 'PLACE_BONELING': {
      const pending = next.pending
      if (!pending || pending.kind !== 'placeBoneling') break
      const owner = next.players[pending.owner]
      const grows = action.slot === owner.field.length
      if (grows) owner.field.push(null)
      if (owner.field[action.slot]) break
      const def = getMonster('boneling')
      owner.field[action.slot] = {
        instanceId: allocId(next),
        defId: 'boneling',
        hp: def.maxHp,
        maxHp: def.maxHp,
        stance: 'active',
        energy: 0,
        pendingEnergy: 0,
        statuses: [],
        equipment: [],
        ownsExtraSlot: grows ? true : undefined,
      }
      log(next, `${owner.name} places a Boneling.`)
      pending.remaining -= 1
      if (pending.remaining <= 0) clearPending(next)
      break
    }
    case 'CATACOMB_PICK': {
      const pending = next.pending
      if (!pending || pending.kind !== 'bringForth') break
      const owner = next.players[pending.owner]
      const card = takeCard(owner.discard, action.instanceId)
      if (!card) break
      destroyPermanently(next, owner, card)
      next.pending = { kind: 'placeBoneling', owner: owner.id, remaining: 1 }
      log(next, 'Place a Boneling.')
      break
    }
    case 'CLOUD_TOGGLE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'cloudDestroy') break
      const index = pending.chosenInstanceIds.indexOf(action.instanceId)
      if (index >= 0) pending.chosenInstanceIds.splice(index, 1)
      else pending.chosenInstanceIds.push(action.instanceId)
      break
    }
    case 'CLOUD_FINISH': {
      const pending = next.pending
      if (!pending || pending.kind !== 'cloudDestroy') break
      const owner = next.players[pending.owner]
      let destroyed = 0
      for (const instanceId of [...pending.chosenInstanceIds]) {
        const card = takeCard(owner.discard, instanceId)
        if (!card) continue
        destroyPermanently(next, owner, card)
        destroyed += 1
      }
      if (destroyed === 0) {
        clearPending(next)
        break
      }
      next.pending = { kind: 'cloudBless', owner: owner.id, remaining: destroyed }
      log(next, `Choose ${destroyed} monster${destroyed === 1 ? '' : 's'} to gain shadow damage.`)
      break
    }
    case 'CLOUD_BLESS': {
      const pending = next.pending
      if (!pending || pending.kind !== 'cloudBless' || action.target.kind !== 'monster') break
      const monster = targetMonster(next, action.target)
      if (!monster) break
      monster.shadowBonus = (monster.shadowBonus ?? 0) + 10
      log(
        next,
        `${getMonster(monster.defId).name}'s shadow attacks deal +${monster.shadowBonus} damage.`,
      )
      pending.remaining -= 1
      if (pending.remaining <= 0) clearPending(next)
      break
    }
    case 'RIFT_TOGGLE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'riftEye' || pending.stage !== 'discard') break
      const index = pending.discarded.indexOf(action.instanceId)
      if (index >= 0) pending.discarded.splice(index, 1)
      else if (pending.cards.some((card) => card.instanceId === action.instanceId)) {
        pending.discarded.push(action.instanceId)
      }
      break
    }
    case 'RIFT_CONFIRM': {
      const pending = next.pending
      if (!pending || pending.kind !== 'riftEye' || pending.stage !== 'discard') break
      const owner = next.players[pending.owner]
      const kept = pending.cards.filter((card) => !pending.discarded.includes(card.instanceId))
      if (kept.length === 0) {
        owner.discard.push(...pending.cards)
        log(next, `${owner.name} discards ${pending.cards.length} card${pending.cards.length === 1 ? '' : 's'}.`)
        clearPending(next)
        break
      }
      pending.stage = 'order'
      pending.order = []
      log(next, 'Put the remaining cards back in order. The first card you choose goes on top.')
      break
    }
    case 'RIFT_ORDER': {
      const pending = next.pending
      if (!pending || pending.kind !== 'riftEye' || pending.stage !== 'order') break
      if (pending.discarded.includes(action.instanceId) || pending.order.includes(action.instanceId)) break
      if (!pending.cards.some((card) => card.instanceId === action.instanceId)) break
      pending.order.push(action.instanceId)
      const kept = pending.cards.filter((card) => !pending.discarded.includes(card.instanceId))
      if (pending.order.length < kept.length) break
      const owner = next.players[pending.owner]
      const ordered = pending.order.map((id) => pending.cards.find((card) => card.instanceId === id)!)
      owner.deck.unshift(...ordered)
      for (const card of pending.cards) {
        if (pending.discarded.includes(card.instanceId)) owner.discard.push(card)
      }
      log(next, `${owner.name} puts ${ordered.length} card${ordered.length === 1 ? '' : 's'} back on the deck.`)
      clearPending(next)
      break
    }
    case 'STORM_TYPE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'stormType') break
      next.pending = {
        kind: 'multiHit',
        sourcePlayer: pending.sourcePlayer,
        sourceSlot: pending.sourceSlot,
        remaining: 1,
        amount: pending.amount,
        damageType: action.damageType,
        requiredEnergy: pending.requiredEnergy,
      }
      log(next, `Bring the STORM is ${action.damageType}. Choose a target.`)
      break
    }
    case 'FORCE_WITHDRAW': {
      const pending = next.pending
      if (!pending || pending.kind !== 'forceWithdraw') break
      if (action.accept) forceWithdraw(next, pending.player, pending.slot)
      else {
        const staying = next.players[pending.player].field[pending.slot]
        log(next, staying ? `${getMonster(staying.defId).name} stays where it is.` : 'The target stays where it is.')
      }
      clearPending(next)
      break
    }
    case 'GOLDEN_FACE':
      throw new Error('Golden Die face is resolved before the action')
    case 'MIRROR_PICK': {
      const pending = next.pending
      if (!pending || pending.kind !== 'mirrorPick') break
      const defId = defIdInMatch(next, action.instanceId)
      if (!defId) break
      next.pending = { kind: 'mirrorOffer', owner: pending.owner, defId }
      log(next, `${next.players[otherPlayer(pending.owner)].name} may copy ${getCard(defId).name}.`)
      break
    }
    case 'MIRROR_AGREE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'mirrorOffer') break
      beginMirrorCopy(next, otherPlayer(pending.owner), pending.owner, pending.defId, 'opponent')
      break
    }
    case 'MIRROR_DECLINE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'mirrorOffer') break
      log(next, `${next.players[otherPlayer(pending.owner)].name} declines the pact.`)
      clearPending(next)
      break
    }
    case 'MIRROR_SKIP': {
      const pending = next.pending
      if (!pending || pending.kind !== 'playCards' || !pending.onlyInstanceId) break
      const actor = next.players[pending.owner]
      const index = actor.hand.findIndex((card) => card.instanceId === pending.onlyInstanceId)
      if (index >= 0) actor.hand.splice(index, 1)
      log(next, `${actor.name} does not play the copy.`)
      if (pending.mirrorRole === 'opponent') clearPending(next)
      else clearPending(next)
      break
    }
    case 'SHAPESHIFT_PICK': {
      const pending = next.pending
      if (!pending || pending.kind !== 'shapeshiftPick') break
      const monster = next.players[pending.owner].field[pending.slot]
      if (!monster) break
      monster.shapeshiftDefId = action.defId === monster.defId ? undefined : action.defId
      log(next, `${getMonster(monster.defId).name} becomes ${getCard(action.defId).name}.`)
      clearPending(next)
      break
    }
    case 'REWIND_USE': {
      const entry = (player.ethereal ?? []).find(
        (candidate) => candidate.card.instanceId === action.rewindInstanceId,
      )
      if (!entry || entry.card.defId !== 'rewind' || !entry.snapshot) break
      next.pending = {
        kind: 'rewindDiscard',
        owner: player.id,
        rewindInstanceId: action.rewindInstanceId,
      }
      log(next, 'Discard a card to use Rewind.')
      break
    }
    case 'REWIND_DISCARD': {
      const pending = next.pending
      if (!pending || pending.kind !== 'rewindDiscard') break
      const owner = next.players[pending.owner]
      const index = owner.hand.findIndex((card) => card.instanceId === action.instanceId)
      if (index < 0) break
      const [discarded] = owner.hand.splice(index, 1)
      owner.discard.push(discarded)
      const ethereal = owner.ethereal ?? []
      const rewindIndex = ethereal.findIndex((entry) => entry.card.instanceId === pending.rewindInstanceId)
      if (rewindIndex < 0) break
      const [entry] = ethereal.splice(rewindIndex, 1)
      owner.ethereal = ethereal
      owner.removed.push(entry.card)
      log(next, `${owner.name} discards ${getCard(discarded.defId).name} and destroys Rewind.`)
      if (entry.snapshot) restoreSnapshot(next, entry.snapshot)
      clearPending(next)
      break
    }
    case 'VERIDIAN_PAY': {
      const pending = next.pending
      if (!pending || pending.kind !== 'veridianFires') break
      const owner = next.players[pending.owner]
      const warrior = owner.field[pending.slot]
      if (!warrior) {
        clearPending(next)
        break
      }
      const times = Math.max(0, Math.min(action.times, Math.ceil(warrior.hp / 10)))
      if (times === 0) {
        log(next, 'Veridian Fires spends no HP.')
        clearPending(next)
        break
      }
      next.pending = { kind: 'veridianStrike', owner: pending.owner, slot: pending.slot, times }
      log(next, `Veridian Fires will spend ${times * 10} HP for ${times * 20} damage.`)
      break
    }
    case 'VERIDIAN_STRIKE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'veridianStrike') break
      const owner = next.players[pending.owner]
      const warrior = owner.field[pending.slot]
      if (!warrior) {
        clearPending(next)
        break
      }
      warrior.hp -= pending.times * 10
      log(next, `${getMonster(warrior.defId).name} spends ${pending.times * 10} HP for Veridian Fires.`)
      clearPending(next)
      resolveZeroHp(next, owner, pending.slot)
      dealDamageToTarget(next, warrior, action.target, pending.times * 20)
      break
    }
    case 'BLOODCRAFT_PICK': {
      const pending = next.pending
      if (!pending || pending.kind !== 'bloodcraft') break
      const owner = next.players[pending.owner]
      const warrior = owner.field[pending.slot]
      const def = getCard(action.defId)
      if (!warrior || def.kind !== 'equipment') {
        clearPending(next)
        break
      }
      const card = makeCard(next, action.defId)
      warrior.equipment.push({
        instanceId: card.instanceId,
        defId: card.defId,
        hp: def.maxHp,
        maxHp: def.maxHp,
      })
      log(next, `${getMonster(warrior.defId).name} crafts ${def.name}.`)
      warrior.hp -= 20
      clearPending(next)
      resolveZeroHp(next, owner, pending.slot)
      break
    }
    case 'HAUNTED_PICK': {
      const pending = next.pending
      if (!pending || pending.kind !== 'hauntedPick') break
      const owner = next.players[pending.owner]
      const index = owner.discard.findIndex((card) => card.instanceId === action.instanceId)
      if (index < 0) break
      const [destroyed] = owner.discard.splice(index, 1)
      destroyPermanently(next, owner, destroyed)
      owner.ethereal = [...(owner.ethereal ?? []), { card: pending.card }]
      log(next, 'Haunted Mists settles over the field.')
      clearPending(next)
      break
    }
    case 'FIREBALL_DISCARD': {
      const pending = next.pending
      if (!pending || pending.kind !== 'fireballDiscard') break
      const owner = next.players[pending.owner]
      const index = owner.hand.findIndex((card) => card.instanceId === action.instanceId)
      if (index < 0) break
      const [card] = owner.hand.splice(index, 1)
      owner.discard.push(card)
      log(next, `${owner.name} discards ${getCard(card.defId).name}.`)
      next.pending = { kind: 'fireballShot', owner: pending.owner, slot: pending.slot }
      break
    }
    case 'FIREBALL_SHOT': {
      const pending = next.pending
      if (!pending || pending.kind !== 'fireballShot') break
      const owner = next.players[pending.owner]
      const wizard = owner.field[pending.slot]
      if (wizard) {
        const hit = dealDamageToTarget(next, wizard, action.target, 40, 'blast') ?? action.target
        const monster = targetMonster(next, hit)
        if (monster && hit.kind === 'monster') {
          applyStatus(monster, 'burn', 3, 1, undefined, false, owner.id)
        }
      }
      clearPending(next)
      break
    }
    case 'TOME_PICK': {
      const pending = next.pending
      if (!pending || pending.kind !== 'tomePick') break
      const owner = next.players[pending.owner]
      const wizard = owner.field[pending.slot]
      const def = getCard(action.defId)
      if (!wizard?.tome?.includes(action.defId) || def.kind !== 'effect') break
      const card = makeCard(next, action.defId)
      owner.hand.push(card)
      const handIndex = owner.hand.length - 1
      if (effectIsUntargeted(def.effectId)) {
        playEffectAsWizard(next, owner, handIndex, [], wizard.instanceId)
      } else {
        const options = effectTargetOptions(next, def.effectId)
        if (options.length === 0) {
          owner.hand.pop()
          log(next, `${def.name} has no legal target.`)
          clearPending(next)
        } else {
          next.pending = { kind: 'tomeCast', owner: pending.owner, slot: pending.slot, handIndex }
          next.spellSourceInstanceId = wizard.instanceId
        }
      }
      break
    }
    case 'TOME_CAST': {
      const pending = next.pending
      if (!pending || pending.kind !== 'tomeCast') break
      const owner = next.players[pending.owner]
      const wizard = owner.field[pending.slot]
      if (!wizard) {
        clearPending(next)
        break
      }
      playEffectAsWizard(next, owner, pending.handIndex, action.targets, wizard.instanceId)
      break
    }
    case 'SUMMON_TYPE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'summonType') break
      const owner = next.players[pending.owner]
      const index = owner.deck.findIndex(
        (card) =>
          getCard(card.defId).kind === 'monster' &&
          cardMatchesSearchType(card.defId, action.element),
      )
      if (index >= 0) {
        const [found] = owner.deck.splice(index, 1)
        owner.hand.push(found)
        log(next, `${owner.name} adds ${getCard(found.defId).name} to their hand.`)
      } else {
        log(next, `${owner.name} finds no ${action.element} monster.`)
      }
      next.pending = {
        kind: 'playCards',
        owner: owner.id,
        played: 0,
        from: 'hand',
        limit: 1,
        freePlay: true,
        monstersOnly: true,
      }
      log(next, 'You may play a monster for free.')
      break
    }
    case 'ENCHANT_STONE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'enchantStone') break
      const monster = targetMonster(next, pending.target)
      if (monster) attachCreatedEquipment(next, monster, action.defId)
      clearPending(next)
      break
    }
    case 'CHARGED_SPLAT': {
      const pending = next.pending
      if (!pending || pending.kind !== 'chargedSplat') break
      const source = next.players[pending.sourcePlayer].field[pending.sourceSlot]
      if (!source) {
        clearPending(next)
        break
      }
      if (pending.step === 'energy') {
        const monster = targetMonster(next, action.target)
        if (monster && isBlobMonster(monster.defId) && grantEnergy(next, monster, 1) > 0) {
          log(next, `${getMonster(monster.defId).name} gains 1 energy.`)
        }
        if (pending.again) {
          next.pending = {
            kind: 'chargedSplat',
            sourcePlayer: pending.sourcePlayer,
            sourceSlot: pending.sourceSlot,
            step: 'goo',
            again: false,
          }
        } else clearPending(next)
      } else {
        gooChargedTarget(next, action.target)
        offerChargedEnergy(next, pending.sourcePlayer, pending.sourceSlot, false)
        if (next.pending === pending) clearPending(next)
      }
      break
    }
    case 'STARBEAM_ENERGY': {
      const pending = next.pending
      if (!pending || pending.kind !== 'starbeamEnergy') break
      const monster = targetMonster(next, action.target)
      if (monster && grantEnergy(next, monster, 1) > 0) {
        log(next, `${getMonster(monster.defId).name} gains 1 energy.`)
      }
      clearPending(next)
      break
    }
    case 'PEGASUS_MOVE': {
      const monster = player.field[action.slot]
      if (!monster) break
      monster.pegasusUsedThisTurn = true
      if (action.stance === 'withdrawn' && isBoneling(monster)) {
        dieInsteadOfWithdraw(next, player.id, action.slot)
        break
      }
      monster.stance = action.stance
      if (action.stance === 'withdrawn' && monster.protectingInstanceId) releaseProtection(next, monster)
      log(
        next,
        `${getMonster(monster.defId).name} ${action.stance === 'withdrawn' ? 'withdraws' : 'advances'} with Pegasus Gift.`,
      )
      break
    }
    case 'PLAY_STRUCTURE': {
      const card = player.hand[action.handIndex]
      const def = card ? getCard(card.defId) : null
      const host = player.field[action.slot]
      if (!card || def?.kind !== 'structure' || !host) break
      player.hand.splice(action.handIndex, 1)
      const lifted = liftMonster(next, player, action.slot)
      if (!lifted) {
        player.hand.splice(action.handIndex, 0, card)
        break
      }
      player.ethereal = [...(player.ethereal ?? []), { card, attachedMonster: lifted }]
      if (cardPlayCounts(next.pending, undefined, next.recursion?.replayingNow === true)) noteCardPlay(next)
      log(next, `${def.name} becomes Ethereal and attaches ${getMonster(lifted.defId).name}.`)
      checkLosses(next)
      break
    }
    case 'RETURN_ETHEREAL': {
      if (player.field[action.slot]) break
      const placed = takeReturningMonster(next, player.id, action.instanceId, false)
      if (!placed) break
      placeMonsterOnField(next, player.id, action.slot, placed, action.stance)
      break
    }
    case 'ETHEREAL_PLACE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'etherealReturn') break
      const current = pending.queue[0]
      if (!current) {
        clearPending(next)
        break
      }
      const owner = next.players[current.controller]
      if (owner.field[action.slot]) break
      const placed = takeReturningMonster(next, current.controller, current.instanceId, true)
      if (!placed) {
        pending.queue.shift()
      } else {
        placeMonsterOnField(next, current.controller, action.slot, placed, action.stance)
        pending.queue.shift()
      }
      if (pending.queue.length === 0) clearPending(next)
      break
    }
    case 'TAX_GIVE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'tax') break
      const giver = next.players[pending.owner]
      const index = giver.hand.findIndex((card) => card.instanceId === action.instanceId)
      const card = index >= 0 ? giver.hand.splice(index, 1)[0] : undefined
      if (!card) break
      next.players[pending.sourcePlayer].hand.push(card)
      log(next, `${giver.name} gives ${getCard(card.defId).name} to ${next.players[pending.sourcePlayer].name}.`)
      clearPending(next)
      break
    }
    case 'TAX_DAMAGE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'tax') break
      dealDamageToTarget(next, null, action.target, 50)
      clearPending(next)
      break
    }
    case 'STONE_CURE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'stoneCure') break
      for (const monster of player.field) {
        if (monster?.instanceId !== action.instanceId) continue
        monster.statuses = monster.statuses.filter((status) => status.kind !== 'stone')
        log(next, `${getMonster(monster.defId).name} is no longer Stone.`)
      }
      clearPending(next)
      finishEnergyPhase(next)
      break
    }
    case 'STONE_KEEP':
      if (next.pending?.kind === 'stoneCure') clearPending(next)
      break
    case 'ARROW_SHOT':
    case 'ARROW_SKIP': {
      const pending = next.pending
      if (!pending || pending.kind !== 'arrowVolley') break
      if (action.type === 'ARROW_SHOT') {
        let source: FieldMonster | null = null
        for (const side of next.players) {
          const found = side.field.find((monster) => monster?.instanceId === pending.instanceId)
          if (found) source = found
        }
        dealDamageToTarget(next, source, action.target, 10)
      }
      const nextArcher = pending.queue.shift()
      if (next.winner !== null) break
      if (nextArcher) {
        next.pending = {
          kind: 'arrowVolley',
          owner: nextArcher.owner,
          instanceId: nextArcher.instanceId,
          queue: pending.queue,
        }
      } else {
        clearPending(next)
        passTurn(next)
      }
      break
    }
    case 'WISDOM_ENERGY': {
      const pending = next.pending
      if (!pending || pending.kind !== 'wisdomEnergy') break
      const monster = targetMonster(next, action.target)
      if (monster && action.target.kind === 'monster' && grantEnergy(next, monster, 1) > 0) {
        log(next, `${getMonster(monster.defId).name} gains 1 energy.`)
      }
      pending.remaining -= 1
      if (pending.remaining <= 0) clearPending(next)
      break
    }
    case 'END_TURN': {
      if (next.phase === 'energy') {
        finishEnergyPhase(next)
        if (next.pending !== null) break
      }
      if (!next.endStepResolved) {
        const excess = player.hand.length - HAND_SIZE_LIMIT
        if (excess > 0) {
          beginForcedDiscard(next, player.id, excess)
          next.phase = 'end'
          log(next, `${player.name} must discard down to ${HAND_SIZE_LIMIT}.`)
          break
        }
        resolveEndStep(next)
        next.endStepResolved = true
      }
      if (next.winner !== null) break
      if (next.pending !== null) break
      passTurn(next)
      break
    }
  }

  collapseEmptyExtraSlots(next)
  purgeStatusImmunity(next)
  if (next.winner === null) {
    stampPendingUids(next)
    const generation = next.recursion?.generation
    if (next.recursion?.watchId && generation !== undefined) {
      tagFreshPendings(next, pendingUidsAtStart, generation)
    }
    continueRecursion(next)
  }
  const spellStillCarried = [next.pending, ...next.pendingStack].some((entry) => entry?.spellSourceInstanceId)
  if (!spellStillCarried) next.spellSourceInstanceId = undefined
  return next
}

function takeWatchedCard(state: GameState, instanceId: string): HandCard | undefined {
  for (const player of state.players) {
    for (const pile of [player.discard, player.hand, player.deck, player.removed]) {
      const index = pile.findIndex((card) => card.instanceId === instanceId)
      if (index >= 0) return pile.splice(index, 1)[0]
    }
    const ethereal = player.ethereal ?? []
    const etherealIndex = ethereal.findIndex((entry) => entry.card.instanceId === instanceId)
    if (etherealIndex >= 0) {
      const [entry] = ethereal.splice(etherealIndex, 1)
      player.ethereal = ethereal
      return entry.card
    }
  }
  return undefined
}

function stampPendingUids(state: GameState): void {
  if (!state.recursion) return
  const stamp = (pending: GameState['pending']) => {
    if (!pending || pending.uid !== undefined) return
    state.nextPendingUid = (state.nextPendingUid ?? 0) + 1
    pending.uid = state.nextPendingUid
  }
  stamp(state.pending)
  for (const pending of state.pendingStack) stamp(pending)
}

function pendingUidSet(state: GameState): Set<number> {
  const ids = new Set<number>()
  if (state.pending?.uid !== undefined) ids.add(state.pending.uid)
  for (const pending of state.pendingStack) {
    if (pending.uid !== undefined) ids.add(pending.uid)
  }
  return ids
}

function tagFreshPendings(state: GameState, known: Set<number>, generation: number): void {
  const tag = (pending: GameState['pending']) => {
    if (!pending || pending.uid === undefined || known.has(pending.uid)) return
    pending.recursionGen = generation
    known.add(pending.uid)
  }
  tag(state.pending)
  for (const pending of state.pendingStack) tag(pending)
}

function watchedEffectSettled(state: GameState, generation: number): boolean {
  if (state.pending?.recursionGen === generation) return false
  return !state.pendingStack.some((pending) => pending.recursionGen === generation)
}

function releaseRecursionWatch(state: GameState): void {
  const job = state.recursion
  if (!job) return
  job.watchId = undefined
  job.targets = undefined
  job.generation = undefined
  job.replayingNow = false
  job.replaysLeft = 0
  if (job.charges <= 0) state.recursion = undefined
}

function continueRecursion(state: GameState): void {
  const job = state.recursion
  if (!job?.watchId || job.generation === undefined) return
  if (!watchedEffectSettled(state, job.generation)) return
  if (job.replaysLeft <= 0) {
    releaseRecursionWatch(state)
    return
  }
  const player = state.players[job.owner]
  const card = takeWatchedCard(state, job.watchId)
  if (!card) {
    releaseRecursionWatch(state)
    return
  }
  player.hand.push(card)
  const savedPending = state.pending
  const known = pendingUidSet(state)
  job.replayingNow = true
  job.replaysLeft -= 1
  playEffect(state, player.hand.length - 1, job.targets ?? [], false, player)
  job.replayingNow = false
  if (savedPending && state.pending !== savedPending) {
    if (state.pending === null) state.pending = savedPending
    else state.pendingStack.push(savedPending)
  }
  stampPendingUids(state)
  tagFreshPendings(state, known, job.generation)
  log(state, `${getCard(card.defId).name} is played again.`)
  if (!job.watchId || job.generation === undefined) return
  if (!watchedEffectSettled(state, job.generation)) return
  if (job.replaysLeft <= 0) releaseRecursionWatch(state)
  else continueRecursion(state)
}
