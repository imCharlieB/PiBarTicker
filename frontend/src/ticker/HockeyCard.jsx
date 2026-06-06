import GameCard from './GameCard.jsx'

// Hockey-specific live mode (period, clock, power play, etc.) goes here.
// Delegates to GameCard until hockey-specific layouts are designed.
export default function HockeyCard(props) {
  return <GameCard {...props} />
}
