# EV Betting API Documentation

A FastAPI application that provides endpoints for retrieving Expected Value (EV) betting opportunities from a PostgreSQL database.

## Features

- Get active EV bets with multiple filtering options
- Filter by bookmaker (PrizePicks or Underdog)
- Filter by sport, player, market, and EV percentage
- Get betting statistics
- View available bookmakers and markets
- CORS-enabled for frontend integration
- Interactive API documentation (Swagger UI)

## Installation

1. Install the required dependencies:
```bash
pip install -r requirements.txt
```

2. Make sure your `.env` file contains the `DATABASE_URL`:
```
DATABASE_URL=postgresql://user:password@host:port/database
```

## Running the API

### Development Mode (with auto-reload)
```bash
python api.py
```

Or using uvicorn directly:
```bash
uvicorn api:app --reload --host 0.0.0.0 --port 8000
```

### Production Mode
```bash
uvicorn api:app --host 0.0.0.0 --port 8000 --workers 4
```

The API will be available at `http://localhost:8000`

## API Endpoints

### Root
- **GET** `/`
  - Returns API information and available endpoints

### Health Check
- **GET** `/health`
  - Check API and database connectivity
  - Response: `{"status": "healthy", "database": "connected"}`

### Get Active Bets
- **GET** `/bets`
  - Get active EV bets with optional filtering
  
  **Query Parameters:**
  - `bookmaker` (optional): Filter by bookmaker (`prizepicks` or `underdog`)
  - `sport` (optional): Filter by sport (e.g., `NFL`, `NBA`)
  - `min_ev` (optional): Minimum EV percentage (e.g., `5.0` for 5%)
  - `max_ev` (optional): Maximum EV percentage
  - `player` (optional): Filter by player name (partial match, case-insensitive)
  - `market` (optional): Filter by market type (e.g., `player_pass_yds`)
  - `limit` (optional): Maximum results to return (default: 100, max: 500)

  **Example Requests:**
  ```bash
  # Get all active bets
  curl http://localhost:8000/bets
  
  # Get PrizePicks bets only
  curl http://localhost:8000/bets?bookmaker=prizepicks
  
  # Get Underdog bets with minimum 5% EV
  curl http://localhost:8000/bets?bookmaker=underdog&min_ev=5.0
  
  # Get NFL bets for a specific player
  curl http://localhost:8000/bets?sport=NFL&player=mahomes
  
  # Get all passing yards bets
  curl http://localhost:8000/bets?market=player_pass_yds
  
  # Get top 50 bets with EV between 3% and 10%
  curl http://localhost:8000/bets?min_ev=3.0&max_ev=10.0&limit=50
  ```

### Get Bets by Bookmaker
- **GET** `/bets/by-bookmaker/{bookmaker}`
  - Get active EV bets for a specific bookmaker
  - Path parameter: `bookmaker` (either `prizepicks` or `underdog`)
  - Query parameter: `limit` (optional, default: 100, max: 500)
  
  **Example Requests:**
  ```bash
  # Get PrizePicks bets
  curl http://localhost:8000/bets/by-bookmaker/prizepicks
  
  # Get Underdog bets (limited to 50)
  curl http://localhost:8000/bets/by-bookmaker/underdog?limit=50
  ```

### Get Bet Statistics
- **GET** `/bets/stats`
  - Get aggregate statistics about stored bets
  
  **Response:**
  ```json
  {
    "total_bets": 1234,
    "active_bets": 567,
    "avg_ev_percent": 7.85,
    "max_ev_percent": 23.45,
    "oldest_bet": "2025-11-30T10:15:30",
    "newest_bet": "2025-11-30T12:30:45"
  }
  ```

### Get Available Bookmakers
- **GET** `/bets/bookmakers`
  - Get list of bookmakers with active bets
  
  **Response:**
  ```json
  {
    "bookmakers": [
      {"bookmaker": "prizepicks", "bet_count": 123},
      {"bookmaker": "underdog", "bet_count": 98}
    ]
  }
  ```

### Get Available Markets
- **GET** `/bets/markets`
  - Get list of markets with active bets
  
  **Response:**
  ```json
  {
    "markets": [
      {"market": "player_pass_yds", "bet_count": 45},
      {"market": "player_receptions", "bet_count": 38},
      {"market": "player_points", "bet_count": 32}
    ]
  }
  ```

