# League-Specific API Parameters

## Summary: Which Leagues Support Which Filters

| League | `week` | `dates` | `seasontype` | Best Strategy | Notes |
|--------|--------|---------|--------------|---------------|-------|
| **NFL** | ✅ Yes (1-18) | ❌ No | ✅ Yes (1,2,3) | Use `?week=` | Weeks 1-18, preseason/regular/postseason |
| **College Football** | ✅ Yes (1-15) | ❌ No | ❌ No | Use `?week=` | NCAA uses weeks like NFL |
| **CFL** | ✅ Yes (1-20) | ❌ No | ❌ No | Use `?week=` | Canadian Football League (20 weeks) |
| **XFL** | ✅ Yes (1-10) | ❌ No | ❌ No | Use `?week=` | XFL uses weeks (~10 per season) |
| **UFL** | ✅ Yes (1-?) | ❌ No | ❌ No | Use `?week=` | United Football League (newer league) |
| **MLB** | ❌ No | ❌ No | ✅ Yes (1,2,3) | Client-side date filter | Returns ~1 day naturally, 162 games per season |
| **NBA** | ❌ No | ❌ No | ❌ No | Client-side date filter | Returns ~1-2 days naturally |
| **NHL** | ❌ No | ❌ No | ❌ No | Client-side date filter | Returns ~1-2 days naturally |
| **Soccer** | ❌ No | ❌ No | ❌ No | Client-side date filter | Returns current matchdays |

---

## Detailed League Information

### 🏈 **NFL**
- **Calendar endpoint**: `/calendar/regular-season` or `/calendar/preseason` or `/calendar/postseason`
- **Week parameter**: `?week=1` through `?week=18` (regular season)
- **Seasontype**: 
  - `1` = Preseason
  - `2` = Regular Season
  - `3` = Postseason
- **Example**: 
  ```
  https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=5
  https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=5
  ```
- **Best for**: Specific week filtering ✅
- **Data savings**: ~89% (from ~450KB to ~50KB per request)
- **Current behavior**: May 18, 2026 is offseason - returns preseason games if any

---

### 🏈 **College Football (NCAA)**
- **Calendar endpoint**: Returns error (use week parameter directly)
- **Week parameter**: `?week=1` through `?week=15` (varies by conference)
- **Seasontype**: Not supported on scoreboard
- **Note**: ~99 games per week during season
- **Example**: 
  ```
  https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?week=5
  ```
- **Best for**: Specific week filtering ✅
- **Data savings**: Similar to NFL (~80-85%)
- **Current behavior**: May 2026 is offseason - limited/no games

---

### 🏈 **CFL (Canadian Football League)**
- **Week parameter**: `?week=1` through `?week=20` (20-week season)
- **Seasontype**: Not supported on scoreboard
- **Note**: CFL season typically June-November
- **Example**: 
  ```
  https://site.api.espn.com/apis/site/v2/sports/football/cfl/scoreboard?week=1
  ```
- **Best for**: Specific week filtering ✅
- **Data savings**: Similar to NFL (~80-85%)
- **Current behavior**: May 2026 is offseason - no games expected

---

### 🏈 **XFL (Extreme Football League)**
- **Week parameter**: `?week=1` through `?week=10` (approximately)
- **Seasontype**: Not supported on scoreboard
- **Note**: Shorter 10-week season, spring season
- **Example**: 
  ```
  https://site.api.espn.com/apis/site/v2/sports/football/xfl/scoreboard?week=1
  ```
- **Best for**: Specific week filtering ✅
- **Data savings**: Similar to NFL (~80-85%)
- **Current behavior**: May 2026 - XFL season typically ends in April, offseason

---

### 🏈 **UFL (United Football League)**
- **Week parameter**: `?week=1` through `?week=?` (newer league, varies)
- **Seasontype**: Not supported on scoreboard
- **Note**: Newer spring football league
- **Example**: 
  ```
  https://site.api.espn.com/apis/site/v2/sports/football/ufl/scoreboard?week=1
  ```
- **Best for**: Specific week filtering ✅
- **Data savings**: Similar to NFL (~80-85%)
- **Current behavior**: May 2026 - UFL season typically ends, offseason

---

