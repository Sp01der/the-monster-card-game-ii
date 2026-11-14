import { useCallback, useState } from 'react'
import { createGame, type DeckSetup, type GameState, type PlayerId } from './game'
import { Board } from './ui/Board'
import { DeckBuilder, type MatchStart } from './ui/DeckBuilder'
import { RulesCorner } from './ui/Rulebook'
import { useComputerOpponent } from './ui/useComputerOpponent'
import './App.css'

export default function App() {
  const [game, setGame] = useState<GameState | null>(null)
  const [computerPlayers, setComputerPlayers] = useState<PlayerId[]>([])
  const [decks, setDecks] = useState<DeckSetup[] | null>(null)

  const setGameSafe = useCallback(
    (next: GameState | ((current: GameState | null) => GameState | null)) => {
      setGame(next)
    },
    [],
  )

  const thinking = useComputerOpponent(
    game,
    setGameSafe,
    computerPlayers.length > 0 ? computerPlayers : null,
    decks,
  )

  function start(match: MatchStart) {
    setComputerPlayers(match.computerPlayers)
    setDecks(match.decks)
    setGame(
      match.decks.length === 2
        ? createGame(match.decks[0]!, match.decks[1]!)
        : createGame(match.decks),
    )
  }

  function newGame() {
    setGame(null)
    setComputerPlayers([])
    setDecks(null)
  }

  return (
    <>
      {game ? (
        <Board
          state={game}
          onChange={setGame}
          onNewGame={newGame}
          computerPlayers={computerPlayers}
          thinking={thinking}
        />
      ) : (
        <DeckBuilder onStart={start} />
      )}
      <RulesCorner />
    </>
  )
}
