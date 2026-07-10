/**
 * StockGraber data layer — TypeScript port of data.py.
 *
 * Real daily OHLC candles via yahoo-finance2, cached locally in SQLite so we
 * don't re-hit the network on every chart load. Same coverage-tracked
 * no-re-fetch semantics as upstream.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import YahooFinance from "yahoo-finance2";

// yahoo-finance2 v3 is an ESM class — instantiate once.
const yf = new YahooFinance({
  suppressNotices: ["yahooSurvey", "ripHistorical"],
});

const DB_PATH = resolve(import.meta.dir, "../data/stockgraber.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

const DEFAULT_START = "2015-01-01";
const DAY_MS = 24 * 60 * 60 * 1000;
const OHLC_COLS = ["open", "high", "low", "close", "volume"] as const;

function mostRecentWeekday(d: Date = new Date()): Date {
  const day = new Date(d);
  day.setUTCHours(0, 0, 0, 0);
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) {
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return day;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function openDb(): Database {
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ohlc (
      symbol TEXT NOT NULL,
      date   TEXT NOT NULL,
      open   REAL NOT NULL,
      high   REAL NOT NULL,
      low    REAL NOT NULL,
      close  REAL NOT NULL,
      volume REAL,
      PRIMARY KEY (symbol, date)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS coverage (
      symbol TEXT PRIMARY KEY,
      start  TEXT NOT NULL,
      end    TEXT NOT NULL
    );
  `);
  return db;
}

function getCoverage(
  db: Database,
  symbol: string,
): { start: string; end: string } | null {
  const row = db
    .query<{ start: string; end: string }, [string]>(
      "SELECT start, end FROM coverage WHERE symbol = ?",
    )
    .get(symbol);
  return row ?? null;
}

function setCoverage(
  db: Database,
  symbol: string,
  start: Date,
  end: Date,
): void {
  db.run(
    `INSERT INTO coverage (symbol, start, end) VALUES (?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET start = excluded.start, end = excluded.end`,
    [symbol, isoDate(start), isoDate(end)],
  );
}

function hasRows(db: Database, symbol: string): boolean {
  return (
    db
      .query<{ c: number }, [string]>(
        "SELECT 1 as c FROM ohlc WHERE symbol = ? LIMIT 1",
      )
      .get(symbol) != null
  );
}

function dataBounds(
  db: Database,
  symbol: string,
): { start: string; end: string } | null {
  const row = db
    .query<{ min: string; max: string }, [string]>(
      "SELECT MIN(date) as min, MAX(date) as max FROM ohlc WHERE symbol = ?",
    )
    .get(symbol);
  if (!row || !row.min) return null;
  return { start: row.min, end: row.max };
}

interface OhlcRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

async function fetchRange(
  symbol: string,
  start: Date,
  end: Date,
): Promise<OhlcRow[]> {
  // yahoo-finance2's `end` is EXCLUSIVE; bump a day to include the end date.
  const endExclusive = new Date(end.getTime() + DAY_MS);
  let raw: Awaited<ReturnType<typeof yf.chart>>;
  try {
    raw = await yf.chart(symbol, {
      period1: start,
      period2: endExclusive,
      interval: "1d",
    });
  } catch (e) {
    // yahoo-finance2 sometimes throws "No data found" for fresh tickers.
    // Treat that as an empty range; let other errors bubble.
    const msg = (e as Error)?.message ?? String(e);
    if (/No data found|Invalid input|not found/i.test(msg)) return [];
    throw e;
  }
  if (!raw?.quotes?.length) return [];

  const rows: OhlcRow[] = [];
  for (const q of raw.quotes) {
    // quotes may carry a Date or epoch seconds; normalize.
    const d = q.date instanceof Date ? q.date : new Date((q.date as number) * 1000);
    if (Number.isNaN(d.getTime())) continue;
    const o = q.open,
      h = q.high,
      l = q.low,
      c = q.close;
    if (o == null || h == null || l == null || c == null) continue;
    rows.push({
      date: isoDate(d),
      open: Number(o),
      high: Number(h),
      low: Number(l),
      close: Number(c),
      volume: q.volume == null ? null : Number(q.volume),
    });
  }
  return rows;
}

function upsertRows(db: Database, symbol: string, rows: OhlcRow[]): void {
  if (!rows.length) return;
  const stmt = db.prepare(
    `INSERT INTO ohlc (symbol, date, open, high, low, close, volume)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol, date) DO UPDATE SET
       open = excluded.open,
       high = excluded.high,
       low  = excluded.low,
       close= excluded.close,
       volume = excluded.volume`,
  );
  db.transaction(() => {
    for (const r of rows) {
      stmt.run(
        symbol,
        r.date,
        r.open,
        r.high,
        r.low,
        r.close,
        r.volume,
      );
    }
  })();
}

function readRange(
  db: Database,
  symbol: string,
  start: string,
  end: string,
): OhlcRow[] {
  return db
    .query<OhlcRow, [string, string, string]>(
      `SELECT date, open, high, low, close, volume
       FROM ohlc
       WHERE symbol = ? AND date BETWEEN ? AND ?
       ORDER BY date`,
    )
    .all(symbol, start, end);
}

export interface OhlcData {
  symbol: string;
  rows: OhlcRow[];
}

/**
 * Daily OHLC for `symbol` over [start, end], fetching only what's missing.
 * Already-cached data is never re-downloaded: we track the date span already
 * requested per symbol and only hit the network for the bits outside it.
 * Pass forceRefresh=true to re-download the requested window regardless.
 */
