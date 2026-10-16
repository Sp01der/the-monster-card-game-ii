import { getCard, getMonster } from './catalog'
import type {
  FieldMonster,
  GameState,
  HandCard,
  PendingInteraction,
  PlayerId,
  PlayerState,
  StatusInstance,
  TargetRef,
} from './types'
import { FIELD_SIZE } from './types'

export function otherPlayer(id: PlayerId): PlayerId {
  return id === 0 ? 1 : 0
}

export function targetInstanceId(state: GameState, target: TargetRef): string | null {
  const monster = state.players[target.player].field[target.slot]
  if (!monster) return null
  if (target.kind === 'monster') return monster.instanceId
  return monster.equipment[target.equipmentIndex]?.instanceId ?? null
}

export function targetFromInstanceId(state: GameState, instanceId: string): TargetRef | null {
  for (const player of state.players) {
    for (let slot = 0; slot < player.field.length; slot++) {
      const monster = player.field[slot]
      if (!monster) continue
      if (monster.instanceId === instanceId) {
        return { kind: 'monster', player: player.id, slot }
      }
      const equipmentIndex = monster.equipment.findIndex((eq) => eq.instanceId === instanceId)
      if (equipmentIndex >= 0) {
        return { kind: 'equipment', player: player.id, slot, equipmentIndex }
      }
    }
  }
  return null
}

export function cloneState(state: GameState): GameState {
  const { rng, random, ...rest } = state
  const cloned = structuredClone(rest) as Omit<GameState, 'rng' | 'random'>
  return { ...cloned, rng, random }
}

export function log(state: GameState, message: string): void {
  state.log.push({ message })
}

export function rollDie(state: GameState): number {
  const n = state.rng()
  if (n < 1 || n > 6 || !Number.isInteger(n)) {
    throw new Error(`RNG must return integer 1-6, got ${n}`)
  }
  state.log.push({ message: `Rolled ${n}`, dieRoll: n })
  return n
}

export function allocId(state: GameState): string {
  const id = `i${state.nextInstanceId}`
  state.nextInstanceId++
  return id
}

export function makeCard(state: GameState, defId: string): HandCard {
  return { instanceId: allocId(state), defId }
}

export function getPlayer(state: GameState, id: PlayerId): PlayerState {
  return state.players[id]
}

export function activePlayer(state: GameState): PlayerState {
  return state.players[state.activePlayer]
}

export function opponent(state: GameState): PlayerState {
  return state.players[otherPlayer(state.activePlayer)]
}

export function monsterAt(player: PlayerState, slot: number): FieldMonster | null {
  if (slot < 0 || slot >= player.field.length) return null
  return player.field[slot]
}

export function resolveTarget(
  state: GameState,
  target: TargetRef,
): { player: PlayerState; monster: FieldMonster; slot: number; equipmentIndex?: number } | null {
  const player = getPlayer(state, target.player)
  const monster = monsterAt(player, target.slot)
  if (!monster) return null
  if (target.kind === 'equipment') {
    if (!monster.equipment[target.equipmentIndex]) return null
    return { player, monster, slot: target.slot, equipmentIndex: target.equipmentIndex }
  }
  return { player, monster, slot: target.slot }
}

export function isFrozen(monster: FieldMonster): boolean {
  return monster.statuses.some((s) => s.kind === 'frozen')
}

export function isGooed(monster: FieldMonster): boolean {
  return monster.statuses.some((s) => s.kind === 'goo')
}

export function hasKeystone(monster: FieldMonster): boolean {
  return monster.equipment.some((equipment) => equipment.defId === 'colossus_keystone')
}

/** A Colossus with no Keystone cannot gain energy from any source. */
export function canReceiveEnergy(monster: FieldMonster): boolean {
  return monster.defId !== 'colossus' || hasKeystone(monster)
}

export function grantEnergy(state: GameState, monster: FieldMonster, amount: number): number {
  if (amount <= 0) return 0
  if (!canReceiveEnergy(monster)) {
    log(state, `${getMonster(monster.defId).name} cannot gain energy without a Colossus Keystone.`)
    return 0
  }
  monster.energy += amount
  return amount
}

export function isDamageProtected(state: GameState, monster: FieldMonster): boolean {
  const protectorId = monster.protectedByInstanceId
  if (!protectorId) return false
  for (const player of state.players) {
    for (const candidate of player.field) {
      if (
        candidate &&
        candidate.instanceId === protectorId &&
        candidate.protectingInstanceId === monster.instanceId &&
        candidate.stance === 'active'
      ) {
        return true
      }
    }
  }
  return false
}

export function releaseProtection(state: GameState, protector: FieldMonster): void {
  const wardId = protector.protectingInstanceId
  protector.protectingInstanceId = undefined
  if (!wardId) return
  for (const player of state.players) {
    for (const monster of player.field) {
      if (monster?.protectedByInstanceId === protector.instanceId) {
        monster.protectedByInstanceId = undefined
      }
    }
  }
  log(state, `${getMonster(protector.defId).name} stops protecting.`)
}

