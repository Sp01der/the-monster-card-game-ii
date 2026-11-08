import type { GameAction } from '../types'

function abilityKey(action: Extract<GameAction, { type: 'USE_ABILITY' }>): string {
  return JSON.stringify({
    slot: action.slot,
    abilityId: action.abilityId,
    target: action.target ?? null,
    targets: action.targets ?? null,
    choice: action.choice ?? null,
  })
}

function goldCost(action: Extract<GameAction, { type: 'USE_ABILITY' }>): number {
  return (action.goldRequire ?? 0) + (action.goldSpend ?? 0)
}

/**
 * Drop dominated gold payments and intermediate extra-energy amounts.
 * Keeps skips, end-turn, and finish actions.
 */
export function pruneActions(actions: GameAction[]): GameAction[] {
  if (actions.length <= 1) return actions

  const kept: GameAction[] = []
  const abilityGroups = new Map<string, Extract<GameAction, { type: 'USE_ABILITY' }>[]>()

  for (const action of actions) {
    if (action.type !== 'USE_ABILITY') {
      kept.push(action)
      continue
    }
    const key = abilityKey(action)
    const group = abilityGroups.get(key) ?? []
    group.push(action)
    abilityGroups.set(key, group)
  }

  for (const group of abilityGroups.values()) {
    const byExtra = new Map<number, Extract<GameAction, { type: 'USE_ABILITY' }>>()
    for (const action of group) {
      const extra = action.extraEnergy ?? 0
      const prev = byExtra.get(extra)
      if (!prev || goldCost(action) < goldCost(prev)) byExtra.set(extra, action)
    }
    const extras = [...byExtra.keys()].sort((a, b) => a - b)
    if (extras.length === 0) continue
    const pick = new Set<number>([extras[0], extras[extras.length - 1]])
    for (const extra of extras) {
      if (extra === 1 || extra === extras[extras.length - 1]) pick.add(extra)
    }
    for (const extra of pick) {
      const action = byExtra.get(extra)
      if (action) kept.push(action)
    }
  }

  return kept
}
