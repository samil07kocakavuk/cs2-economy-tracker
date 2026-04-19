# Steam Project

Inventory-first CS2 web app built with React and Express.

## Current Features

- Steam inventory lookup with `SteamID64` or `profiles/...` link
- grouped duplicate items
- selectable quantities with `+ / -`
- total inventory value
- selected item value
- estimated post-fee Steam balance
- sticker and charm rendering when available
- profile avatar and profile name header
- rarity sorting and filtering
- refresh inventory action

## Tech Stack

- React
- Vite
- Express
- Steam inventory and market endpoints

## Run Locally

```bash
npm install
npm run dev
```

Frontend:
- `http://localhost:5173`

Backend:
- `http://localhost:3001`

## Project Structure

```text
client/   React frontend
server/   Express backend
```

## Notes

- inventory must be public
- some items are not marketable, so they do not have Steam market prices
- net Steam balance is estimated from Steam market pricing and available sale price data

## Product Direction

See `PRODUCT_DIRECTION.md` for the larger roadmap and differentiation strategy.
