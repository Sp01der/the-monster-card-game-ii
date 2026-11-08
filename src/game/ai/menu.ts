import { listLegalActions } from '../actions'
import { applyAction } from '../reducer'
import type { GameAction, GameState, PlayerId } from '../types'
import { evaluate } from './eval'
import { mixSeed } from './rng'
import { withPrivateRng } from './belief'

export type ToggleMenu = {
  options: string[]
  selected: string[]
  /** Exact size required, if any (e.g. keystone needs 3). */
  exact?: number
  /** Maximum selected size. */
  max?: number
  toggle: (id: string) => GameAction
  finish: GameAction
  /** Optional cancel when the selection is incomplete. */
  cancel?: GameAction
}

/** Multi-select menus where toggles alone barely change the board score. */
export function getToggleMenu(state: GameState): ToggleMenu | null {
  const pending = state.pending
  if (!pending) return null

  if (pending.kind === 'bury') {
    const owner = state.players[pending.owner]
    return {
      options: owner.hand.map((card) => card.instanceId),
      selected: [...pending.chosenInstanceIds],
      toggle: (instanceId) => ({ type: 'BURY_TOGGLE', instanceId }),
      finish: { type: 'BURY_FINISH' },
    }
  }

  if (pending.kind === 'griefDestroy') {
    const owner = state.players[pending.owner]
    return {
      options: owner.discard.map((card) => card.instanceId),
      selected: [...pending.chosenInstanceIds],
      max: 2,
      toggle: (instanceId) => ({ type: 'GRIEF_TOGGLE', instanceId }),
      finish: { type: 'GRIEF_FINISH' },
    }
  }

  if (pending.kind === 'cloudDestroy') {
    const owner = state.players[pending.owner]
    return {
      options: owner.discard.map((card) => card.instanceId),
      selected: [...pending.chosenInstanceIds],
      toggle: (instanceId) => ({ type: 'CLOUD_TOGGLE', instanceId }),
      finish: { type: 'CLOUD_FINISH' },
    }
  }

  if (pending.kind === 'march') {
    const owner = state.players[pending.owner]
    const options: string[] = []
    for (let slot = 0; slot < owner.field.length; slot++) {
      if (owner.field[slot]) options.push(String(slot))
    }
    return {
      options,
      selected: pending.chosenSlots.map(String),
      toggle: (id) => ({ type: 'MARCH_TOGGLE', slot: Number(id) }),
      finish: { type: 'MARCH_FINISH' },
    }
  }

  if (pending.kind === 'keystone') {
    const owner = state.players[pending.owner]
    const attach = listLegalActions(state).find((action) => action.type === 'KEYSTONE_ATTACH')
    return {
      options: owner.hand.map((card) => card.instanceId),
      selected: [...pending.chosenInstanceIds],
      exact: 3,
      toggle: (instanceId) => ({ type: 'KEYSTONE_TOGGLE', instanceId }),
      finish: attach ?? { type: 'KEYSTONE_CANCEL' },
      cancel: { type: 'KEYSTONE_CANCEL' },
    }
  }

  if (pending.kind === 'riftEye' && pending.stage === 'discard') {
    return {
      options: pending.cards.map((card) => card.instanceId),
      selected: [...pending.discarded],
      toggle: (instanceId) => ({ type: 'RIFT_TOGGLE', instanceId }),
      finish: { type: 'RIFT_CONFIRM' },
    }
  }

  return null
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((id, i) => id === right[i])
}

/** Candidate selection sets to weigh for a toggle menu. */
export function candidateSets(menu: ToggleMenu): string[][] {
  const { options, exact, max } = menu
  const limit = max ?? options.length
  const sets: string[][] = []
  const push = (set: string[]) => {
    if (exact !== undefined && set.length !== exact) return
    if (set.length > limit) return
    if (sets.some((existing) => sameSet(existing, set))) return
    sets.push([...set].sort())
  }

  // High-impact sets first so a short budget still compares the strong lines.
  if (exact === undefined) push(options.slice(0, limit))

  if (options.length <= 8 && (exact === undefined || exact === 2)) {
    for (let i = 0; i < options.length; i++) {
      for (let j = i + 1; j < options.length; j++) {
        push([options[i], options[j]])
      }
    }
  }

  if (exact === 3 && options.length <= 10) {
    for (let i = 0; i < options.length; i++) {
      for (let j = i + 1; j < options.length; j++) {
        for (let k = j + 1; k < options.length; k++) {
          push([options[i], options[j], options[k]])
        }
      }
    }
  } else if (exact === 3) {
    for (let i = 0; i + 2 < options.length && sets.length < 20; i++) {
      push([options[i], options[i + 1], options[i + 2]])
    }
  }

  for (const id of options) push([id])
  push(menu.selected)
  if (exact === undefined) push([])

  if (sets.length === 0 && menu.cancel) return [[]]
  return sets
}

