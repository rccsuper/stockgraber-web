import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type OhlcResponse } from "./api";
import { Chart, type CompareData } from "./chart";
import { tr, type Lang } from "./i18n";
import {
  COMPARE_INDICES, MA_PRESETS, TIMEFRAMES, DEFAULT_PRESET_IDX, DEFAULT_TF_IDX,
  exchangeOf, findCompareName,
} from "./compare";

/* Sidebar / legend colors. MA colors are defined inside chart.tsx; we mirror
 * the same hex here so the legend can label them without importing the chart
 * module's internals. */
const MA_FAST = "#4f8cff";
const MA_SLOW = "#f3a13a";
const COMPARE_COLOR = "#22d3ee";
const UP = "#22c98a";
const DOWN = "#f6465d";

const FONT_STACK = '"JetBrains Mono", "Consolas", "Menlo", monospace';

// Keep the button in its loading state at least this long so near-instant
// (cached) responses don't flicker "Load" <-> "…".
const MIN_LOAD_MS = 250;

function todayISO() { return new Date().toISOString().slice(0, 10); }
function yearsAgoISO(years: number) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}
function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

interface OhlcBox {
  date: string;
  o: number; h: number; l: number; c: number;
  change: string; // pre-styled HTML
}

export default function App() {
  const [lang, setLang] = useState<Lang>("en");
  // Stable identity across renders: `t` is in the load effect's dependency
  // array, so a fresh function per render would refetch on every render.
  const t = useCallback((k: string) => tr(k, lang), [lang]);
  const [symbol, setSymbol] = useState("AAPL");
  const [startDate, setStartDate] = useState(yearsAgoISO(2));
  const [endDate, setEndDate] = useState(todayISO());
  const [data, setData] = useState<OhlcResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // indicator state
  const [maIdx, setMaIdx] = useState(DEFAULT_PRESET_IDX);
  const [maMethod, setMaMethod] = useState<"sma" | "ema">("sma");
  const [showVolume, setShowVolume] = useState(true);
  const [showRsi, setShowRsi] = useState(true);
  const [showMacd, setShowMacd] = useState(true);
  const [lineChart, setLineChart] = useState(false);
  const [logScale, setLogScale] = useState(false);

  // index comparison
  const [compareTicker, setCompareTicker] = useState<string>("");
  const [compareOhlc, setCompareOhlc] = useState<OhlcResponse | null>(null);
  const loadReqIdRef = useRef(0);
  const compareReqIdRef = useRef(0);

  // timeframe, search
  const [tfIdx, setTfIdx] = useState(DEFAULT_TF_IDX);
  const [searchOpen, setSearchOpen] = useState(false);
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  // ---- load main symbol ----
  useEffect(() => {
    if (!symbol) return;
    if (endDate < startDate) { setError(t("invalid_range_msg")); return; }
    setError(null);
    const reqId = ++loadReqIdRef.current;
    setLoading(true);
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    api.ohlc({ symbol, start: startDate, end: endDate, maFast: MA_PRESETS[maIdx].fast, maSlow: MA_PRESETS[maIdx].slow, maMethod })
      .then((d) => { if (reqId === loadReqIdRef.current) setData(d); })
      .catch((e) => { if (reqId === loadReqIdRef.current) setError(e?.message ?? String(e)); })
      .finally(() => {
        if (reqId !== loadReqIdRef.current) return;
        timer = setTimeout(() => {
          if (reqId === loadReqIdRef.current) setLoading(false);
        }, Math.max(0, MIN_LOAD_MS - (Date.now() - startedAt)));
      });
    return () => clearTimeout(timer);
  }, [symbol, startDate, endDate, maIdx, maMethod, t]);

  // ---- load index (debounced) ----
  useEffect(() => {
    if (!compareTicker) { setCompareOhlc(null); return; }
    const reqId = ++compareReqIdRef.current;
    api.ohlc({ symbol: compareTicker, start: startDate, end: endDate, maFast: MA_PRESETS[maIdx].fast, maSlow: MA_PRESETS[maIdx].slow, maMethod })
      .then((d) => { if (reqId === compareReqIdRef.current) setCompareOhlc(d); })
      .catch(() => { if (reqId === compareReqIdRef.current) setCompareOhlc(null); });
  }, [compareTicker, startDate, endDate, maIdx, maMethod]);

  // ---- derived: compare-mode index data ----
  const compareData: CompareData | null = useMemo(() => {
    if (!compareTicker || !compareOhlc) return null;
    if (!compareOhlc.close.length) return null;
    return {
      indexName: findCompareName(compareTicker),
      dates: compareOhlc.dates,
      close: compareOhlc.close,
    };
  }, [compareTicker, compareOhlc]);

  // ---- handlers ----
  function onLoad(e?: React.FormEvent) {
    e?.preventDefault();
    if (!symbol.trim()) return;
    if (endDate < startDate) { setError(t("invalid_range_msg")); return; }
    setSymbol(symbol.trim().toUpperCase());
  }
  function onPickSymbol(sym: string) {
    setSearchOpen(false);
    setSymbol(sym);
  }
  function applyTimeframe(idx: number) {
    setTfIdx(idx);
    const tf = TIMEFRAMES[idx];
    setEndDate(todayISO());
    if (tf.bars == null) {
      // MAX — go back far enough to cover the full history.
      setStartDate(yearsAgoISO(30));
    } else {
      // bars are trading days; convert to calendar days (~1.4x) with a buffer.
      setStartDate(daysAgoISO(Math.round(tf.bars * 1.4) + 2));
    }
  }
  function onCompareChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setCompareTicker(e.target.value);
  }

  // ---- legend ----
  const legendRows = useMemo(() => {
    const ma = MA_PRESETS[maIdx];
    const tag = maMethod.toUpperCase();
    if (compareData) {
      return [
        { color: "#4f8cff", label: `${symbol}  %`, swatch: "line" as const },
        { color: COMPARE_COLOR, label: `${compareData.indexName}  (${t("rebased")})`, swatch: "line" as const },
        { color: "#ef4444", label: `${tag}${ma.fast}`, swatch: "line" as const },
        { color: "#7fb8ff", label: `${tag}${ma.slow}`, swatch: "line" as const },
      ];
    }
    return [
      { color: MA_FAST, label: `${tag}${ma.fast}`, swatch: "line" as const },
      { color: MA_SLOW, label: `${tag}${ma.slow}`, swatch: "line" as const },
      { color: UP, label: t("golden_cross"), swatch: "arrow" as const, arrow: "▲" },
      { color: DOWN, label: t("death_cross"), swatch: "arrow" as const, arrow: "▼" },
    ];
  }, [compareData, symbol, maIdx, maMethod, t]);

  // ---- hover OHLC box ----
  const ohlcBox: OhlcBox | null = useMemo(() => {
    if (!data || !hoverDate) return null;
    const i = data.dates.indexOf(hoverDate);
    if (i < 0) return null;
    const o = data.open[i], h = data.high[i], l = data.low[i], c = data.close[i];
    const date = data.dates[i];
    let change = "";
    if (i > 0) {
      const prev = data.close[i - 1];
      const ch = c - prev;
      const pct = prev ? (ch / prev) * 100 : 0;
      const col = ch > 0 ? UP : ch < 0 ? DOWN : "var(--mut)";
      const arr = ch > 0 ? "▲" : ch < 0 ? "▼" : "•";
      change = `&nbsp;&nbsp;<span style="color:${col};">${arr} ${ch >= 0 ? "+" : ""}${ch.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)</span>`;
    }
    return { date, o, h, l, c, change };
  }, [data, hoverDate]);

  // ---- quote (last bar) ----
  const quote = useMemo(() => {
    if (!data || data.close.length < 2) return null;
    const last = data.close[data.close.length - 1];
    const prev = data.close[data.close.length - 2];
    const chg = last - prev;
    const pct = prev ? (chg / prev) * 100 : 0;
    return { last, prev, chg, pct };
  }, [data]);

  return (
    <div className="app-root">
      <header className="topbar">
        <div className="topbar-left">
          <div className="logo">S</div>
          <div className="brand">StockGraber <span className="brand-sub">Web</span></div>
          <div className="header-symbol">{data ? `${symbol} · ${exchangeOf(symbol)}` : symbol}</div>
        </div>
        <div className="topbar-right">
          <button className="lang-btn" onClick={() => setLang(lang === "en" ? "zh" : "en")}>
            {lang === "en" ? "中文" : "EN"}
          </button>
        </div>
      </header>

      <div className="cmdbar">
        <form className="cmd-row" onSubmit={onLoad}>
          <input
            className="ticker-input"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="AAPL"
            spellCheck={false}
          />
          <button type="submit" className="load-btn" disabled={loading}>
            {loading ? "…" : t("load")}
          </button>
          <button type="button" className="tool-btn" onClick={() => setSearchOpen(true)}>
            {t("find")}
          </button>

          <div className="seg">
            {TIMEFRAMES.map((tf, i) => (
              <button
                type="button"
                key={tf.label}
                className={`seg-btn ${i === tfIdx ? "on" : ""}`}
                onClick={() => applyTimeframe(i)}
              >
                {tf.label}
              </button>
            ))}
          </div>

          <div className="grow" />

          <label className="date-field">
            <span>{t("from")}</span>
            <input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="date-field">
            <span>{t("to")}</span>
            <input type="date" value={endDate} min={startDate} max={todayISO()} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </form>
        {error && <div className="error">{t("load_failed")}: {error}</div>}
      </div>

      <div className="body">
        <div className="chart-stack">
          {ohlcBox && (
            <div className="info-box">
              <div className="info-date">{ohlcBox.date}</div>
              <div>
                <span className="lbl">O</span> {ohlcBox.o.toFixed(2)}&nbsp;&nbsp;
                <span className="lbl">H</span> {ohlcBox.h.toFixed(2)}&nbsp;&nbsp;
                <span className="lbl">L</span> {ohlcBox.l.toFixed(2)}
              </div>
              <div>
                <span className="lbl">C</span> <span className="c">{ohlcBox.c.toFixed(2)}</span>
                <span dangerouslySetInnerHTML={{ __html: ohlcBox.change }} />
              </div>
            </div>
          )}

          <ChartMount
            data={data}
            compare={compareData}
            showVolume={showVolume}
            showRsi={showRsi}
            showMacd={showMacd}
            maFast={MA_PRESETS[maIdx].fast}
            maSlow={MA_PRESETS[maIdx].slow}
            maMethod={maMethod}
            logScale={logScale}
            lineChart={lineChart}
            onHover={setHoverDate}
          />
        </div>

        <aside className="sidebar">
          <div className="sidebar-inner">
            <div className="card">
              <div className="quote-top">
                <div className="quote-left">
                  <div className="q-ticker">{symbol}</div>
                  <div className="q-name">{exchangeOf(symbol)}</div>
                </div>
                <div className="q-exch">{exchangeOf(symbol)}</div>
              </div>
              {quote && (
                <div className="quote-mid">
                  <div className="q-close">{quote.last.toFixed(2)}</div>
                  <div className="q-pill" style={{ color: quote.chg >= 0 ? UP : DOWN }}>
                    {quote.chg >= 0 ? "▲" : "▼"} {quote.chg >= 0 ? "+" : ""}{quote.chg.toFixed(2)} ({quote.pct >= 0 ? "+" : ""}{quote.pct.toFixed(2)}%)
                  </div>
                </div>
              )}
              <div className="q-sub">{t("daily_close")}</div>
            </div>

            <div className="card">
              <div className="card-title">{t("ma_crossover")}</div>
              <div className="seg seg-block">
                {MA_PRESETS.map((p, i) => (
                  <button
                    key={p.label}
                    className={`seg-btn ${i === maIdx ? "on" : ""}`}
                    onClick={() => setMaIdx(i)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="tiles">
                <div className="tile">
                  <div className="tile-cap">{t("fast")}</div>
                  <div className="tile-val" style={{ color: MA_FAST }}>{MA_PRESETS[maIdx].fast}</div>
                </div>
                <div className="tile">
                  <div className="tile-cap">{t("slow")}</div>
                  <div className="tile-val" style={{ color: MA_SLOW }}>{MA_PRESETS[maIdx].slow}</div>
                </div>
              </div>
              <div className="switch-row">
                <span>{t("ema")}</span>
                <Switch on={maMethod === "ema"} onChange={(v) => setMaMethod(v ? "ema" : "sma")} />
              </div>
              <div className="hr" />
              <div className="card-title">{t("panels")}</div>
              <div className="switch-row"><span>{t("volume")}</span><Switch on={showVolume} onChange={setShowVolume} /></div>
              <div className="switch-row"><span>{t("rsi")}</span><Switch on={showRsi} onChange={setShowRsi} /></div>
              <div className="switch-row"><span>{t("macd")}</span><Switch on={showMacd} onChange={setShowMacd} /></div>
              <div className="hr" />
              <div className="switch-row"><span>{t("line_chart")}</span><Switch on={lineChart} onChange={setLineChart} /></div>
              <div className="switch-row"><span>{t("log_scale")}</span><Switch on={logScale} onChange={setLogScale} /></div>
            </div>

            <div className="card">
              <div className="card-title">{t("comparison")}</div>
              <select className="select" value={compareTicker} onChange={onCompareChange}>
                <option value="">{t("none")}</option>
                {COMPARE_INDICES.map((m) => (
                  <optgroup key={m.market} label={m.market}>
                    {m.items.map((it) => (
                      <option key={it.ticker} value={it.ticker}>{it.name} ({it.ticker})</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {compareTicker && (
                <div className="row-end">
                  <button className="tool-btn" onClick={() => setCompareTicker("")}>{t("off")}</button>
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-title">{t("legend")}</div>
              {legendRows.map((r, i) => (
                <div key={i} className="legend-row">
                  <span className="legend-swatch" style={{ color: r.color, fontFamily: FONT_STACK }}>
                    {r.swatch === "arrow" ? r.arrow : "—"}
                  </span>
                  <span className="legend-label">{r.label}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {searchOpen && (
        <SearchDialog lang={lang} onClose={() => setSearchOpen(false)} onPick={onPickSymbol} />
      )}
    </div>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`switch ${on ? "on" : ""}`}
    >
      <span className="knob" />
    </button>
  );
}

interface SearchDialogProps { lang: Lang; onClose: () => void; onPick: (sym: string) => void }

function SearchDialog({ lang, onClose, onPick }: SearchDialogProps) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ symbol: string; name: string; exchange: string; type: string }[]>([]);
  const [status, setStatus] = useState("");
  const t = (k: string) => tr(k, lang);

  function search() {
    const query = q.trim();
    if (!query) return;
    setStatus(t("searching"));
    api.search(query).then((r) => {
      setResults(r.results);
      if (r.results.length === 0) setStatus(t("no_match"));
      else setStatus(t("results_n").replace("{n}", String(r.results.length)));
    }).catch((e) => setStatus(String(e?.message ?? e)));
  }
  function pick() {
    const sel = document.querySelector(".search-dialog tr.sel") as HTMLElement | null;
    const sym = sel?.dataset.row;
    if (sym) { onPick(sym); }
  }
  function copy() {
    const sel = document.querySelector(".search-dialog tr.sel") as HTMLElement | null;
    const sym = sel?.dataset.row;
    if (sym) {
      navigator.clipboard?.writeText(sym);
      setStatus(`Copied: ${sym}`);
    }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal search-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">{t("find_title")}</div>
        <div className="search-row">
          <input
            className="ticker-input"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") search(); }}
            placeholder={t("find_ph")}
          />
          <button className="load-btn" onClick={search}>{t("search")}</button>
        </div>
        <table className="results">
          <thead>
            <tr>
              <th>{t("col_code")}</th>
              <th>{t("col_name")}</th>
              <th>{t("col_exch")}</th>
              <th>{t("col_type")}</th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 && (
              <tr><td colSpan={4} className="empty">{status || t("find_hint")}</td></tr>
            )}
            {results.map((r, _i) => (
              <tr
                key={r.symbol}
                data-row={r.symbol}
                tabIndex={0}
                onClick={(e) => {
                  (e.currentTarget.parentElement?.querySelectorAll("tr") ?? []).forEach((x) => x.classList.remove("sel"));
                  e.currentTarget.classList.add("sel");
                }}
                onDoubleClick={pick}
              >
                <td className="sym">{r.symbol}</td>
                <td>{r.name}</td>
                <td>{r.exchange}</td>
                <td>{r.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="status">{status}</div>
        <div className="modal-foot">
          <button className="tool-btn" onClick={copy}>{t("copy_code")}</button>
          <button className="tool-btn" onClick={onClose}>{t("close")}</button>
          <button className="load-btn" onClick={pick}>{t("use_in_chart")}</button>
        </div>
      </div>
    </div>
  );
}

interface ChartMountProps {
  data: OhlcResponse | null;
  compare: CompareData | null;
  showVolume: boolean;
  showRsi: boolean;
  showMacd: boolean;
  maFast: number;
  maSlow: number;
  maMethod: "sma" | "ema";
  logScale: boolean;
  lineChart: boolean;
  onHover: (date: string | null) => void;
}

function ChartMount(props: ChartMountProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  // Mount once. The Chart class internally handles all re-renders via update().
  useEffect(() => {
    if (!ref.current) return;
    try {
      const c = new Chart(ref.current);
      chartRef.current = c;
      c.setHoverHandler((d) => props.onHover(d));
    } catch (e) {
      console.error("[ChartMount] constructor failed:", e);
      throw e;
    }
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push every prop change through the single update() method.
  useEffect(() => {
    chartRef.current?.update({
      data: props.data,
      compare: props.compare,
      showVolume: props.showVolume,
      showRsi: props.showRsi,
      showMacd: props.showMacd,
      maFast: props.maFast,
      maSlow: props.maSlow,
      maMethod: props.maMethod,
      logScale: props.logScale,
      lineChart: props.lineChart,
    });
  }, [
    props.data, props.compare, props.showVolume, props.showRsi, props.showMacd,
    props.maFast, props.maSlow, props.maMethod, props.logScale, props.lineChart,
  ]);

  return <div ref={ref} className="chart-pane chart-price" />;
}
