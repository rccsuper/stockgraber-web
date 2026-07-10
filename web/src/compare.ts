/* Indices available for the percent-change comparison, grouped by market. */

export interface CompareIndex { name: string; ticker: string }
export interface CompareMarket { market: string; items: CompareIndex[] }

export const COMPARE_INDICES: CompareMarket[] = [
  { market: "United States", items: [
    { name: "S&P 500", ticker: "^GSPC" },
    { name: "Dow Jones", ticker: "^DJI" },
    { name: "Nasdaq Composite", ticker: "^IXIC" },
    { name: "Nasdaq 100", ticker: "^NDX" },
    { name: "Russell 2000", ticker: "^RUT" },
    { name: "VIX (volatility)", ticker: "^VIX" },
  ] },
  { market: "Canada", items: [
    { name: "S&P/TSX Composite", ticker: "^GSPTSE" },
  ] },
  { market: "Hong Kong", items: [
    { name: "Hang Seng", ticker: "^HSI" },
    { name: "HS China Enterprises", ticker: "^HSCE" },
  ] },
  { market: "Global / Other", items: [
    { name: "FTSE 100 (UK)", ticker: "^FTSE" },
    { name: "DAX (Germany)", ticker: "^GDAXI" },
    { name: "CAC 40 (France)", ticker: "^FCHI" },
    { name: "Nikkei 225 (Japan)", ticker: "^N225" },
    { name: "Euro Stoxx 50", ticker: "^STOXX50E" },
    { name: "ASX 200 (Australia)", ticker: "^AXJO" },
    { name: "Nifty 50 (India)", ticker: "^NSEI" },
  ] },
];

export function findCompareName(ticker: string | null): string {
  if (!ticker) return "";
  for (const m of COMPARE_INDICES) {
    for (const it of m.items) if (it.ticker === ticker) return it.name;
  }
  return ticker;
}

export function exchangeOf(sym: string): string {
  if (sym.startsWith("^")) return "INDEX";
  if (sym.includes(".")) {
    const suf = sym.split(".").pop()!;
    return ({ HK: "HKEX", TO: "TSX" } as Record<string, string>)[suf] ?? suf;
  }
  return "US";
}

export const MA_PRESETS: { label: string; fast: number; slow: number }[] = [
  { label: "9/21", fast: 9, slow: 21 },
  { label: "20/50", fast: 20, slow: 50 },
  { label: "50/200", fast: 50, slow: 200 },
  { label: "100/200", fast: 100, slow: 200 },
];
export const DEFAULT_PRESET_IDX = 2;

export const TIMEFRAMES: { label: string; bars: number | null }[] = [
  { label: "1M", bars: 21 },
  { label: "3M", bars: 63 },
  { label: "6M", bars: 126 },
  { label: "1Y", bars: 252 },
  { label: "5Y", bars: 1260 },
  { label: "MAX", bars: null },
];
export const DEFAULT_TF_IDX = 2;
