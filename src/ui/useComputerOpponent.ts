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

function asSeatSet(computerPlayers: PlayerId | PlayerId[] | null): Set<PlayerId> {
  if (computerPlayers === null) return new Set()
  if (Array.isArray(computerPlayers)) return new Set(computerPlayers)
  return new Set([computerPlayers])
}

/**
 * Drives computer seats: auto-handoff for those seats, paced search, stale-result guard.
 * Pass one PlayerId for the classic two-player computer match, or an array for free-for-all.
 */
export function useComputerOpponent(
  game: GameState | null,
  setGame: (next: GameState | ((current: GameState | null) => GameState | null)) => void,
  computerPlayers: PlayerId | PlayerId[] | null,
  decks: DeckSetup[] | null,
): boolean {
  const [thinking, setThinking] = useState(false)
  const requestIdRef = useRef(0)
  const workerRef = useRef<Worker | null>(null)
  const seedRef = useRef((Math.random() * 0xffffffff) >>> 0)
  const seats = asSeatSet(computerPlayers)
  const seatKey = [...seats].sort().join(',')

  useEffect(() => {
    if (seats.size === 0) return
    const worker = new Worker(new URL('../game/ai/ai.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker
    return () => {
      worker.terminate()
      workerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recreate when the seat set changes
  }, [seatKey])

  // Two-player vs one computer: keep skipping every handoff cover.
  // Free-for-all: only skip when the seat receiving the device is a computer.
  useEffect(() => {
    if (!game || seats.size === 0) return
    if (!game.awaitingHandoff) return
    const twoPlayerHotseatAi = game.players.length === 2 && seats.size === 1
    if (!twoPlayerHotseatAi && !seats.has(game.activePlayer)) return
    setGame((current) => {
      if (!current?.awaitingHandoff) return current
      return applyAction(current, { type: 'CONFIRM_HANDOFF' })
    })
  }, [game, seatKey, setGame, seats])

  useEffect(() => {
    if (!game || seats.size === 0 || !decks) {
      setThinking(false)
      return
    }
    if (game.winner !== null) {
      setThinking(false)
      return
    }
    if (game.awaitingHandoff) return
    const chooser = decisionPlayer(game)
    if (!seats.has(chooser)) {
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
        aiPlayer: chooser,
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
        if (!current || decisionPlayer(current) !== chooser) return current
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
  }, [game, seatKey, decks, setGame, seats])

  return thinking
}
