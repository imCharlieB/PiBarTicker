import GameCard from './GameCard.jsx'

// Basketball-specific live mode (quarter, clock, shot clock, etc.) goes here.
// Delegates to GameCard until basketball-specific layouts are designed.
export default function BasketballCard(props) {
  return <GameCard {...props} />
}
