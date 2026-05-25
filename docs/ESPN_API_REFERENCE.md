# ESPN API Reference Guide

## Quick Reference for PiBarTicker

### Base URLs
- **Site API v2**: `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/{resource}`
- **Site API v3**: `https://site.api.espn.com/apis/site/v3/sports/{sport}/{league}/{resource}`
- **Core API v2**: `https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/{resource}`
- **CDN API**: `https://cdn.espn.com/core/{sport}/{resource}?xhr=1`
- **Now API**: `https://now.core.api.espn.com/v1/sports/news`

## What We're Using

### Current Endpoints
```
GET https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard
GET https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard
```

### Response Format
- Returns all current/live games for that sport
- **No date filtering available** on scoreboard endpoint
- Returns ~7 days of games for NFL (current week)
- Returns ~1 day of games for MLB (today + tomorrow)

## Key Resources

### Scoreboard
**Resource**: `/scoreboard`
- Live & scheduled events with scores
- Period/inning scores
- Broadcast info
- Venue info
- Status (pre, in, post)

### Teams
**Resource**: `/teams`
- All teams in league
- Logos, colors, abbreviations
- Home/away info

**Resource**: `/teams/{id}/roster`
- Team roster data

### Standings
⚠️ Use `/apis/v2/` NOT `/apis/site/v2/`
```
https://sports.core.api.espn.com/v2/sports/baseball/mlb/standings
```

### News
**Resource**: `/news`
- Latest articles
- Or use Now API: `https://now.core.api.espn.com/v1/sports/news`

### Injuries
**Resource**: `/injuries`
- League-wide injury reports

### Calendar
**Resource**: `/calendar`
- Season calendar (weeks/dates)
- `/calendar/offseason` - off-season dates
- `/calendar/regular-season` - regular season weeks
- `/calendar/postseason` - postseason dates

## League Slugs (for config.json)

### Football
- `nfl` - NFL
- `college-football` - College Football

### Baseball
- `mlb` - MLB
- `college-baseball` - NCAA Baseball

### Basketball
- `nba` - NBA
- `wnba` - WNBA
- `mens-college-basketball` - NCAA Men's

### Hockey
- `nhl` - NHL

### Soccer
- `usa.1` - MLS
- `eng.1` - English Premier League
- `esp.1` - Spanish LALIGA
- `ger.1` - German Bundesliga
- `ita.1` - Italian Serie A
- `fra.1` - French Ligue 1

## Query Parameters

### Common Parameters
| Parameter | Description | Example |
|-----------|-------------|---------|
| `dates` | Filter by date | `20241215` or `20241201-20241231` |
| `week` | Week number | `1` through `18` |
| `seasontype` | Season type | `1=preseason, 2=regular, 3=postseason` |
| `limit` | Results limit | `100`, `1000` |
| `enable` | Inline-expand | `roster`, `stats`, `injuries` |
| `lang` | Language | `en`, `es`, `pt` |

### Season Types
- `1` - Preseason
- `2` - Regular Season
- `3` - Postseason
- `4` - Off Season

## Game Status Values

From competition status:
- `pre` - Pre-game
- `in` - In Progress
- `post` - Final/Post-game

## Response Structure

### Event/Game Object
```json
{
  "id": "123456789",
  "date": "2024-05-18T20:00Z",
  "status": {
    "type": {
      "id": "1",
      "name": "pre",
      "state": "pre",
      "short": "Pre"
    },
    "period": 0,
    "displayClock": "0:00"
  },
  "competitions": [
    {
      "id": "123456789",
      "status": { /* same as above */ },
      "competitors": [
        {
          "homeAway": "home",
          "team": {
            "id": "25",
            "abbreviation": "NYY",
            "displayName": "New York Yankees",
            "logo": "url"
          },
          "score": "5"
        },
        {
          "homeAway": "away",
          "team": { /* ... */ },
          "score": "3"
        }
      ],
      "broadcasts": [
        {
          "names": ["ESPN+"]
        }
      ],
      "venue": {
        "fullName": "Yankee Stadium"
      },
      "linescores": [ /* MLB only */ ],
      "odds": [ /* if available */ ]
    }
  ]
}
```

## Tips for Filtering

### Client-Side vs API
- ESPN scoreboard returns ~7 days (NFL) or ~1 day (MLB) automatically
- **Don't use `dates` parameter** - it doesn't work on /scoreboard
- Filter games client-side by checking `status.type.state`

### Filter Strategies
```javascript
// All games from API
const allGames = events;

// Only unfinished games
const upcoming = events.filter(e => e.status.type.state !== 'post');

// Only live games
const live = events.filter(e => e.status.type.state === 'in');

// Only today's games
const today = events.filter(e => {
  const gameDate = new Date(e.date);
  const gameDay = gameDate.toDateString();
  const todayDay = new Date().toDateString();
  return gameDay === todayDay;
});
```

## Useful Additional Endpoints

### Get a Specific Game Summary
```
GET https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event={eventId}
```
Returns full game detail including play-by-play

### Betting Odds (if available)
```
GET https://sports.core.api.espn.com/v2/sports/baseball/mlb/events/{eventId}/competitions/{compId}/odds
```

### Stadium/Venue Info
```
GET https://sports.core.api.espn.com/v2/sports/baseball/mlb/venues
```

## Error Codes
- `400` - Bad request (bad parameters)
- `404` - Not found
- `429` - Rate limited
- `500` - Server error

## Rate Limiting
ESPN doesn't publicly advertise limits, but observed:
- ~10-20 requests/second seems safe
- Add 1-2 second delays between different league requests
- Cache responses when possible

