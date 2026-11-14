import { listLegalActions } from '../actions'
import { isTwoPlayer, nextLivingPlayerId } from '../helpers'
import { applyAction } from '../reducer'
import type { GameAction, GameState, PlayerId } from '../types'
import { applyBelief, type DeckLists, withPrivateRng } from './belief'
import { decisionPlayer } from './decision'
import { evaluate } from './eval'
import {
  chooseToggleMenuAction,
  getToggleMenu,
  resolveToggleMenu,
} from './menu'
import { pruneActions } from './prune'
import { mixSeed } from './rng'

export type ChooseOptions = {
  aiPlayer: PlayerId
  decks: DeckLists
  /** Deterministic search seed. */
  seed: number
  /** Wall-clock budget in ms. */
  timeBudgetMs?: number
  /** Belief samples for a main-phase root. */
  sampleCount?: number
}

const MAIN_BUDGET_MS = 1000
const PROMPT_BUDGET_MS = 450
const MENU_BUDGET_MS = 700
const MAX_GREEDY_STEPS = 80
const MAX_CANDIDATES = 28

function isMainRoot(state: GameState): boolean {
  return !state.pending && !state.awaitingHandoff && state.phase === 'main'
}

function findCard(state: GameState, instanceId: string): { defId: string } | null {
  for (const player of state.players) {
    for (const zone of [player.hand, player.deck, player.discard, player.removed]) {
      const card = zone.find((c) => c.instanceId === instanceId)
      if (card) return card
    }
    for (const entry of player.ethereal ?? []) {
      if (entry.card.instanceId === instanceId) return entry.card
    }
    for (const monster of player.field) {
      if (!monster) continue
      if (monster.instanceId === instanceId) return monster
      const equipment = monster.equipment.find((e) => e.instanceId === instanceId)
      if (equipment) return equipment
    }
  }
  return null
}

