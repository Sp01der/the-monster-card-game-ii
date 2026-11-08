import { useEffect, useRef, useState } from 'react'
import {
  applyAction,
  decisionPlayer,
  type DeckSetup,
  type GameAction,
  type GameState,
  type PlayerId,
} from '../game'
import type { AiWorkerRequest, AiWorkerResponse } from '../game/ai/ai.worker'

const PACE_MS = 450

function stripRng(state: GameState): Omit<GameState, 'rng' | 'random'> {
  const { rng: _rng, random: _random, ...rest } = state
  return rest
}

/**
 * Drives the computer seat: auto-handoff, paced search, stale-result guard for Strict Mode.
 */
export function useComputerOpponent(
  game: GameState | null,
  setGame: (next: GameState | ((current: GameState | null) => GameState | null)) => void,
  computerPlayer: PlayerId | null,
  decks: [DeckSetup, DeckSetup] | null,
): boolean {
  const [thinking, setThinking] = useState(false)
  const requestIdRef = useRef(0)
  const workerRef = useRef<Worker | null>(null)
  const seedRef = useRef((Math.random() * 0xffffffff) >>> 0)

  useEffect(() => {
    if (computerPlayer === null) return
    const worker = new Worker(new URL('../game/ai/ai.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker
    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [computerPlayer])

  // Skip pass-the-device covers in computer matches.
  useEffect(() => {
    if (!game || computerPlayer === null) return
    if (!game.awaitingHandoff) return
    setGame((current) => {
      if (!current?.awaitingHandoff) return current
      return applyAction(current, { type: 'CONFIRM_HANDOFF' })
    })
  }, [game, computerPlayer, setGame])

  useEffect(() => {
    if (!game || computerPlayer === null || !decks) {
      setThinking(false)
      return
    }
    if (game.winner !== null) {
      setThinking(false)
      return
    }
    if (game.awaitingHandoff) return
    if (decisionPlayer(game) !== computerPlayer) {
      setThinking(false)
      return
    }

    const worker = workerRef.current
    if (!worker) return

    const requestId = ++requestIdRef.current
    setThinking(true)
    let cancelled = false

    const pace = window.setTimeout(() => {
      if (cancelled) return
      seedRef.current = (seedRef.current + 0x9e3779b9) >>> 0
      const payload: AiWorkerRequest = {
        requestId,
        state: stripRng(game),
        aiPlayer: computerPlayer,
        decks,
        seed: seedRef.current,
      }
      worker.postMessage(payload)
    }, PACE_MS)

    const onMessage = (event: MessageEvent<AiWorkerResponse>) => {
      if (cancelled || event.data.requestId !== requestIdRef.current) return
      if ('error' in event.data) {
        console.error('Computer opponent failed:', event.data.error)
        setThinking(false)
        return
      }
      const action: GameAction = event.data.action
      setGame((current) => {
        if (!current || decisionPlayer(current) !== computerPlayer) return current
        try {
          return applyAction(current, action)
        } catch (error) {
          console.error('Computer played an illegal action', action, error)
          return current
        }
      })
      setThinking(false)
    }

    worker.addEventListener('message', onMessage)
    return () => {
      cancelled = true
      window.clearTimeout(pace)
      worker.removeEventListener('message', onMessage)
    }
  }, [game, computerPlayer, decks, setGame])

  return thinking
}
