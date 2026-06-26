import { useState } from 'react'
import { useAppContext } from '../AppContext'
import LeagueList from './ticker/LeagueList'
import LeagueDetail from './ticker/LeagueDetail'
import TeamDetail from './ticker/TeamDetail'
import DriverDetail from './ticker/DriverDetail'
import HADetail from './ticker/HADetail'

export default function TickerPage() {
  const { config, leagueTeamsById, leagueLoadStateById } = useAppContext()
  const [selectedTickerLeagueId, setSelectedTickerLeagueId] = useState('')
  const [selectedTickerTeamId, setSelectedTickerTeamId] = useState('')
  const [selectedDriver, setSelectedDriver] = useState(null)
  const [showHADetail, setShowHADetail] = useState(false)

  const sportsBoard = config.boards.find((b) => b.type === 'sports')

  if (!sportsBoard) {
    return (
      <article className="card page-card">
        <p>No sports board found in config.</p>
      </article>
    )
  }

  const selectedTickerLeague = sportsBoard.leagues.find((l) => l.id === selectedTickerLeagueId) || null
  const selectedTickerLeagueIndex = sportsBoard.leagues.findIndex((l) => l.id === selectedTickerLeagueId)
  const selectedLeagueTeams = selectedTickerLeague ? leagueTeamsById[selectedTickerLeague.id] || [] : []
  const selectedLeagueLoadState = selectedTickerLeague
    ? leagueLoadStateById[selectedTickerLeague.id] || { loading: false, error: '' }
    : { loading: false, error: '' }
  const selectedTickerTeam = selectedLeagueTeams.find((t) => t.id === selectedTickerTeamId) || null

  return (
    <article className="card page-card">
      {showHADetail ? (
        <HADetail onBack={() => setShowHADetail(false)} />
      ) : !selectedTickerLeague ? (
        <LeagueList
          sportsBoard={sportsBoard}
          onSelectLeague={(id) => {
            setSelectedTickerLeagueId(id)
            setSelectedTickerTeamId('')
            setSelectedDriver(null)
          }}
          onSelectHA={() => setShowHADetail(true)}
        />
      ) : selectedDriver ? (
        <DriverDetail
          selectedTickerLeague={selectedTickerLeague}
          driver={selectedDriver}
          onBack={() => setSelectedDriver(null)}
        />
      ) : !selectedTickerTeam ? (
        <LeagueDetail
          selectedTickerLeague={selectedTickerLeague}
          selectedTickerLeagueIndex={selectedTickerLeagueIndex}
          selectedLeagueTeams={selectedLeagueTeams}
          selectedLeagueLoadState={selectedLeagueLoadState}
          onBack={() => setSelectedTickerLeagueId('')}
          onSelectTeam={(id) => setSelectedTickerTeamId(id)}
          onSelectDriver={setSelectedDriver}
        />
      ) : (
        <TeamDetail
          selectedTickerLeague={selectedTickerLeague}
          selectedTickerTeam={selectedTickerTeam}
          onBack={() => setSelectedTickerTeamId('')}
          onSelectDriver={setSelectedDriver}
        />
      )}
    </article>
  )
}