export async function getOhlc(
  symbolIn: string,
  startIn?: string | Date,
  endIn?: string | Date,
  forceRefresh = false,
): Promise<OhlcData> {
  const symbol = (symbolIn || "").trim().toUpperCase();
  if (!symbol) throw new Error("No ticker symbol given.");
  const start = startIn
    ? new Date(startIn as string | Date)
    : new Date(DEFAULT_START);
  const end = endIn ? new Date(endIn as string | Date) : mostRecentWeekday();
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);
  if (end < start) throw new Error("End date is before start date.");

  const startStr = isoDate(start);
  const endStr = isoDate(end);

  const db = openDb();
  try {
    let stored = getCoverage(db, symbol);
    if (!stored && hasRows(db, symbol)) {
      stored = dataBounds(db, symbol); // legacy DBs without coverage table
    }
    const cov = forceRefresh ? null : stored;

    const toFetch: Array<[Date, Date]> = [];
    if (!cov) {
      toFetch.push([start, end]);
    } else {
      const cstart = new Date(cov.start);
      const cend = new Date(cov.end);
      if (start < cstart) toFetch.push([start, new Date(cstart.getTime() - DAY_MS)]);
      if (end > cend) toFetch.push([new Date(cend.getTime() + DAY_MS), end]);
    }

    for (const [s, e] of toFetch) {
      if (e < s) continue;
      const fresh = await fetchRange(symbol, s, e);
      if (fresh.length) upsertRows(db, symbol, fresh);
    }

    if (hasRows(db, symbol)) {
      let lo = start;
      let hi = end;
      if (stored) {
        lo = new Date(Math.min(lo.getTime(), new Date(stored.start).getTime()));
        hi = new Date(Math.max(hi.getTime(), new Date(stored.end).getTime()));
      }
      setCoverage(db, symbol, lo, hi);
    }

    const rows = readRange(db, symbol, startStr, endStr);
    if (!rows.length) {
      throw new Error(`No data for ticker '${symbol}' in the given range.`);
    }
    return { symbol, rows };
  } finally {
    db.close();
  }
}

export interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

/** Look up ticker codes by company name across major markets. */
export async function searchSymbols(
  query: string,
  limit = 25,
): Promise<SearchResult[]> {
  const q = (query || "").trim();
  if (!q) return [];
  try {
    const res = await yf.search(q, { newsCount: 0, quotesCount: limit });
    const quotes: any[] = (res as any).quotes ?? [];
    const out: SearchResult[] = [];
    for (const r of quotes) {
      const sym = r?.symbol;
      if (!sym) continue;
      out.push({
        symbol: sym,
        name: r.shortname || r.longname || "",
        exchange: r.exchDisp || r.exchange || "",
        type: r.quoteType ? String(r.quoteType).replace(/^./, (c: string) => c.toUpperCase()) : "",
      });
    }
    return out;
  } catch (e) {
    // 422s are common from yahoo for nonsense queries — return empty.
    return [];
  }
}
