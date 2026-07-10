/**
 * StockGraber Web — server entry.
 *
 * Hono routes for OHLC + search. Indicators are computed server-side so the
 * client just paints.
 */

import { Hono } from "hono";
import { getOhlc, searchSymbols } from "./data.ts";
import {
  rsi,
  macd,
  movingAverage,
  maCrossMarkers,
} from "./indicators.ts";

const app = new Hono();

// ---- CORS -----------------------------------------------------------------
// Open in dev; tighten for production via env. (Browser fetch from Vite dev
// server on :5173 to API on :3001 needs this.)
app.use("*", async (c, next) => {
  c.res.headers.set("Access-Control-Allow-Origin", "*");
  c.res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization",
  );
  c.res.headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS",
  );
  if (c.req.method === "OPTIONS") return new Response(null, { status: 204 });
  await next();
});

// ---- health ---------------------------------------------------------------
app.get("/api/health", (c) => c.json({ ok: true, ts: Date.now() }));

// ---- helpers --------------------------------------------------------------
function num(s: string | undefined): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function dates(arr: Array<{ date: string }>): string[] {
  return arr.map((r) => r.date);
}

function numbers(arr: Array<{ close: number }>): Array<number | null> {
  return arr.map((r) => r.close);
}
function numbersWithKey(
  arr: Array<Record<string, number | null>>,
  key: string,
): Array<number | null> {
  return arr.map((r) => r[key] as number | null);
}

// ---- /api/ohlc ------------------------------------------------------------
app.get("/api/ohlc", async (c) => {
  const symbol = c.req.query("symbol");
  if (!symbol) return c.json({ error: "Missing ?symbol=" }, 400);
  const start = c.req.query("start");
  const end = c.req.query("end");
  const maFast = num(c.req.query("maFast")) ?? 50;
  const maSlow = num(c.req.query("maSlow")) ?? 200;
  const maMethod = (c.req.query("maMethod") ?? "sma") as "sma" | "ema";

  try {
    const { symbol: sym, rows } = await getOhlc(
      symbol,
      start,
      end,
      c.req.query("force") === "1",
    );
    const close = numbers(rows);
    const high = numbersWithKey(rows, "high");
    const low = numbersWithKey(rows, "low");

    const fastMa = movingAverage(close, maFast, maMethod);
    const slowMa = movingAverage(close, maSlow, maMethod);
    const rsiArr = rsi(close, 14);
    const { macd: macdLine, signal: macdSignal, histogram } = macd(close);
    const cross = maCrossMarkers(close, high, low, maFast, maSlow, maMethod);

    return c.json({
      symbol: sym,
      start: rows[0].date,
      end: rows[rows.length - 1].date,
      count: rows.length,
      // OHLCV — dates first so the client can build the shared time axis,
      // then the rest as parallel arrays (easy on the wire and in JS).
      dates: dates(rows),
      open: rows.map((r) => r.open),
      high,
      low,
      close,
      volume: rows.map((r) => r.volume),
      indicators: {
        rsi: rsiArr,
        macd: { line: macdLine, signal: macdSignal, histogram },
        ma: { fast: fastMa, slow: slowMa, fastPeriod: maFast, slowPeriod: maSlow, method: maMethod },
        crosses: cross,
      },
    });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    return c.json({ error: msg }, 400);
  }
});

// ---- /api/quote -----------------------------------------------------------
app.get("/api/quote", async (c) => {
  const symbol = c.req.query("symbol");
  if (!symbol) return c.json({ error: "Missing ?symbol=" }, 400);
  try {
    // Quote just needs the last 5 trading days to compute the daily change.
    const end = new Date();
    const start = new Date(end.getTime() - 10 * 86_400_000);
    const { rows } = await getOhlc(symbol, start, end);
    if (!rows.length) return c.json({ error: "No data" }, 404);
    const last = rows[rows.length - 1];
    const prev = rows.length > 1 ? rows[rows.length - 2] : last;
    const chg = last.close - prev.close;
    const pct = prev.close ? (chg / prev.close) * 100 : 0;
    return c.json({
      symbol,
      date: last.date,
      close: last.close,
      previousClose: prev.close,
      change: chg,
      changePct: pct,
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// ---- /api/search ----------------------------------------------------------
app.get("/api/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const limit = num(c.req.query("limit")) ?? 25;
  const results = await searchSymbols(q, limit);
  return c.json({ query: q, count: results.length, results });
});


// ---- serve built SPA (production) --------------------------------------
// In dev the web app is served by Vite on a separate port and proxies /api to
// us. In a single-container / production deploy, we serve the Vite `dist/`
// next to the API. The path is `<server>/../web/dist` from the project root.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
const distDir = resolve(process.cwd(), "../web/dist");
if (existsSync(distDir)) {
  console.log(`[stockgraber] serving SPA from ${distDir}`);
  app.use("/*", async (c) => {
    const path = c.req.path === "/" ? "/index.html" : c.req.path;
    let file = join(distDir, path);
    if (!existsSync(file)) file = join(distDir, "index.html");
    const ct = file.endsWith(".html") ? "text/html; charset=utf-8"
      : file.endsWith(".js") ? "application/javascript"
      : file.endsWith(".css") ? "text/css; charset=utf-8"
      : file.endsWith(".svg") ? "image/svg+xml"
      : file.endsWith(".json") ? "application/json"
      : "application/octet-stream";
    const body = await Bun.file(file).bytes();
    return new Response(body, { headers: { "content-type": ct } });
  });
}

const port = Number(process.env.PORT ?? 3001);
console.log(`[stockgraber] server listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