function safeApply(state: GameState, action: GameAction): GameState | null {
  try {
    if (!listLegalActions(state).some((a) => JSON.stringify(a) === JSON.stringify(action))) {
      return null
    }
    return applyAction(state, action)
  } catch {
    return null
  }
}

/** Drive the live selection toward `target`, or finish/cancel when it matches. */
export function stepTowardSet(menu: ToggleMenu, target: string[]): GameAction {
  const targetSet = new Set(target)
  const selectedSet = new Set(menu.selected)

  for (const id of menu.options) {
    const want = targetSet.has(id)
    const have = selectedSet.has(id)
    if (want !== have) return menu.toggle(id)
  }

  if (menu.exact !== undefined && menu.selected.length !== menu.exact) {
    return menu.cancel ?? menu.finish
  }
  return menu.finish
}

function applySet(state: GameState, _menu: ToggleMenu, target: string[]): GameState | null {
  let current = state
  const targetSet = new Set(target)

  // Drop anything not in the target set first (needed when a max cap blocks new toggles).
  for (;;) {
    const live = getToggleMenu(current)
    if (!live) return null
    const extra = live.selected.find((id) => !targetSet.has(id))
    if (!extra) break
    const next = safeApply(current, live.toggle(extra))
    if (!next) return null
    current = next
  }

  for (const id of target) {
    const live = getToggleMenu(current)
    if (!live) return null
    if (live.selected.includes(id)) continue
    const next = safeApply(current, live.toggle(id))
    if (!next) return null
    current = next
  }

  const ready = getToggleMenu(current)
  if (!ready) return null
  if (ready.exact !== undefined && ready.selected.length !== ready.exact) {
    if (!ready.cancel) return null
    return safeApply(current, ready.cancel)
  }
  // Keystone attach only appears once three cards are chosen.
  if (current.pending?.kind === 'keystone') {
    const attach = listLegalActions(current).find((action) => action.type === 'KEYSTONE_ATTACH')
    if (attach) return safeApply(current, attach)
    return ready.cancel ? safeApply(current, ready.cancel) : null
  }
  return safeApply(current, ready.finish)
}

export type MenuScoreContext = {
  seat: PlayerId
  seed: number
  deadline: number
  /** Continue after the menu resolves (targets, rest of turn, etc.). */
  continuePlay: (state: GameState, seed: number, deadline: number) => GameState
}

/** Pick the best selection set by simulating finish + continuation. */
export function bestToggleSet(
  state: GameState,
  menu: ToggleMenu,
  context: MenuScoreContext,
): string[] {
  let best = menu.selected
  let bestScore = -Infinity
  const sets = candidateSets(menu)

  for (let i = 0; i < sets.length; i++) {
    if (Date.now() >= context.deadline) break
    const target = sets[i]
    const probe = withPrivateRng(state, mixSeed(context.seed, i + 17))
    const finished = applySet(probe, menu, target)
    if (!finished) continue
    const continued = context.continuePlay(
      finished,
      mixSeed(context.seed, i + 91),
      context.deadline,
    )
    const score = evaluate(continued, context.seat)
    // Prefer more cards when Absorb-like menus convert buries into hits.
    const preferLonger =
      state.pending?.kind === 'bury' &&
      (state.pending.purpose === 'absorb' ||
        state.pending.purpose === 'hunt' ||
        state.pending.purpose === 'whirlpool' ||
        state.pending.purpose === 'churn')
    const better =
      score > bestScore ||
      (score === bestScore &&
        (preferLonger ? target.length > best.length : target.length < best.length))
    if (better) {
      bestScore = score
      best = target
    }
  }

  return best
}

/** One legal action that progresses the best weighed menu choice. */
export function chooseToggleMenuAction(
  state: GameState,
  context: MenuScoreContext,
): GameAction | null {
  const menu = getToggleMenu(state)
  if (!menu) return null
  const best = bestToggleSet(state, menu, context)
  return stepTowardSet(menu, best)
}

/**
 * Resolve toggle menus inside a simulation without returning intermediate toggles.
 * Returns the state after finish/cancel, or the original state if none.
 */
export function resolveToggleMenu(
  state: GameState,
  context: MenuScoreContext,
): GameState {
  const menu = getToggleMenu(state)
  if (!menu) return state
  const best = bestToggleSet(state, menu, context)
  return applySet(state, menu, best) ?? state
}
