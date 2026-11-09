import { deathSpawnDefId, getCard, getMonster, identityDefId, isBoneling } from './catalog'
import type {
  CardSnapshot,
  FieldEquipment,
  FieldMonster,
  GameState,
  HandCard,
  HeldCard,
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
  if (state.goldenDieFace !== undefined) {
    const n = state.goldenDieFace
    state.goldenDieFace = undefined
    state.goldenDice?.shift()
    if (n < 1 || n > 6 || !Number.isInteger(n)) {
      throw new Error(`Golden Die face must be an integer 1-6, got ${n}`)
    }
    state.log.push({ message: `The Golden Die shows ${n}`, dieRoll: n })
    return n
  }
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

export function wearsSaphireRing(monster: FieldMonster): boolean {
  return monster.equipment.some((equipment) => equipment.defId === 'saphire_ring')
}

const NEGATIVE_STATUSES = new Set<StatusInstance['kind']>([
  'goo',
  'frozen',
  'burn',
  'poison',
  'wet',
  'cling',
  'weakened',
])

export function isFrozen(monster: FieldMonster): boolean {
  if (wearsSaphireRing(monster)) return false
  return monster.statuses.some((s) => s.kind === 'frozen')
}

export function isGooed(monster: FieldMonster): boolean {
  if (wearsSaphireRing(monster)) return false
  return monster.statuses.some((s) => s.kind === 'goo')
}

export function isClinged(monster: FieldMonster): boolean {
  if (wearsSaphireRing(monster)) return false
  return monster.statuses.some((s) => s.kind === 'cling')
}

/** Remove negative statuses from a card wearing Saphire Ring, including Cling links onto it. */
export function clearNegativeStatuses(state: GameState, monster: FieldMonster): void {
  if (!wearsSaphireRing(monster)) return
  const removed = monster.statuses.some((status) => NEGATIVE_STATUSES.has(status.kind))
  if (!removed) return
  for (const player of state.players) {
    for (const other of player.field) {
      if (other?.clingTargetInstanceId === monster.instanceId) {
        other.clingTargetInstanceId = undefined
      }
    }
  }
  monster.statuses = monster.statuses.filter((status) => !NEGATIVE_STATUSES.has(status.kind))
  log(state, `${getMonster(monster.defId).name} is immune to negative status effects.`)
}

export function hasKeystone(monster: FieldMonster): boolean {
  return monster.equipment.some((equipment) => equipment.defId === 'colossus_keystone')
}

/** A Colossus with no Keystone cannot gain energy from any source. */
export function canReceiveEnergy(monster: FieldMonster): boolean {
  return identityDefId(monster) !== 'colossus' || hasKeystone(monster)
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
    if (isGooed(protector) || isClinged(protector)) {
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
  sourcePlayer?: PlayerId,
): boolean {
  if (wearsSaphireRing(monster) && NEGATIVE_STATUSES.has(kind)) return false
  const added = turns * Math.max(1, stacks)
  // Cling is a maintained link, not a duration that adds.
  if (kind === 'cling') {
    const existing = monster.statuses.find((s) => s.kind === 'cling')
    if (existing) {
      existing.sourceInstanceId = sourceInstanceId
      existing.skipNextTick = skipNextTick
      if (sourcePlayer !== undefined) existing.sourcePlayer = sourcePlayer
      return true
    }
    monster.statuses.push({ kind, turns, skipNextTick, sourceInstanceId, sourcePlayer })
    return true
  }
  const existing = monster.statuses.find((s) => s.kind === kind)
  if (existing) {
    existing.turns += added
    if (sourcePlayer !== undefined) existing.sourcePlayer = sourcePlayer
    return true
  }
  monster.statuses.push({ kind, turns: added, skipNextTick, sourceInstanceId, sourcePlayer })
  return true
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

function findMonster(state: GameState, instanceId: string): { player: PlayerState; slot: number; monster: FieldMonster } | null {
  for (const player of state.players) {
    for (let slot = 0; slot < player.field.length; slot++) {
      const monster = player.field[slot]
      if (monster?.instanceId === instanceId) return { player, slot, monster }
    }
  }
  return null
}

function discardStoredMonster(state: GameState, ownerId: PlayerId, monster: FieldMonster): void {
  const owner = state.players[ownerId]
  if (monster.held) {
    const nested = monster.held
    monster.held = undefined
    releaseHeld(state, null, null, nested)
  }
  for (const equipment of monster.equipment) {
    const card = { instanceId: equipment.instanceId, defId: equipment.defId }
    const def = getCard(equipment.defId)
    if (def.kind === 'equipment' && def.indestructible) owner.removed.push(card)
    else owner.discard.push(card)
  }
  owner.discard.push({ instanceId: monster.instanceId, defId: monster.defId })
  log(state, `${getMonster(monster.defId).name} was removed.`)
}

function placeReturningMonster(
  state: GameState,
  playerId: PlayerId,
  slot: number,
  monster: FieldMonster,
): void {
  monster.ownsExtraSlot = false
  state.players[playerId].field[slot] = monster
  log(
    state,
    `${getMonster(monster.defId).name} returns to ${state.players[playerId].name}'s field.`,
  )
  if (isBoneling(monster.defId) && monster.stance === 'withdrawn') {
    monster.hp = 0
    log(state, `${getMonster(monster.defId).name} cannot withdraw and dies instead.`)
    discardMonster(state, state.players[playerId], slot, 'slain')
  }
}

/** Put an Absorbed card back, or Remove it when it has nowhere to return. */
export function releaseHeld(
  state: GameState,
  preferPlayer: PlayerId | null,
  preferSlot: number | null,
  held: HeldCard,
): void {
  if (held.kind === 'equipment') {
    const host = findMonster(state, held.hostInstanceId)
    if (!host) {
      const owner = state.players[held.owner]
      const card = { instanceId: held.equipment.instanceId, defId: held.equipment.defId }
      const def = getCard(held.equipment.defId)
      if (def.kind === 'equipment' && def.indestructible) owner.removed.push(card)
      else owner.discard.push(card)
      log(state, `${getCard(held.equipment.defId).name} was removed.`)
      return
    }
    host.monster.equipment.push(held.equipment)
    if (held.equipment.defId === 'resilience') applyResilience(host.monster)
    log(state, `${getCard(held.equipment.defId).name} returns to ${getMonster(host.monster.defId).name}.`)
    return
  }

  const preferOpen =
    preferPlayer !== null &&
    preferSlot !== null &&
    preferSlot >= 0 &&
    state.players[preferPlayer].field[preferSlot] == null
  if (preferOpen) {
    placeReturningMonster(state, preferPlayer, preferSlot, held.monster)
    return
  }
  const owner = state.players[held.owner]
  const slot = owner.field[held.fromSlot] == null ? held.fromSlot : emptySlots(owner)[0]
  if (slot === undefined) {
    discardStoredMonster(state, held.owner, held.monster)
    return
  }
  placeReturningMonster(state, held.owner, slot, held.monster)
}

/** Take a monster off the field without discarding it or losing points. */
export function liftMonster(state: GameState, player: PlayerState, slot: number): FieldMonster | null {
  const monster = player.field[slot]
  if (!monster) return null
  if (monster.protectingInstanceId) releaseProtection(state, monster)
  for (const owner of state.players) {
    for (const other of owner.field) {
      if (!other) continue
      if (other.protectingInstanceId === monster.instanceId) other.protectingInstanceId = undefined
      if (other.protectedByInstanceId === monster.instanceId) other.protectedByInstanceId = undefined
    }
  }
  monster.protectingInstanceId = undefined
  monster.protectedByInstanceId = undefined
  monster.clingTargetInstanceId = undefined
  for (const owner of state.players) {
    for (const other of owner.field) {
      if (!other) continue
      other.statuses = other.statuses.filter(
        (status) => status.kind !== 'cling' || status.sourceInstanceId !== monster.instanceId,
      )
    }
  }
  player.field[slot] = null
  return monster
}

export function liftEquipment(
  player: PlayerState,
  slot: number,
  equipmentIndex: number,
): FieldEquipment | null {
  const monster = player.field[slot]
  const equipment = monster?.equipment[equipmentIndex]
  if (!monster || !equipment) return null
  if (equipment.defId === 'resilience') removeResilience(monster)
  monster.equipment.splice(equipmentIndex, 1)
  return equipment
}

export function discardMonster(
  state: GameState,
  player: PlayerState,
  slot: number,
  mode: 'slain' | 'removed',
  slainBy?: PlayerId,
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
  const held = monster.held
  monster.held = undefined
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
    if (
      monster.speakerArmed &&
      monster.stance === 'active' &&
      identityDefId(monster) === 'public_speaker' &&
      slainBy !== undefined &&
      slainBy !== player.id
    ) {
      for (const ally of player.field) {
        if (ally) grantEnergy(state, ally, 1)
      }
      player.bonusTeamActions = (player.bonusTeamActions ?? 0) + 1
      log(
        state,
        `${def.name} falls, and ${player.name}'s monsters gain 1 energy. ${player.name} may take an additional action next turn.`,
      )
    }
    const spawnId = deathSpawnDefId(monster.defId)
    if (spawnId && player.points > 0) {
      const job = { owner: player.id, remaining: 2, defId: spawnId }
      if (state.pending?.kind === 'spawnBlobs') {
        if (state.pending.owner === player.id && state.pending.defId === spawnId) {
          state.pending.remaining += 2
        } else {
          const queued = state.pending.queue.find(
            (item) => item.owner === player.id && item.defId === spawnId,
          )
          if (queued) queued.remaining += 2
          else state.pending.queue.push(job)
        }
      } else {
        state.pending = { kind: 'spawnBlobs', ...job, queue: [] }
      }
      log(state, `${player.name} may place two ${getCard(spawnId).name}s.`)
    }
  } else {
    log(state, `${player.name}'s ${def.name} was removed.`)
  }
  if (held) releaseHeld(state, player.id, slot, held)
}

export function applyResilience(monster: FieldMonster): void {
  monster.maxHp += 20
  monster.hp = Math.min(monster.maxHp, monster.hp + 30)
}

export function removeResilience(monster: FieldMonster): void {
  monster.maxHp -= 20
  monster.hp = Math.min(monster.hp, monster.maxHp)
}

const RUNE_STONES = ['resilience', 'strength', 'efficiency'] as const

/** Map a d6 onto the three runestones. 1–2 Resilience, 3–4 Strength, 5–6 Efficiency. */
export function randomRunestone(state: GameState): (typeof RUNE_STONES)[number] {
  const roll = rollDie(state)
  return RUNE_STONES[Math.min(2, Math.floor((roll - 1) / 2))]!
}

export function attachCreatedEquipment(
  state: GameState,
  monster: FieldMonster,
  defId: string,
): void {
  const def = getCard(defId)
  if (def.kind !== 'equipment') return
  const card = makeCard(state, defId)
  monster.equipment.push({
    instanceId: card.instanceId,
    defId,
    hp: def.maxHp,
    maxHp: def.maxHp,
  })
  if (defId === 'resilience') applyResilience(monster)
  log(state, `${def.name} is attached to ${getMonster(monster.defId).name}.`)
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
    log(state, `${def.name} cannot be removed.`)
    return
  }
  if (eq.defId === 'resilience') removeResilience(monster)
  monster.equipment.splice(equipmentIndex, 1)
  player.discard.push({ instanceId: eq.instanceId, defId: eq.defId })
  log(state, `${def.name} on ${getMonster(monster.defId).name} was removed.`)
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
    case 'chargedSplat':
      pending.sourceSlot = shiftSource(pending.sourcePlayer, pending.sourceSlot)
      break
    case 'forceWithdraw':
      if (pending.player === playerId) {
        pending.slot = pending.slot === removed ? -1 : shiftSlot(pending.slot, removed)
      }
      break
    case 'bringForth':
    case 'cloudDestroy':
      if (pending.owner === playerId) {
        pending.sourceSlot = pending.sourceSlot === removed ? -1 : shiftSlot(pending.sourceSlot, removed)
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

export function captureCardSnapshot(state: GameState, target: TargetRef): CardSnapshot | null {
  const player = state.players[target.player]
  const monster = player.field[target.slot]
  if (!monster) return null
  if (target.kind === 'equipment') {
    const equipment = monster.equipment[target.equipmentIndex]
    if (!equipment) return null
    return {
      instanceId: equipment.instanceId,
      defId: equipment.defId,
      kind: 'equipment',
      owner: target.player,
      slot: target.slot,
      equipmentIndex: target.equipmentIndex,
      hostInstanceId: monster.instanceId,
      hp: equipment.hp,
      maxHp: equipment.maxHp,
      energy: 0,
      pendingEnergy: 0,
      stance: 'active',
      statuses: [],
      equipment: [],
    }
  }
  return {
    instanceId: monster.instanceId,
    defId: monster.defId,
    kind: 'monster',
    owner: target.player,
    slot: target.slot,
    hp: monster.hp,
    maxHp: monster.maxHp,
    energy: monster.energy,
    pendingEnergy: monster.pendingEnergy,
    stance: monster.stance,
    statuses: structuredClone(monster.statuses),
    equipment: structuredClone(monster.equipment),
    gold: monster.gold,
    shadowBonus: monster.shadowBonus,
    shapeshiftDefId: monster.shapeshiftDefId,
    weaknessOverride: monster.weaknessOverride,
    unending: monster.unending,
  }
}

function exciseInstance(state: GameState, instanceId: string): void {
  for (const player of state.players) {
    for (const pile of [player.deck, player.hand, player.discard, player.removed]) {
      const index = pile.findIndex((card) => card.instanceId === instanceId)
      if (index >= 0) pile.splice(index, 1)
    }
    if (player.ethereal) {
      player.ethereal = player.ethereal.filter((entry) => entry.card.instanceId !== instanceId)
    }
    for (const monster of player.field) {
      if (!monster) continue
      monster.equipment = monster.equipment.filter((equipment) => equipment.instanceId !== instanceId)
    }
  }
}

function parkMonster(player: PlayerState, monster: FieldMonster): void {
  const open = player.field.findIndex((slot) => slot === null)
  if (open >= 0) {
    player.field[open] = monster
    return
  }
  monster.ownsExtraSlot = true
  player.field.push(monster)
}

/** Puts a remembered card back. Points already lost stay lost. */
export function restoreSnapshot(state: GameState, snapshot: CardSnapshot): void {
  const snap = structuredClone(snapshot)
  if (snap.kind === 'equipment') {
    let host: FieldMonster | null = null
    if (snap.hostInstanceId) {
      for (const player of state.players) {
        for (const monster of player.field) {
          if (monster?.instanceId === snap.hostInstanceId) host = monster
        }
      }
    }
    exciseInstance(state, snap.instanceId)
    if (!host) {
      state.players[snap.owner].discard.push({ instanceId: snap.instanceId, defId: snap.defId })
      log(state, `${getCard(snap.defId).name} cannot return because its monster is gone.`)
      return
    }
    const displaced = host.equipment.filter((equipment) => equipment.defId === snap.defId)
    host.equipment = host.equipment.filter((equipment) => equipment.defId !== snap.defId)
    const owner = state.players.find((player) => player.field.includes(host))
    if (owner) {
      for (const equipment of displaced) {
        owner.discard.push({ instanceId: equipment.instanceId, defId: equipment.defId })
      }
    }
    host.equipment.push({
      instanceId: snap.instanceId,
      defId: snap.defId,
      hp: snap.hp,
      maxHp: snap.maxHp,
    })
    log(state, `${getCard(snap.defId).name} returns to its remembered state.`)
    return
  }

  const keep = new Set(snap.equipment.map((equipment) => equipment.instanceId))
  let monster: FieldMonster | null = null
  for (const player of state.players) {
    for (let slot = 0; slot < player.field.length; slot++) {
      const current = player.field[slot]
      if (!current || current.instanceId !== snap.instanceId) continue
      for (const equipment of current.equipment) {
        if (!keep.has(equipment.instanceId)) {
          player.discard.push({ instanceId: equipment.instanceId, defId: equipment.defId })
        }
      }
      player.field[slot] = null
      monster = current
    }
  }
  exciseInstance(state, snap.instanceId)
  for (const equipment of snap.equipment) exciseInstance(state, equipment.instanceId)

  const owner = state.players[snap.owner]
  while (owner.field.length <= snap.slot) owner.field.push(null)
  const occupant = owner.field[snap.slot]
  if (occupant && occupant.instanceId !== snap.instanceId) parkMonster(owner, occupant)

  const restored: FieldMonster = monster ?? {
    instanceId: snap.instanceId,
    defId: snap.defId,
    hp: snap.hp,
    maxHp: snap.maxHp,
    stance: snap.stance,
    energy: snap.energy,
    pendingEnergy: snap.pendingEnergy,
    statuses: [],
    equipment: [],
  }
  restored.defId = snap.defId
  restored.hp = snap.hp
  restored.maxHp = snap.maxHp
  restored.stance = snap.stance
  restored.energy = snap.energy
  restored.pendingEnergy = snap.pendingEnergy
  restored.statuses = snap.statuses
  restored.equipment = snap.equipment
  restored.gold = snap.gold
  restored.shadowBonus = snap.shadowBonus
  restored.shapeshiftDefId = snap.shapeshiftDefId
  restored.weaknessOverride = snap.weaknessOverride
  restored.unending = snap.unending
  restored.ownsExtraSlot = snap.slot >= FIELD_SIZE ? true : restored.ownsExtraSlot
  owner.field[snap.slot] = restored
  log(state, `${getMonster(restored.defId).name} returns to its remembered state.`)
}