/** Move the protector in front of one of your cards. Ends if the protector later withdraws. */
export function beginProtection(
  state: GameState,
  protector: FieldMonster,
  ward: FieldMonster,
): boolean {
  if (protector.instanceId === ward.instanceId) return false
  if (protector.stance !== 'active') {
    if (isGooed(protector) || protector.statuses.some((status) => status.kind === 'cling')) {
      log(state, `${getMonster(protector.defId).name} cannot move in front while Gooed or Clinged.`)
      return false
    }
    protector.stance = 'active'
  }
  releaseProtection(state, protector)
  for (const player of state.players) {
    for (const monster of player.field) {
      if (monster?.protectingInstanceId === ward.instanceId) {
        monster.protectingInstanceId = undefined
      }
    }
  }
  protector.protectingInstanceId = ward.instanceId
  ward.protectedByInstanceId = protector.instanceId
  log(
    state,
    `${getMonster(protector.defId).name} protects ${getMonster(ward.defId).name}.`,
  )
  return true
}

export function applyStatus(
  monster: FieldMonster,
  kind: StatusInstance['kind'],
  turns: number,
  stacks = 1,
  sourceInstanceId?: string,
  skipNextTick = false,
): void {
  const added = turns * Math.max(1, stacks)
  // Cling is a maintained link, not a duration that adds.
  if (kind === 'cling') {
    const existing = monster.statuses.find((s) => s.kind === 'cling')
    if (existing) {
      existing.sourceInstanceId = sourceInstanceId
      existing.skipNextTick = skipNextTick
      return
    }
    monster.statuses.push({ kind, turns, skipNextTick, sourceInstanceId })
    return
  }
  const existing = monster.statuses.find((s) => s.kind === kind)
  if (existing) {
    existing.turns += added
    return
  }
  monster.statuses.push({ kind, turns: added, skipNextTick, sourceInstanceId })
}

export function goldCount(monster: FieldMonster): number {
  return monster.gold ?? 0
}

export type GoldPayment = { goldRequire: number; goldSpend: number }

/** Ways to cover a cost when Gold counts as energy. An empty 0 keeps Gold; a filled + removes one. */
export function goldPayments(monster: FieldMonster, require: number, spend: number): GoldPayment[] {
  const gold = goldCount(monster)
  const payments: GoldPayment[] = []
  for (let goldSpend = 0; goldSpend <= Math.min(gold, spend); goldSpend++) {
    const goldLeft = gold - goldSpend
    for (let goldRequire = 0; goldRequire <= Math.min(goldLeft, require); goldRequire++) {
      const energyNeed = require - goldRequire + (spend - goldSpend)
      if (monster.energy >= energyNeed) payments.push({ goldRequire, goldSpend })
    }
  }
  return payments
}

export function canAfford(monster: FieldMonster, require: number, spend: number): boolean {
  return goldPayments(monster, require, spend).length > 0
}

export function spendEnergy(monster: FieldMonster, spend: number): void {
  monster.energy -= spend
}

export function discardMonster(
  state: GameState,
  player: PlayerState,
  slot: number,
  mode: 'slain' | 'removed',
): void {
  const monster = player.field[slot]
  if (!monster) return
  const def = getMonster(monster.defId)

  if (monster.protectingInstanceId) releaseProtection(state, monster)
  for (const owner of state.players) {
    for (const other of owner.field) {
      if (!other) continue
      if (other.protectingInstanceId === monster.instanceId) other.protectingInstanceId = undefined
      if (other.protectedByInstanceId === monster.instanceId) other.protectedByInstanceId = undefined
    }
  }

  for (const eq of monster.equipment) {
    const card = { instanceId: eq.instanceId, defId: eq.defId }
    if (eq.defId === 'colossus_keystone') player.removed.push(card)
    else player.discard.push(card)
  }

  player.discard.push({ instanceId: monster.instanceId, defId: monster.defId })
  player.field[slot] = null

  // Any Cling maintained by or attached to this monster ends.
  for (const p of state.players) {
    for (const m of p.field) {
      if (!m) continue
      m.statuses = m.statuses.filter(
        (s) => s.kind !== 'cling' || s.sourceInstanceId !== monster.instanceId,
      )
      if (m.clingTargetInstanceId === monster.instanceId) {
        m.clingTargetInstanceId = undefined
      }
    }
  }

  if (mode === 'slain') {
    player.points -= def.points
    log(
      state,
      `${player.name}'s ${def.name} was slain (−${def.points} point${def.points === 1 ? '' : 's'}). Points: ${player.points}`,
    )
    if (monster.defId === 'big_blob' && player.points > 0) {
      if (state.pending?.kind === 'spawnBlobs') {
        if (state.pending.owner === player.id) state.pending.remaining += 2
        else state.pending.queue.push({ owner: player.id, remaining: 2 })
      } else {
        state.pending = { kind: 'spawnBlobs', owner: player.id, remaining: 2, queue: [] }
      }
      log(state, `${player.name} may place two Blobs from Big Blob's passive.`)
    }
  } else {
    log(state, `${player.name}'s ${def.name} was removed.`)
  }
}

