/* API client + shared types. */

export interface OhlcRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface OhlcResponse {
  symbol: string;
  start: string;
  end: string;
  count: number;
  dates: string[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: (number | null)[];
  indicators: {
    rsi: (number | null)[];
    macd: {
      line: (number | null)[];
      signal: (number | null)[];
      histogram: (number | null)[];
    };
    ma: {
      fast: (number | null)[];
      slow: (number | null)[];
      fastPeriod: number;
      slowPeriod: number;
      method: "sma" | "ema";
    };
    crosses: {
      golden: { date: string; price: number }[];
      death: { date: string; price: number }[];
    };
  };
}

export interface QuoteResponse {
  symbol: string;
  date: string;
  close: number;
  previousClose: number;
  change: number;
  changePct: number;
}

export interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export interface SearchResponse {
  query: string;
  count: number;
  results: SearchResult[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch { /* swallow */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  ohlc(params: {
    symbol: string;
    start?: string;
    end?: string;
    maFast?: number;
    maSlow?: number;
    maMethod?: "sma" | "ema";
    force?: boolean;
  }): Promise<OhlcResponse> {
    const q = new URLSearchParams({ symbol: params.symbol });
    if (params.start) q.set("start", params.start);
    if (params.end) q.set("end", params.end);
    if (params.maFast) q.set("maFast", String(params.maFast));
    if (params.maSlow) q.set("maSlow", String(params.maSlow));
    if (params.maMethod) q.set("maMethod", params.maMethod);
    if (params.force) q.set("force", "1");
    return getJson<OhlcResponse>(`/api/ohlc?${q}`);
  },
  quote(symbol: string): Promise<QuoteResponse> {
    return getJson<QuoteResponse>(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
  },
  search(q: string): Promise<SearchResponse> {
    return getJson<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`);
  },
};
