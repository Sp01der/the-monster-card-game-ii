/// <reference lib="webworker" />
import type { DeckSetup } from '../setup'
import type { GameAction, GameState, PlayerId } from '../types'
import { createDieRng, createFloatRng } from './rng'
import { chooseAction } from './search'

export type AiWorkerRequest = {
  requestId: number
  state: Omit<GameState, 'rng' | 'random'>
  aiPlayer: PlayerId
  decks: DeckSetup[]
  seed: number
  timeBudgetMs?: number
  sampleCount?: number
}

export type AiWorkerResponse =
  | { requestId: number; action: GameAction }
  | { requestId: number; error: string }

const worker = self as unknown as DedicatedWorkerGlobalScope

worker.onmessage = (event: MessageEvent<AiWorkerRequest>) => {
  const { requestId, state, aiPlayer, decks, seed, timeBudgetMs, sampleCount } = event.data
  const full = {
    ...state,
    rng: createDieRng((seed ^ 0xa5a5a5a5) >>> 0),
    random: createFloatRng((seed ^ 0x5a5a5a5a) >>> 0),
  } as GameState

  try {
    const action = chooseAction(full, {
      aiPlayer,
      decks,
      seed,
      timeBudgetMs,
      sampleCount,
    })
    const response: AiWorkerResponse = { requestId, action }
    worker.postMessage(response)
  } catch (error) {
    const response: AiWorkerResponse = {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    }
    worker.postMessage(response)
  }
}
