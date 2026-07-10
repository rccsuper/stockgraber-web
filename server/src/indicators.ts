/**
 * StockGraber indicator math — TypeScript port of data.py in the original
 * desktop app. Same algorithms, same warmup guards, same return shapes.
 *
 * Functions are pure: they accept plain arrays/numbers and return plain arrays
 * (or null on the warmup bars). The web layer does the chart-friendly framing.
 */

export type Series = ReadonlyArray<number | null>;
export type SeriesOut = Array<number | null>;

function wilderSmooth(x: Series, period: number): SeriesOut {
  // Wilder's smoothing == EMA with alpha = 1/period, adjust=false.
  // Returns null until we have `period` valid inputs.
  const alpha = 1 / period;
  const out: SeriesOut = new Array(x.length).fill(null);
  let sum = 0;
  let count = 0;
  let prev: number | null = null;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (v == null || !Number.isFinite(v)) continue;
    if (count < period) {
      sum += v;
      count++;
      if (count === period) {
        prev = sum / period;
        out[i] = prev;
      }
    } else {
      // prev = prev + alpha * (v - prev)
      prev = prev! + alpha * (v - prev!);
      out[i] = prev;
    }
  }
  return out;
}

/** Wilder's RSI. 0..100. null on the warmup bars. */
export function rsi(close: Series, period = 14): SeriesOut {
  const n = close.length;
  const gains: Series = new Array(n).fill(null);
  const losses: Series = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const c = close[i];
    const p = close[i - 1];
    if (c == null || p == null) continue;
    const d = c - p;
    gains[i] = d > 0 ? d : 0;
    losses[i] = d < 0 ? -d : 0;
  }
  const avgGain = wilderSmooth(gains, period);
  const avgLoss = wilderSmooth(losses, period);
  const out: SeriesOut = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const g = avgGain[i];
    const l = avgLoss[i];
    if (g == null || l == null) continue;
    if (l === 0) {
      out[i] = g === 0 ? 50 : 100;
    } else {
      const rs = g / l;
      out[i] = 100 - 100 / (1 + rs);
    }
  }
  return out;
}

function ema(x: Series, period: number, adjust = false): SeriesOut {
  // Recursive EMA matching pandas ewm(span=period, adjust=False).mean().
  // Returns null on the warmup bars, the first valid value once we have one
  // input (pandas' behavior with adjust=False), then recurses.
  const alpha = 2 / (period + 1);
  const out: SeriesOut = new Array(x.length).fill(null);
  let prev: number | null = null;
  if (adjust) {
    // equivalent to pandas adjust=True seed: weighted average of all seen values
    let num = 0;
    let den = 0;
    let k = 1;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      if (v == null) continue;
      num += v * k;
      den += k;
      k *= 1 - alpha;
      if (den > 0) out[i] = num / den;
    }
  } else {
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      if (v == null) continue;
      if (prev == null) {
        prev = v; // first value seeds the EMA
        out[i] = prev;
      } else {
        prev = alpha * v + (1 - alpha) * prev;
        out[i] = prev;
      }
    }
  }
  return out;
}

function sma(x: Series, period: number): SeriesOut {
  const out: SeriesOut = new Array(x.length).fill(null);
  let sum = 0;
  let count = 0;
  const buf: Array<number | null> = [];
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    buf.push(v);
    if (v != null && Number.isFinite(v)) {
      sum += v;
      count++;
    } else {
      count--; // nulls don't count
    }
    if (buf.length > period) {
      const dropped = buf.shift()!;
      if (dropped != null && Number.isFinite(dropped)) {
        sum -= dropped;
        count--;
      }
    }
    if (buf.length === period && count === period) {
      out[i] = sum / period;
    }
  }
  return out;
}

/** Moving average of `series` over `period`. method="sma" or "ema". */
export function movingAverage(
  series: Series,
  period: number,
  method: "sma" | "ema" = "sma",
): SeriesOut {
  return method === "ema" ? ema(series, period) : sma(series, period);
}

export interface MacdResult {
  macd: SeriesOut;
  signal: SeriesOut;
  histogram: SeriesOut;
}

/**
 * MACD. Returns (macd_line, signal_line, histogram). MACD is inherently
 * EMA-based. ema(fast) - ema(slow); signal = ema(macd, signalPeriod).
 */
export function macd(
  close: Series,
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdResult {
  const emaFast = ema(close, fast);
  const emaSlow = ema(close, slow);
  const macdLine: SeriesOut = new Array(close.length).fill(null);
  for (let i = 0; i < close.length; i++) {
    const a = emaFast[i];
    const b = emaSlow[i];
    if (a != null && b != null) macdLine[i] = a - b;
  }
  // signal EMA runs only on the valid macd bars (matches pandas ewm which
  // ignores nulls in the input).
  const signalLine = ema(macdLine, signalPeriod);
  const histogram: SeriesOut = new Array(close.length).fill(null);
  for (let i = 0; i < close.length; i++) {
    const m = macdLine[i];
    const s = signalLine[i];
    if (m != null && s != null) histogram[i] = m - s;
  }
  return { macd: macdLine, signal: signalLine, histogram };
}

export interface CrossMarkers {
  golden: Array<{ index: number; y: number }>;
  death: Array<{ index: number; y: number }>;
}

/**
 * Find MA crossovers and the y-coords where their markers should sit.
 *  - Golden cross: fast crosses ABOVE slow (bullish)
 *  - Death cross : fast crosses BELOW slow (bearish)
 *  - `method` must match the chart's MA lines.
 *  - Markers are placed just under the bar's low (golden) or just over its
 *    high (death), offset by `pad` (fraction), so arrows don't sit on the
 *    candles.
 *
 * Returns the index of the crossover bar in the source series, and the
 * y-coordinate (in the same units as the OHLC data — i.e. price or %).
 */
export function maCrossMarkers(
  close: Series,
  high: Series,
  low: Series,
  fast = 50,
  slow = 200,
  method: "sma" | "ema" = "sma",
  pad = 0.03,
): CrossMarkers {
  const fastMa = movingAverage(close, fast, method);
  const slowMa = movingAverage(close, slow, method);

  const valid: boolean[] = new Array(close.length).fill(false);
  for (let i = 0; i < close.length; i++) {
    valid[i] = fastMa[i] != null && slowMa[i] != null;
  }
  // EMA produces values from the first bar; enforce a `slow`-bar warmup
  // explicitly so early unreliable EMAs don't fire spurious crosses. (SMA is
  // already NaN/null on those bars, so this is a no-op for SMA.)
  for (let i = 0; i < Math.min(slow, valid.length); i++) valid[i] = false;

  const golden: Array<{ index: number; y: number }> = [];
  const death: Array<{ index: number; y: number }> = [];

  for (let i = 1; i < close.length; i++) {
    if (!valid[i] || !valid[i - 1]) continue;
    const aboveNow = (fastMa[i] ?? 0) > (slowMa[i] ?? 0);
    const abovePrev = (fastMa[i - 1] ?? 0) > (slowMa[i - 1] ?? 0);
    if (aboveNow && !abovePrev) {
      const lo = low[i];
      if (lo != null) golden.push({ index: i, y: lo * (1 - pad) });
    } else if (!aboveNow && abovePrev) {
      const hi = high[i];
      if (hi != null) death.push({ index: i, y: hi * (1 + pad) });
    }
  }

  return { golden, death };
}
