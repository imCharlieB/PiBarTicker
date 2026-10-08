// Logo candidates for a league in news: a hand-placed file wins (logos/leagues/{leagueId}.png — drop one in and it is used,
// no config), then whatever the shared resolver found (config logo / NASCAR series logo / ESPN scoreboard logo).
export function newsLogoCandidates(leagueId, resolvedUrl) {
  const id = String(leagueId || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')
  return [id ? `/logos/leagues/${id}.png` : '', String(resolvedUrl || '').trim()].filter(Boolean)
}
