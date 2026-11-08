import { useCallback, useState } from 'react'
import { createGame, type DeckSetup, type GameState, type PlayerId } from './game'
import { Board } from './ui/Board'
import { DeckBuilder, type MatchStart } from './ui/DeckBuilder'
import { useComputerOpponent } from './ui/useComputerOpponent'
import './App.css'

export default function App() {
  const [game, setGame] = useState<GameState | null>(null)
  const [computerPlayer, setComputerPlayer] = useState<PlayerId | null>(null)
  const [decks, setDecks] = useState<[DeckSetup, DeckSetup] | null>(null)

  const setGameSafe = useCallback(
    (next: GameState | ((current: GameState | null) => GameState | null)) => {
      setGame(next)
    },
    [],
  )

  const thinking = useComputerOpponent(game, setGameSafe, computerPlayer, decks)

  function start(match: MatchStart) {
    setComputerPlayer(match.computerPlayer)
    setDecks([match.player0, match.player1])
    setGame(createGame(match.player0, match.player1))
  }

  function newGame() {
    setGame(null)
    setComputerPlayer(null)
    setDecks(null)
  }

  if (!game) {
    return <DeckBuilder onStart={start} />
  }

  return (
    <Board
      state={game}
      onChange={setGame}
      onNewGame={newGame}
      computerPlayer={computerPlayer}
      thinking={thinking}
    />
  )
}
