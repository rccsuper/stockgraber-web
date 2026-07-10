# StockGraber Web

Dark-themed **web** stock charter — candlesticks, MA crossovers, RSI/MACD, and
percent-change index comparison. A re-imagining of
[Garionhk/StockGraber](https://github.com/Garionhk/StockGraber) (originally a
PySide6 desktop app) as a modern web application.

> ⚠️ **Not financial advice.** StockGraber Web is a charting/learning tool. The
> indicators and signals it draws (golden/death crosses, RSI, MACD, etc.) are
> common technical-analysis conventions, not buy/sell recommendations. No
> indicator reliably predicts price.

---

## Features

- **Candlesticks + volume** — daily OHLC from Yahoo Finance, with a volume
  sub-panel coloured by up/down day.
- **Moving-average crossovers** — preset fast/slow pairs (9/21, 20/50, 50/200,
  100/200) shown as Fast/Slow value tiles; toggle **SMA ↔ EMA**.
- **Golden / death cross markers** — bright-yellow-ringed ▲ (bullish) / ▼
  (bearish) arrows where the fast MA crosses the slow MA.
- **RSI & MACD sub-panels** — RSI (14) with a 30–70 band, MACD (12,26,9) with a
  green/red histogram; Volume / RSI / MACD panels can each be shown/hidden.
- **Index comparison (percent mode)** — pick a market index (US / Canada /
  Hong Kong / global) and the price panel switches to a **rebased %-change**
  view: stock as a filled area, index as a line, MAs in %, on a percent axis —
  rebased to the start of the visible window and re-fit (~90% height) as you
  pan/zoom.
- **Hover readout** — a boxed O/H/L/C panel with the day's change vs. the
  previous close (color-coded ▲/▼).
- **Navigation** — drag to pan, mouse-wheel or `+`/`−`/`Reset` buttons to zoom,
  a timeframe segmented control (1M…MAX), and a log/linear toggle.
- **Symbol search** — find a ticker by company name across markets, then
  **Use in chart**.
- **Local cache** — daily OHLC stored in a local SQLite database (server side)
  so repeat loads are instant and only missing dates are downloaded.
- **Bilingual UI** — one-click toggle between **English** and **Traditional
  Chinese (繁體中文)** for the whole interface.

---

## Architecture

A two-process app, both running on Bun:

```
┌────────────────────┐        HTTP/JSON         ┌─────────────────────┐
│  web/  (Vite/React)│ ───────────────────────► │ server/ (Bun/Hono)  │
│  UI + chart        │                          │  Yahoo + SQLite     │
└────────────────────┘                          └─────────────────────┘
                                                          │
                                                          ▼
                                                    ┌──────────────┐
                                                    │ stockgraber.db│
                                                    └──────────────┘
```

- **`server/`** — Bun + Hono, fetches daily OHLC from Yahoo Finance
  (`yahoo-finance2`), caches in SQLite, computes indicators, exposes a small
  JSON API.
- **`web/`** — Vite + React + TypeScript with `lightweight-charts` for the
  candlestick/MACD/RSI rendering. Dark terminal theme, sidebar of cards
  (Quote / Indicators / Comparison / Legend / Date Range).

The data-layer and indicator math are 1-to-1 ports of the Python originals in
`data.py` (Wilder's RSI, MACD with `adjust=False`, MA cross markers with the
same warmup guard, etc.).

---

## Quick start

Requires [Bun](https://bun.sh) ≥ 1.3 and Node 18+ (for Vite).

```bash
# install
cd server && bun install
cd ../web && bun install

# dev — runs both server (port 3001) and web (port 5173) in parallel
# (or open two terminals:)
cd server && bun run dev
cd web   && bun run dev
```

Open <http://localhost:5173>. The server caches OHLC under
`server/data/stockgraber.db`.

### Production build

```bash
# build the web bundle
cd web && bun run build

# build + run the server (serves API only)
cd ../server && bun run build && bun run start
```

---

## Project layout

```
stockgraber-web/
├── server/                 Bun + Hono API
│   ├── src/
│   │   ├── index.ts        HTTP entry, routes
│   │   ├── data.ts         Yahoo fetch + SQLite cache (port of data.py)
│   │   └── indicators.ts   Wilder RSI, MACD, MA, cross markers
│   ├── package.json
│   └── tsconfig.json
└── web/                    Vite + React + TypeScript
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── components/     Sidebar, chart column, search dialog, …
    │   ├── hooks/
    │   ├── lib/            API client, format helpers
    │   ├── i18n/           English / 繁體中文
    │   └── styles/         CSS
    ├── package.json
    ├── tsconfig.json
    └── vite.config.ts
```

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/ohlc?symbol=AAPL&start=2015-01-01&end=2024-12-31` | Daily OHLC + computed indicators (SMA/EMA, RSI, MACD, cross markers). |
| `GET`  | `/api/search?q=apple` | Look up ticker codes by company name (Yahoo Finance). |
| `GET`  | `/api/quote?symbol=AAPL` | Last close + previous close + change/%. |
| `GET`  | `/api/health` | Liveness check. |

All responses are JSON. CORS is open in dev; restrict in production.

---

## Indicators & signals (quick reference)

| Signal | Meaning (convention) |
|---|---|
| **Golden cross** (▲) | Fast MA crosses **above** slow MA — bullish. |
| **Death cross** (▼) | Fast MA crosses **below** slow MA — bearish. |
| **RSI > 70 / < 30** | Overbought / oversold. |
| **MACD line vs. signal** | Momentum turning up/down. |

MA-pair character: **50/200** = long-term, fewest/most-trusted signals;
**20/50** = swing trading; **10/20** & **5/10** = short-term, more signals and
more noise (whipsaws); **9/21** & **12/26** = popular short–medium pairings,
traditionally used as EMAs.

---

## Index comparison list

- **United States** — S&P 500 (`^GSPC`), Dow (`^DJI`), Nasdaq Composite
  (`^IXIC`), Nasdaq 100 (`^NDX`), Russell 2000 (`^RUT`), VIX (`^VIX`)
- **Canada** — S&P/TSX Composite (`^GSPTSE`)
- **Hong Kong** — Hang Seng (`^HSI`), HS China Enterprises (`^HSCE`)
- **Global / Other** — FTSE 100 (`^FTSE`), DAX (`^GDAXI`), CAC 40 (`^FCHI`),
  Nikkei 225 (`^N225`), Euro Stoxx 50 (`^STOXX50E`), ASX 200 (`^AXJO`),
  Nifty 50 (`^NSEI`)

Selecting an index switches the price panel to **percent-change mode**: both the
stock and the index are rebased to 0% at the start of the visible window, so
where the stock line ends above the index line, the stock outperformed.

---

## Notes & limitations

- **Prices are not split/dividend-adjusted.** Cached rows are only overwritten
  when re-fetched, so old bars keep their raw values after a split until that
  range is re-fetched.
- **MA periods are preset-only** (4 pairs); **RSI/MACD periods are fixed**
  (14, and 12/26/9).
- Data quality depends on Yahoo Finance; occasional gaps or glitches are
  possible.

---

## Credits

- Original desktop app: [Garionhk/StockGraber](https://github.com/Garionhk/StockGraber)
  (PySide6 + finplot). All indicator math and UX decisions are reused from that
  project.
- Charting: [TradingView lightweight-charts](https://github.com/tradingview/lightweight-charts).
- Data: [yahoo-finance2](https://github.com/gadicc/node-yahoo-finance2).

## License

Apache-2.0 (matching upstream).