## Interactive API Documentation

FastAPI automatically generates interactive API documentation:

- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

These interfaces allow you to:
- View all available endpoints
- See request/response schemas
- Test API calls directly from the browser
- View example responses

## Response Format

All bet responses follow this structure:

```json
{
  "id": 123,
  "bookmaker": "prizepicks",
  "market": "player_pass_yds",
  "player": "Patrick Mahomes",
  "outcome": "Over",
  "betting_line": 275.5,
  "sharp_mean": 285.3,
  "mean_diff": -9.8,
  "ev_percent": 8.45,
  "price": 1.82,
  "true_prob": 0.5954,
  "created_at": "2025-11-30T12:00:00",
  "sport_title": "NFL",
  "home_team": "Kansas City Chiefs",
  "away_team": "Las Vegas Raiders",
  "commence_time": "2025-12-01T18:00:00"
}
```

## Field Descriptions

- `id`: Unique bet identifier
- `bookmaker`: Betting platform (prizepicks or underdog)
- `market`: Type of bet (e.g., player_pass_yds, player_points)
- `player`: Player name
- `outcome`: Over or Under
- `betting_line`: The line offered by the bookmaker
- `sharp_mean`: Calculated true mean from sharp bookmakers
- `mean_diff`: Difference between betting line and sharp mean
- `ev_percent`: Expected Value as a percentage
- `price`: Decimal odds offered
- `true_prob`: Calculated true probability of the outcome
- `created_at`: When the bet was last updated
- `sport_title`: Sport name (e.g., NFL, NBA)
- `home_team`: Home team name
- `away_team`: Away team name
- `commence_time`: Game start time

## CORS Configuration

The API is configured to accept requests from any origin. For production, you should restrict this to your frontend domain:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://yourdomain.com"],  # Restrict to your domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## Error Handling

The API returns standard HTTP status codes:

- `200 OK`: Successful request
- `400 Bad Request`: Invalid parameters
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Database or server error

Error responses include a detail message:
```json
{
  "detail": "Database error: connection failed"
}
```

## Integration Examples

### Python
```python
import requests

# Get PrizePicks bets with minimum 5% EV
response = requests.get(
    "http://localhost:8000/bets",
    params={"bookmaker": "prizepicks", "min_ev": 5.0}
)
bets = response.json()

for bet in bets:
    print(f"{bet['player']} - {bet['market']}: {bet['ev_percent']}% EV")
```

### JavaScript/React
```javascript
// Fetch Underdog bets
fetch('http://localhost:8000/bets?bookmaker=underdog')
  .then(response => response.json())
  .then(bets => {
    bets.forEach(bet => {
      console.log(`${bet.player} - ${bet.market}: ${bet.ev_percent}% EV`);
    });
  });
```

### cURL
```bash
# Get stats
curl http://localhost:8000/bets/stats | jq

# Get top 10 PrizePicks bets
curl "http://localhost:8000/bets?bookmaker=prizepicks&limit=10" | jq
```

## Production Deployment

For production deployment, consider:

1. **Environment Variables**: Use proper environment variable management
2. **HTTPS**: Enable HTTPS with a reverse proxy (nginx, Caddy)
3. **Workers**: Use multiple Uvicorn workers for better performance
4. **Monitoring**: Add logging and monitoring (e.g., Sentry, DataDog)
5. **Rate Limiting**: Implement rate limiting to prevent abuse
6. **Authentication**: Add API key authentication if needed

Example production command:
```bash
uvicorn api:app --host 0.0.0.0 --port 8000 --workers 4 --log-level info
```

## Database Connection

The API uses the `Database` class from `database.py` which:
- Connects to PostgreSQL using `DATABASE_URL` environment variable
- Uses connection pooling for efficient database access
- Automatically manages connections with context managers
- Returns results as dictionaries for easy JSON serialization

## Notes

- Bets are automatically marked as inactive when games start (managed by the scheduler)
- The API only returns active bets by default
- Results are sorted by EV percentage (highest first)
- All queries are parameterized to prevent SQL injection






