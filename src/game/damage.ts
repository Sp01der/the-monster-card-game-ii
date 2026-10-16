import { getMonster, getWeaknesses } from './catalog'
import type { DamageType, FieldMonster, GameState, PlayerId, PlayerState, TargetRef } from './types'

/** Round n to nearest 10; .5 rounds away from zero in the usual half-up sense for positives. */
export function roundToNearest10(n: number): number {
  return Math.round(n / 10) * 10
}

export function hasSword(monster: FieldMonster): boolean {
  return monster.equipment.some((e) => e.defId === 'sword')
}

export function hasSpear(monster: FieldMonster): boolean {
  return monster.equipment.some((e) => e.defId === 'spear')
}

export function hasFishingRod(monster: FieldMonster): boolean {
  return monster.equipment.some((e) => e.defId === 'fishing_rod')
}

export function hasPrismLens(monster: FieldMonster): boolean {
  return monster.equipment.some((e) => e.defId === 'prism_lens')
}

export function isIlluminated(monster: FieldMonster): boolean {
  return monster.illuminatedThisTurn === true || hasPrismLens(monster)
}

/** Prism Lens: add one unused face to a succeed/fail roll, capping at 6/6. */
export function prismSuccessFaces(monster: FieldMonster | null, faces: number[]): number[] {
  if (!monster || !hasPrismLens(monster) || faces.length >= 6) return faces
  for (let face = 1; face <= 6; face++) {
    if (!faces.includes(face)) return [...faces, face]
  }
  return faces
}

/** Prism Lens: treat “roll at most N” as one face more likely to hit. */
export function prismHitAtMost(monster: FieldMonster | null, maxInclusive: number): number {
  if (!monster || !hasPrismLens(monster)) return maxInclusive
  return Math.min(6, maxInclusive + 1)
}

export const lensSuccessFaces = prismSuccessFaces

export function attackBonusFor(state: GameState, attacker: FieldMonster | null): number {
  if (!attacker || !state.players[state.activePlayer].field.some((monster) => monster?.instanceId === attacker.instanceId)) {
    return 0
  }
  return state.players[state.activePlayer].attackBonus ?? 0
}

/** Spare energy: attached energy or Gold exceeds every required empty dot. */
export function hasSpareEnergy(monster: FieldMonster, requiredEnergy: number): boolean {
  return monster.energy + (monster.gold ?? 0) > requiredEnergy
}

/** Amanesian Warden gains +1 defense while the card it protects has Gold. */
export function guardingGoldDefense(state: GameState, defender: FieldMonster): number {
  if (defender.defId !== 'amanesian_warden' || !defender.protectingInstanceId) return 0
  for (const player of state.players) {
    for (const monster of player.field) {
      if (monster?.instanceId === defender.protectingInstanceId && (monster.gold ?? 0) > 0) {
        return 1
      }
    }
  }
  return 0
}

export function hasRubyRing(monster: FieldMonster): boolean {
  return monster.equipment.some((e) => e.defId === 'ruby_ring')
}

export function playerHasRubyRing(player: PlayerState): boolean {
  return player.field.some((m) => m !== null && hasRubyRing(m))
}

/**
 * Free abilities and Ruby Ring free actions do not spend the team action.
 * They still count as that card acting for the turn.
 */
export function abilityCostsTeamAction(
  monster: FieldMonster,
  ability: { free?: boolean },
): boolean {
  if (ability.free) return false
  if (monster.freeActionThisTurn) return false
  if (hasRubyRing(monster)) return false
  return true
}

/**
 * Damage pipeline:
 * 1. base
 * 2. Sword: +10, or +20 if attached energy exceeds the ability's requirement
 *    Spear: +10, stacking with Sword
 *    Gold Affinity passives (before defense)
 * 3. weakness ×1.5 rounded to nearest 10 (untyped never triggers)
 * 4. optional double (Great Axe), after bonuses and weakness, before defense
 * 5. defense −10 per point, minimum 10 (skipped if piercing / sound)
 */