export function destroyEquipment(
  state: GameState,
  player: PlayerState,
  slot: number,
  equipmentIndex: number,
): void {
  const monster = player.field[slot]
  if (!monster) return
  const eq = monster.equipment[equipmentIndex]
  if (!eq) return
  const def = getCard(eq.defId)
  if (def.kind === 'equipment' && def.indestructible) {
    log(state, `${def.name} cannot be destroyed.`)
    return
  }
  monster.equipment.splice(equipmentIndex, 1)
  player.discard.push({ instanceId: eq.instanceId, defId: eq.defId })
  log(state, `${def.name} on ${getMonster(monster.defId).name} was destroyed.`)
}

export function checkLosses(state: GameState): void {
  if (state.winner !== null) return

  for (const player of state.players) {
    if (player.points <= 0) {
      state.winner = otherPlayer(player.id)
      log(state, `${player.name} has no points. ${getPlayer(state, state.winner).name} wins!`)
      return
    }
  }

  for (const player of state.players) {
    if (
      state.pending?.kind === 'spawnBlobs' &&
      (state.pending.owner === player.id ||
        state.pending.queue.some((queued) => queued.owner === player.id))
    ) continue
    if (!player.hasFinishedFirstTurn) continue
    const hasMonster = player.field.some((m) => m !== null)
    if (!hasMonster) {
      state.winner = otherPlayer(player.id)
      log(
        state,
        `${player.name} has no monsters in play. ${getPlayer(state, state.winner).name} wins!`,
      )
      return
    }
  }
}

export function monstersInPlay(player: PlayerState): number {
  return player.field.filter((m) => m !== null).length
}

export function emptySlots(player: PlayerState): number[] {
  const slots: number[] = []
  for (let i = 0; i < player.field.length; i++) {
    if (!player.field[i]) slots.push(i)
  }
  return slots
}

function shiftSlot(slot: number, removed: number): number {
  return slot > removed ? slot - 1 : slot
}

function shiftTarget(target: TargetRef, playerId: PlayerId, removed: number): TargetRef {
  if (target.player !== playerId) return target
  if (target.slot === removed) return { ...target, slot: -1 }
  if (target.slot > removed) return { ...target, slot: target.slot - 1 }
  return target
}

function remapPending(pending: PendingInteraction, playerId: PlayerId, removed: number): void {
  const shiftSource = (sourcePlayer: PlayerId, sourceSlot: number) =>
    sourcePlayer === playerId ? (sourceSlot === removed ? -1 : shiftSlot(sourceSlot, removed)) : sourceSlot
  switch (pending.kind) {
    case 'multiHit':
    case 'repeatGoo':
    case 'plasmaCannon':
    case 'soundWave':
    case 'freezeTargets':
    case 'stormType':
      pending.sourceSlot = shiftSource(pending.sourcePlayer, pending.sourceSlot)
      break
    case 'forceWithdraw':
      if (pending.player === playerId) {
        pending.slot = pending.slot === removed ? -1 : shiftSlot(pending.slot, removed)
      }
      break
    case 'bury':
      if (pending.sourceSlot !== undefined && pending.owner === playerId) {
        pending.sourceSlot = pending.sourceSlot === removed ? -1 : shiftSlot(pending.sourceSlot, removed)
      }
      if (pending.target) pending.target = shiftTarget(pending.target, playerId, removed)
      break
    case 'brewWeakness':
      pending.target = shiftTarget(pending.target, playerId, removed)
      break
    case 'march':
      if (pending.owner === playerId) {
        pending.chosenSlots = pending.chosenSlots
          .filter((slot) => slot !== removed)
          .map((slot) => shiftSlot(slot, removed))
      }
      break
    default:
      break
  }
}

/** Extra Lovni's Weed slots disappear once empty. Later slot indexes move down to match. */
export function collapseEmptyExtraSlots(state: GameState): void {
  for (const player of state.players) {
    for (let slot = player.field.length - 1; slot >= FIELD_SIZE; slot--) {
      if (player.field[slot]) continue
      player.field.splice(slot, 1)
      if (state.activePlayer === player.id) {
        state.actedSlots = state.actedSlots
          .filter((acted) => acted !== slot)
          .map((acted) => shiftSlot(acted, slot))
        state.movedSlots = state.movedSlots
          .filter((moved) => moved !== slot)
          .map((moved) => shiftSlot(moved, slot))
      }
      for (const pending of [state.pending, ...state.pendingStack]) {
        if (pending) remapPending(pending, player.id, slot)
      }
    }
  }
}

export function defaultRng(): () => number {
  return () => Math.floor(Math.random() * 6) + 1
}
