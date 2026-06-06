import GameCard from './GameCard.jsx'

// Football-specific live mode (down, distance, yard line, clock, etc.) goes here.
// Delegates to GameCard until football-specific layouts are designed.
export default function FootballCard(props) {
  return <GameCard {...props} />
}