function mapActionToBelief(real: GameAction, belief: GameState, realState: GameState): GameAction | null {
  const legal = listLegalActions(belief)
  if (legal.some((a) => JSON.stringify(a) === JSON.stringify(real))) return real

  if (
    real.type === 'SPY_MARK' ||
    real.type === 'DISCARD_FROM_HAND' ||
    real.type === 'MIRROR_PICK' ||
    real.type === 'BURY_TOGGLE' ||
    real.type === 'GRIEF_TOGGLE' ||
    real.type === 'CLOUD_TOGGLE' ||
    real.type === 'KEYSTONE_TOGGLE' ||
    real.type === 'RIFT_TOGGLE' ||
    real.type === 'RIFT_ORDER' ||
    real.type === 'ELDERS_PICK' ||
    real.type === 'HAUNTED_PICK' ||
    real.type === 'CATACOMB_PICK' ||
    real.type === 'PICK_DISCARD' ||
    real.type === 'TRANSMUTE_DESTROY' ||
    real.type === 'TRANSMUTE_FETCH' ||
    real.type === 'REWIND_DISCARD'
  ) {
    const realCard = findCard(realState, real.instanceId)
    if (realCard) {
      const byDef = legal.find((a) => {
        if (a.type !== real.type) return false
        if (!('instanceId' in a)) return false
        const card = findCard(belief, a.instanceId)
        return card?.defId === realCard.defId
      })
      if (byDef) return byDef
    }
    return legal.find((a) => a.type === real.type) ?? null
  }

  return null
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

function menuContext(
  seat: PlayerId,
  seed: number,
  deadline: number,
): Parameters<typeof resolveToggleMenu>[1] {
  return {
    seat,
    seed,
    deadline,
    // Only clear the prompt chain when weighing sets — full-turn sims starve the comparison.
    continuePlay: (state, continueSeed, continueDeadline) =>
      resolveSeatPendings(state, seat, continueSeed, continueDeadline, 24),
  }
}

/**
 * Resolve only the current seat's pending prompts (targets, menus, offers).
 * Used when weighing menu sets so we do not burn the budget on a full turn.
 */
function resolveSeatPendings(
  state: GameState,
  seat: PlayerId,
  seed: number,
  deadline: number,
  stepsLeft: number,
): GameState {
  let current = state
  let step = 0
  while (step < stepsLeft && Date.now() < deadline) {
    if (current.winner !== null) return current
    if (!current.pending) return current
    if (decisionPlayer(current) !== seat) return current

    if (getToggleMenu(current)) {
      const resolved = resolveToggleMenu(
        current,
        {
          seat,
          seed: mixSeed(seed, step + 3),
          deadline,
          continuePlay: (next, continueSeed, continueDeadline) =>
            resolveSeatPendings(next, seat, continueSeed, continueDeadline, stepsLeft - step - 1),
        },
      )
      if (resolved === current) return current
      current = resolved
      step++
      continue
    }

    const actions = pruneActions(listLegalActions(current))
    if (actions.length === 0) return current
    let best: GameAction | null = actions[0]
    let bestScore = -Infinity
    for (let i = 0; i < Math.min(actions.length, MAX_CANDIDATES); i++) {
      if (Date.now() >= deadline) break
      const action = actions[i]
      const probe = withPrivateRng(current, mixSeed(seed, step * 1000 + i))
      const next = safeApply(probe, action)
      if (!next) continue
      const score = evaluate(next, seat)
      if (score > bestScore) {
        bestScore = score
        best = action
      }
    }
    if (!best) return current
    const applied = safeApply(current, best)
    if (!applied) return current
    current = applied
    step++
  }
  return current
}

/**
 * Greedy continuation until the seat no longer decides.
 * Toggle menus are resolved by weighing complete selections, not single toggles.
 */
function greedyPlay(
  state: GameState,
  seat: PlayerId,
  seed: number,
  deadline: number,
  stepsLeft: number,
  resolveMenusInPlace = false,
): GameState {
  let current = state
  let step = 0
  while (step < stepsLeft && Date.now() < deadline) {
    if (current.winner !== null) return current
    if (decisionPlayer(current) !== seat) return current

    if (getToggleMenu(current)) {
      if (resolveMenusInPlace) {
        const resolved = resolveToggleMenu(
          current,
          menuContext(seat, mixSeed(seed, step + 3), deadline),
        )
        if (resolved === current) return current
        current = resolved
        step++
        continue
      }
      const action = chooseToggleMenuAction(
        current,
        menuContext(seat, mixSeed(seed, step + 3), deadline),
      )
      if (!action) return current
      const next = safeApply(current, action)
      if (!next) return current
      current = next
      step++
      continue
    }

    const actions = pruneActions(listLegalActions(current))
    if (actions.length === 0) return current
    if (actions.length === 1) {
      const next = safeApply(current, actions[0])
      if (!next) return current
      current = next
      step++
      continue
    }

    let best: GameAction | null = null
    let bestScore = -Infinity
    const ordered = orderByStatic(current, seat, actions, mixSeed(seed, step), deadline)
    for (let i = 0; i < ordered.length; i++) {
      if (Date.now() >= deadline) break
      const action = ordered[i]
      const probe = withPrivateRng(current, mixSeed(seed, step * 1000 + i))
      const next = safeApply(probe, action)
      if (!next) continue
      // If this opens a toggle menu, weigh the finished menu line.
      const continued = getToggleMenu(next)
        ? resolveToggleMenu(next, menuContext(seat, mixSeed(seed, step * 1000 + i + 7), deadline))
        : next
      const score = evaluate(continued, seat)
      if (score > bestScore) {
        bestScore = score
        best = action
      }
    }
    if (!best) return current
    const applied = safeApply(current, best)
    if (!applied) return current
    current = applied
    step++
  }
  return current
}

function orderByStatic(
  state: GameState,
  seat: PlayerId,
  actions: GameAction[],
  seed: number,
  deadline: number,
): GameAction[] {
  const scored = actions.map((action, index) => {
    const probe = withPrivateRng(state, mixSeed(seed, index + 1))
    const next = safeApply(probe, action)
    if (!next) return { action, score: -Infinity }
    const continued = getToggleMenu(next)
      ? resolveToggleMenu(next, menuContext(seat, mixSeed(seed, index + 41), deadline))
      : next
    return { action, score: evaluate(continued, seat) }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.map((entry) => entry.action)
}

function scoreRootAction(
  belief: GameState,
  action: GameAction,
  seat: PlayerId,
  seed: number,
  deadline: number,
): number {
  const mapped = mapActionToBelief(action, belief, belief) ?? action
  const after = safeApply(withPrivateRng(belief, seed), mapped)
  if (!after) return -Infinity
  if (after.winner === seat) return 1_000_000
  if (after.winner !== null) return -1_000_000

  let sim = greedyPlay(after, seat, mixSeed(seed, 11), deadline, MAX_GREEDY_STEPS, true)
  if (sim.winner !== null) return evaluate(sim, seat)

  const foe = isTwoPlayer(sim)
    ? ((1 - seat) as PlayerId)
    : nextLivingPlayerId(sim, seat)
  if (decisionPlayer(sim) === foe || sim.activePlayer === foe) {
    sim = greedyPlay(sim, foe, mixSeed(seed, 29), deadline, MAX_GREEDY_STEPS, true)
  }

  return evaluate(sim, seat)
}

/**
 * Choose the next fair action for the AI seat.
 * Never reads live dice; belief sampling hides unseen cards.
 */
export function chooseAction(state: GameState, options: ChooseOptions): GameAction {
  const seat = options.aiPlayer
  if (decisionPlayer(state) !== seat) {
    throw new Error('chooseAction called when it is not the AI seat deciding')
  }

  const legal = listLegalActions(state)
  if (legal.length === 0) throw new Error('No legal actions')
  if (legal.length === 1) return legal[0]

  // Weigh complete menu selections (Absorb bury, Grief, March, etc.).
  if (getToggleMenu(state)) {
    const budget = options.timeBudgetMs ?? MENU_BUDGET_MS
    const action = chooseToggleMenuAction(
      state,
      menuContext(seat, options.seed, Date.now() + budget),
    )
    if (action) return action
  }

  const main = isMainRoot(state)
  const budget = options.timeBudgetMs ?? (main ? MAIN_BUDGET_MS : PROMPT_BUDGET_MS)
  const samples = options.sampleCount ?? (main ? 8 : 3)
  const deadline = Date.now() + budget
  const candidates = pruneActions(legal)
  const ordered = orderByStatic(
    applyBelief(state, seat, options.decks, mixSeed(options.seed, 7)),
    seat,
    candidates,
    options.seed,
    deadline,
  ).slice(0, MAX_CANDIDATES)

  const totals = new Map<string, { action: GameAction; score: number; n: number }>()
  for (const action of ordered) {
    totals.set(JSON.stringify(action), { action, score: 0, n: 0 })
  }

  let bestAction = ordered[0]
  let bestAvg = -Infinity

  for (let sample = 0; sample < samples; sample++) {
    if (sample > 0 && Date.now() >= deadline) break
    const belief = applyBelief(state, seat, options.decks, mixSeed(options.seed, sample + 1))
    for (let i = 0; i < ordered.length; i++) {
      if (sample > 0 && Date.now() >= deadline) break
      const action = ordered[i]
      const key = JSON.stringify(action)
      const score = scoreRootAction(
        belief,
        action,
        seat,
        mixSeed(options.seed, sample * 1000 + i + 3),
        sample === 0 ? deadline + 60_000 : deadline,
      )
      const entry = totals.get(key)!
      entry.score += score
      entry.n += 1
      const avg = entry.score / entry.n
      if (avg > bestAvg || (avg === bestAvg && key < JSON.stringify(bestAction))) {
        bestAvg = avg
        bestAction = entry.action
      }
    }
  }

  return bestAction
}
