# CS2 Economy Tracker

A full-stack CS2 (Counter-Strike 2) inventory viewer, collection browser, and trade-up calculator.

## Features

### 🎒 Inventory Viewer
- Enter any public Steam profile (SteamID64 or profile URL)
- View all CS2 items with real-time market prices
- Group identical items, sort by price/rarity
- Select items and calculate total value
- Sticker & charm detection

### 📦 Collections
- Browse all 89+ CS2 weapon collections
- Collection icons from cs2economy CDN
- Each collection shows items with rarity, knife type, and glove type
- Skin images loaded from Steam CDN
- Search and filter collections

### 📈 Trade Up Calculator
- Real skin database from ByMykel/CSGO-API (2000+ skins)
- Accurate rarity tiers and float ranges
- **Float system**: Set wear per input (FN/MW/FT/WW/BS buttons + fine-tune with ±)
- **Output float calculation**: Uses CS2 formula `avg(input_floats) × (max - min) + min`
- **Outcome probabilities**: Collection-weighted, shows exact % per possible output
- **Covert → Knife/Glove**: Trade up from Covert skins to get knives and gloves
- Filter by rarity, collection, search by name

## Tech Stack

- **Frontend**: React 18 + Vite
- **Backend**: Express.js (Node.js)
- **Data**: ByMykel/CSGO-API, Steam Market API, cs2economy CDN
- **Styling**: Custom CSS (dark theme)

## Getting Started

```bash
# Install dependencies
npm install
cd client && npm install && cd ..

# Run both (backend + frontend)
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /api/inventory/:steamId64` | Fetch player inventory with prices |
| `GET /api/collections` | List all collections |
| `GET /api/collections/:id` | Collection detail with items |
| `GET /api/steam-image?name=` | Proxy Steam skin images |

## Screenshots

Trade Up Calculator with float prediction, Collections browser with real icons, Inventory viewer with market prices.

## License

MIT