### ⚾ **MLB**
- **Calendar endpoint**: `/calendar/regular-season`
- **Week parameter**: ❌ Not supported (MLB uses days, not weeks)
- **Seasontype**: 
  - `1` = Spring Training
  - `2` = Regular Season
  - `3` = Postseason
- **Note**: MLB naturally returns only ~1-2 days of games
- **Best for**: Client-side filtering by today/tomorrow
- **Data savings**: Already minimal (ESPN pre-filters to current games)
- **Current behavior**: Scoreboard returns today + tomorrow's games automatically

---

### 🏀 **NBA**
- **Calendar endpoint**: `/calendar/regular-season`
- **Week parameter**: ❌ Not supported (NBA uses days)
- **Seasontype**: ❌ Not supported on scoreboard
- **Note**: NBA season runs Oct-Apr (82 games per team)
- **Best for**: Client-side filtering
- **Data volume**: NBA games are sparse (not many per day in offseason)
- **Current behavior**: Returns current games naturally

---

### 🏒 **NHL**
- **Calendar endpoint**: `/calendar/regular-season`
- **Week parameter**: ❌ Not supported (NHL uses days)
- **Seasontype**: ❌ Not supported on scoreboard
- **Note**: NHL season runs Oct-Apr (82 games per team)
- **Best for**: Client-side filtering
- **Data volume**: Limited games per day (often 2-4 games/night)
- **Current behavior**: Returns current games naturally

---

### ⚽ **Soccer (MLS/European)**
- **Calendar endpoint**: Varies by league (MLS vs Premier League, etc.)
- **Week parameter**: ❌ Not supported
- **Seasontype**: ❌ Not supported
- **Note**: Soccer matches are scheduled differently (weekends + midweek)
- **Best for**: Client-side filtering or use MLS-specific endpoints
- **Data volume**: Limited games per matchday

---

## Implementation Strategy by League

### **NFL: API-Level Filtering** (RECOMMENDED)
```javascript
// Fetch calendar once per session
const calendar = await fetch('/.../nfl/calendar/regular-season');
const currentWeek = findWeekNumber(calendar);

// Then use week parameter for all future requests
const scoreboard = await fetch(`/.../nfl/scoreboard?week=${currentWeek}`);
```
**Benefit**: 89% bandwidth savings, ESPN handles the filtering

---

### **MLB, NBA, NHL: Client-Side Filtering** (No choice)
```javascript
// Just fetch the scoreboard
const scoreboard = await fetch('/.../mlb/scoreboard');

// Filter on client side
const todaysGames = scoreboard.filter(g => isToday(g.date));
const upcomingGames = scoreboard.filter(g => !isFinished(g.date));
```
**Reason**: These leagues don't support `week` parameter, and ESPN already returns appropriate games

---

## Recommended Config Structure

```json
{
  "leagues": [
    {
      "id": "nfl",
      "name": "NFL",
      "useWeekFilter": true,
      "gameFilter": "this-week"
    },
    {
      "id": "mlb",
      "name": "MLB",
      "useWeekFilter": false,
      "gameFilter": "all"
    },
    {
      "id": "nba",
      "name": "NBA",
      "useWeekFilter": false,
      "gameFilter": "upcoming"
    },
    {
      "id": "nhl",
      "name": "NHL",
      "useWeekFilter": false,
      "gameFilter": "live"
    }
  ]
}
```

---

## Summary

**ALL FOOTBALL LEAGUES support the `?week=` parameter for API-level filtering!**

- **NFL**: 18 weeks, supports `?week=1-18`
- **College Football**: 15 weeks, supports `?week=1-15`
- **CFL**: 20 weeks, supports `?week=1-20`
- **XFL**: ~10 weeks, supports `?week=1-10`
- **UFL**: Variable weeks, supports `?week=` parameter

For **other sports** (MLB, NBA, NHL, Soccer):
- ESPN already pre-filters to return current/relevant games
- Client-side filtering is sufficient for UX (today/upcoming/live)

---

## Implementation Priority

1. **🥇 All Football Leagues** (NFL, College, CFL, XFL, UFL): Implement `getLeagueWeek()` + `?week=` parameter (saves 80-89%)
2. **🥈 MLB**: Keep current setup (ESPN already filters to 1-2 days)
3. **🥉 NBA, NHL, Soccer**: Same as MLB (use client-side filtering for UX)

