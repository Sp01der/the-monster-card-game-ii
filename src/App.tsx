import { useState } from 'react'
import { createGame, type DeckSetup, type GameState } from './game'
import { Board } from './ui/Board'
import { DeckBuilder } from './ui/DeckBuilder'
import './App.css'

export default function App() {
  const [game, setGame] = useState<GameState | null>(null)

  function start(p0: DeckSetup, p1: DeckSetup) {
    setGame(createGame(p0, p1))
  }

  if (!game) {
    return <DeckBuilder onStart={start} />
  }

  return (
    <Board state={game} onChange={setGame} onNewGame={() => setGame(null)} />
  )
}