export function computeDamage(args: {
  base: number
  damageType?: DamageType
  piercing?: boolean
  /** Empty-dot energy reserved by the ability and therefore not spare. */
  requiredEnergy?: number
  attacker: FieldMonster | null
  defender: FieldMonster
  /** Applied after weakness and before defense. */
  doubleBeforeDefense?: boolean
  defenseBonus?: number
  /** ATTACK! and similar bonuses, applied with Sword and before weakness. */
  bonusBeforeWeakness?: number
}): number {
  const {
    base,
    damageType = 'untyped',
    piercing = false,
    requiredEnergy = 0,
    attacker,
    defender,
    doubleBeforeDefense = false,
    defenseBonus = 0,
    bonusBeforeWeakness = 0,
  } = args
  if (base <= 0) return 0
  let amount = base
  if (attacker?.statuses.some((status) => status.kind === 'weakened')) {
    amount = roundToNearest10(amount / 2)
  }

  if (attacker && hasSword(attacker)) {
    amount += hasSpareEnergy(attacker, requiredEnergy) ? 20 : 10
  }
  if (attacker && hasSpear(attacker)) {
    amount += 10
  }
  if (attacker?.defId === 'loot_goblin') {
    amount += ((attacker.gold ?? 0) + attacker.equipment.length) * 10
  }
  if (attacker?.defId === 'amanesian_warden') {
    amount += (attacker.gold ?? 0) * 10
  }
  if (bonusBeforeWeakness > 0) amount += bonusBeforeWeakness

  const def = getMonster(defender.defId)
  if (damageType === 'water' && defender.statuses.some((s) => s.kind === 'wet')) {
    amount += 10
  }
  const weaknesses = defender.weaknessOverride
    ? [defender.weaknessOverride]
    : getWeaknesses(defender.defId)
  const ownWeakness = damageType !== 'untyped' && weaknesses.includes(damageType)
  const illuminatedLight =
    attacker !== null && weaknesses.includes('light') && isIlluminated(attacker)
  if (ownWeakness || illuminatedLight) {
    const extreme = def.extremeWeakness === true
    amount = roundToNearest10(amount * (extreme ? 2 : 1.5))
  }

  if (doubleBeforeDefense) amount *= 2

  const isPiercing = piercing || damageType === 'sound'
  if (!isPiercing) {
    const shieldDefense = defender.equipment.filter((e) => e.defId === 'shield').length
    const fortify = (defender.fortifyHitsLeft ?? 0) > 0 ? 1 : 0
    const defense = (def.defense ?? 0) + shieldDefense + fortify + defenseBonus
    if (defense > 0) {
      amount = Math.max(10, amount - defense * 10)
    }
  }

  return amount
}

function occupiedSlots(field: (FieldMonster | null)[]): number[] {
  const slots: number[] = []
  for (let i = 0; i < field.length; i++) {
    if (field[i]) slots.push(i)
  }
  return slots
}

function nextOccupied(field: (FieldMonster | null)[], slot: number, step: -1 | 1): number | null {
  for (let i = slot + step; i >= 0 && i < field.length; i += step) {
    if (field[i]) return i
  }
  return null
}

/**
 * All living cards form one circle. Same-row neighbors skip empty slots.
 * Each player's leftmost living card is adjacent to the opponent's leftmost,
 * and the same for the rightmost ends.
 */
export function getCircleAdjacent(
  state: GameState,
  playerId: PlayerId,
  slot: number,
): TargetRef[] {
  const player = state.players[playerId]
  const opponent = state.players[playerId === 0 ? 1 : 0]
  const seen = new Set<string>()
  const result: TargetRef[] = []
  const add = (target: TargetRef) => {
    const key = `${target.player}-${target.slot}`
    if (seen.has(key)) return
    seen.add(key)
    result.push(target)
  }

  const left = nextOccupied(player.field, slot, -1)
  if (left !== null) add({ kind: 'monster', player: playerId, slot: left })
  const right = nextOccupied(player.field, slot, 1)
  if (right !== null) add({ kind: 'monster', player: playerId, slot: right })

  const mine = occupiedSlots(player.field)
  const theirs = occupiedSlots(opponent.field)
  if (mine.length > 0 && theirs.length > 0) {
    if (slot === mine[0]) {
      add({ kind: 'monster', player: opponent.id, slot: theirs[0] })
    }
    if (slot === mine[mine.length - 1]) {
      add({ kind: 'monster', player: opponent.id, slot: theirs[theirs.length - 1] })
    }
  }
  return result
}

/** Next living cards to the left and right; empty slots are skipped. */
export function getAdjacentSlots(field: (FieldMonster | null)[], slot: number): number[] {
  const result: number[] = []
  const left = nextOccupied(field, slot, -1)
  const right = nextOccupied(field, slot, 1)
  if (left !== null) result.push(left)
  if (right !== null) result.push(right)
  return result
}

/**
 * Adjacent targets for a monster. If this row has no other living cards, fall
 * back to the nearest opposing monster (2-player interpretation of "adjacent player").
 */
export function getAdjacentTargets(
  ownField: (FieldMonster | null)[],
  slot: number,
  opponentField: (FieldMonster | null)[],
): Array<{ player: 'own' | 'opponent'; slot: number }> {
  const neighbors = getAdjacentSlots(ownField, slot)
  if (neighbors.length > 0) {
    return neighbors.map((s) => ({ player: 'own' as const, slot: s }))
  }

  let bestSlot = -1
  let bestDist = Infinity
  for (let i = 0; i < opponentField.length; i++) {
    if (!opponentField[i]) continue
    const dist = Math.abs(i - slot)
    if (dist < bestDist) {
      bestDist = dist
      bestSlot = i
    }
  }
  if (bestSlot >= 0) return [{ player: 'opponent', slot: bestSlot }]
  return []
}
