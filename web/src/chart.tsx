/* Multi-pane chart built on TradingView lightweight-charts v5.
 *
 * Public surface used by App.tsx:
 *   const chart = new Chart(container, { up, down, ... });
 *   chart.setData({ dates, open, high, low, close, volume, indicators, crosses });
 *   chart.setVisibleRange(from, to);          // optional zoom
 *   chart.setShowPanels({ volume, rsi, macd });
 *   chart.setLogScale(flag);
 *   chart.setCompareData(indexData | null);   // null reverts to candles
 *   chart.onHover(cb);                       // (date | null) => void
 *   chart.destroy();
 *
 * Four synchronized panes share one time scale: price, volume, RSI, MACD.
 */

import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
  createChart,
  createSeriesMarkers,
} from "lightweight-charts";

const T = {
  bg: "#050506",
  fg: "#3a3f4b",
  grid: "#0e0e12",
  up: "#22c98a",
  down: "#f6465d",
  maFast: "#4f8cff",
  maSlow: "#f3a13a",
  compare: "#22d3ee",
  volUp: "rgba(34,201,138,0.55)",
  volDown: "rgba(246,70,93,0.55)",
  yellow: "#ffff00",
  text: "#e8eaed",
  muted: "#8a909a",
};

const FONT = "JetBrains Mono, Consolas, monospace";

type Ohlcv = {
  dates: string[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: (number | null)[];
  indicators: {
    rsi: (number | null)[];
    macd: { line: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] };
    ma: { fast: (number | null)[]; slow: (number | null)[]; method: string };
    crosses: { golden: { date: string; price: number }[]; death: { date: string; price: number }[] };
  };
};

export type CompareData = { indexName: string; dates: string[]; close: number[] };

export class Chart {
  private container: HTMLElement;
  private priceChart: IChartApi;
  private volChart: IChartApi;
  private rsiChart: IChartApi;
  private macdChart: IChartApi;

  // Series (recreated on data change to keep state clean).
  private priceSeries: ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | ISeriesApi<"Area"> | null = null;
  private maFast: ISeriesApi<"Line"> | null = null;
  private maSlow: ISeriesApi<"Line"> | null = null;
  private crossMarkers: import("lightweight-charts").ISeriesMarkersPluginApi<Time> | null = null;

  private volSeries: ISeriesApi<"Histogram"> | null = null;
  private rsiSeries: ISeriesApi<"Line"> | null = null;
  private macdLine: ISeriesApi<"Line"> | null = null;
  private macdSignal: ISeriesApi<"Line"> | null = null;
  private macdHist: ISeriesApi<"Histogram"> | null = null;

  private compare: CompareData | null = null;
  private compareSeries: ISeriesApi<"Area"> | null = null;
  private compareIndex: ISeriesApi<"Line"> | null = null;
  private compareMaFast: ISeriesApi<"Line"> | null = null;
  private compareMaSlow: ISeriesApi<"Line"> | null = null;

  private data: Ohlcv | null = null;
  private logScale = false;
  private lineChart = false;
  private syncing = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private hoverCb: ((d: string | null) => void) | null = null;

  private rafPending = false;
  private lastHoverTime: string | number | null = null;
  private readonly onMouseLeave = () => this.clearHover();

  constructor(container: HTMLElement) {
    this.container = container;
    container.style.display = "grid";
    container.style.gridTemplateRows = "minmax(0, 6fr) minmax(0, 2fr) minmax(0, 2fr) minmax(0, 3fr)";
    container.style.gap = "10px";
    container.style.height = "100%";

    const baseOpts = {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: T.bg },
        textColor: T.muted,
        fontSize: 11,
        fontFamily: FONT,
      },
      grid: {
        vertLines: { color: T.grid },
        horzLines: { color: T.grid },
      },
      rightPriceScale: { borderColor: T.fg },
      timeScale: {
        borderColor: T.fg,
        timeVisible: false,
        secondsVisible: false,
      },
      crosshair: {
        mode: 0,
        vertLine: { color: "#6a707a", width: 1 as 1, style: 3 },
        horzLine: { color: "#6a707a", width: 1 as 1, style: 3 },
      },
    };

    this.priceChart = createChart(this.makePane(container, "Price"), baseOpts);
    this.volChart = createChart(this.makePane(container, "Volume"), baseOpts);
    this.rsiChart = createChart(this.makePane(container, "RSI · 14"), baseOpts);
    this.macdChart = createChart(this.makePane(container, "MACD · 12,26,9"), baseOpts);

    // RSI 30/70 band via two constant lines.
    this.rsiChart.addSeries(LineSeries, {
      color: "rgba(120,123,134,0.4)",
      lineWidth: 1 as 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    }).setData([
      { time: 0 as Time, value: 70 },
      { time: 1e15 as Time, value: 70 },
    ]);
    this.rsiChart.addSeries(LineSeries, {
      color: "rgba(120,123,134,0.4)",
      lineWidth: 1 as 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    }).setData([
      { time: 0 as Time, value: 30 },
      { time: 1e15 as Time, value: 30 },
    ]);

    // Share the time scale between panes. The visible-range subscriptions fire
    // asynchronously (next frame), so a brief timed lock — not just a synchronous
    // flag — is needed to stop the programmatic propagation from echoing back and
    // clobbering fitContent().
    const lock = () => {
      this.syncing = true;
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => { this.syncing = false; }, 60);
    };
    this.volChart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (r && !this.syncing) {
        lock();
        this.priceChart.timeScale().setVisibleLogicalRange(r);
      }
    });
    this.rsiChart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (r && !this.syncing) {
        lock();
        this.priceChart.timeScale().setVisibleLogicalRange(r);
      }
    });
    this.macdChart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (r && !this.syncing) {
        lock();
        this.priceChart.timeScale().setVisibleLogicalRange(r);
      }
    });
    this.priceChart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (r && !this.syncing) {
        lock();
        this.volChart.timeScale().setVisibleLogicalRange(r);
        this.rsiChart.timeScale().setVisibleLogicalRange(r);
        this.macdChart.timeScale().setVisibleLogicalRange(r);
      }
    });

    // Forward hover to the consumer. The panes are separate charts separated
    // by a grid gap; crossing that gap fires a null-time crosshair move on the
    // pane being left. Forwarding those nulls would unmount/remount the OHLC
    // box and thrash layout on every crossing, so only real time hits are
    // forwarded and the hover is cleared once via container mouseleave.
    const forwardTime = (p: { time?: unknown }) => {
      if (p.time != null) this.handleHover(p.time as number | string);
    };
    this.priceChart.subscribeCrosshairMove(forwardTime);
    this.volChart.subscribeCrosshairMove(forwardTime);
    this.rsiChart.subscribeCrosshairMove(forwardTime);
    this.macdChart.subscribeCrosshairMove(forwardTime);
    this.container.addEventListener("mouseleave", this.onMouseLeave);
  }

  private makePane(parent: HTMLElement, _label: string): HTMLElement {
    const div = document.createElement("div");
    div.style.background = T.bg;
    div.style.border = "1px solid rgba(255,255,255,0.06)";
    div.style.borderRadius = "12px";
    div.style.overflow = "hidden";
    div.style.minHeight = "0";
    parent.appendChild(div);
    return div;
  }

  private handleHover(t: number | string) {
    // Business days come in as a unix timestamp string (YYYY-MM-DD); find the
    // matching row. We debounce by frame so we don't fire on every micro-tick.
    if (this.lastHoverTime === t) return;
    this.lastHoverTime = t;
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      if (!this.data || this.lastHoverTime === null) return;
      const tNorm = this.lastHoverTime;
      let date: string | null = null;
      if (typeof tNorm === "number") {
        // Convert unix seconds to YYYY-MM-DD.
        date = new Date(tNorm * 1000).toISOString().slice(0, 10);
      } else {
        date = tNorm;
      }
      if (this.data.dates.includes(date) && this.hoverCb) this.hoverCb(date);
    });
  }

  private clearHover() {
    this.rafPending = false;
    this.lastHoverTime = null;
    if (this.hoverCb) this.hoverCb(null);
  }

  onHover(cb: (d: string | null) => void) {
    this.hoverCb = cb;
  }

  setHoverHandler(cb: (d: string | null) => void) {
    this.hoverCb = cb;
  }

  /** Apply a full set of props in one call. We diff on data/compare/method and
   * only re-render the panes that actually changed — but for the data volumes
   * involved (a few hundred bars) the simpler "always re-render price" is fast
   * enough and keeps the logic obvious. */
  update(p: {
    data: Ohlcv | null;
    compare: CompareData | null;
    showPrice?: boolean;
    showVolume?: boolean;
    showRsi?: boolean;
    showMacd?: boolean;
    maFast?: number;
    maSlow?: number;
    maMethod?: "sma" | "ema";
    lineChart?: boolean;
    logScale?: boolean;
  }) {
    this.data = p.data;
    this.compare = p.compare;
    this.logScale = !!p.logScale;
    this.lineChart = !!p.lineChart;
    if (p.data) {
      this.renderPrice();
      this.renderVolume();
      this.renderRsi();
      this.renderMacd();
      this.priceChart.timeScale().fitContent();
    }
    this.setShowPanels({
      volume: p.showVolume !== false,
      rsi: p.showRsi !== false,
      macd: p.showMacd !== false,
    });
    this.setLogScale(this.logScale);
  }

  setData(o: Ohlcv) {
    this.data = o;
    this.renderPrice();
    this.renderVolume();
    this.renderRsi();
    this.renderMacd();
    this.priceChart.timeScale().fitContent();
  }

  setCompareData(c: CompareData | null) {
    this.compare = c;
    this.renderPrice();
  }

  setShowPanels(p: { volume: boolean; rsi: boolean; macd: boolean }) {
    const panes = this.container.children;
    // 0: price (always visible), 1: volume, 2: rsi, 3: macd
    const vis = {
      vol: p.volume !== false,
      rsi: p.rsi !== false,
      macd: p.macd !== false,
    };
    (panes[1] as HTMLElement).style.display = vis.vol ? "" : "none";
    (panes[2] as HTMLElement).style.display = vis.rsi ? "" : "none";
    (panes[3] as HTMLElement).style.display = vis.macd ? "" : "none";
    // Rebuild the grid rows so hidden panes release their track space and the
    // remaining charts (especially price) grow to fill it. Tracks follow DOM
    // order: price, volume, rsi, macd.
    const rows: string[] = ["minmax(0, 6fr)"];
    if (vis.vol) rows.push("minmax(0, 2fr)");
    if (vis.rsi) rows.push("minmax(0, 2fr)");
    if (vis.macd) rows.push("minmax(0, 3fr)");
    this.container.style.gridTemplateRows = rows.join(" ");
  }

  setLogScale(flag: boolean) {
    this.logScale = flag;
    if (this.priceChart.priceScale("right")) {
      this.priceChart.priceScale("right").applyOptions({
        mode: flag ? 1 : 0,
      });
    }
  }

  setVisibleRange(from: number, to: number) {
    if (!this.data) return;
    const n = this.data.dates.length;
    if (n === 0) return;
    const f = Math.max(0, Math.min(from, n - 1));
    const t = Math.max(f, Math.min(to, n - 1));
    this.priceChart.timeScale().setVisibleLogicalRange({ from: f, to: t });
  }

  fitContent() {
    this.priceChart.timeScale().fitContent();
  }

  destroy() {
    this.container.removeEventListener("mouseleave", this.onMouseLeave);
    this.priceChart.remove();
    this.volChart.remove();
    this.rsiChart.remove();
    this.macdChart.remove();
    this.container.innerHTML = "";
  }

  // ---- per-pane renderers ----

  private clearSeries() {
    for (const s of [this.priceSeries, this.maFast, this.maSlow, this.compareSeries, this.compareIndex, this.compareMaFast, this.compareMaSlow]) {
      if (s) {
        try { this.priceChart.removeSeries(s); } catch {}
      }
    }
    if (this.crossMarkers) { try { this.crossMarkers.setMarkers([]); } catch {} }
    this.priceSeries = this.maFast = this.maSlow = null;
    this.compareSeries = this.compareIndex = this.compareMaFast = this.compareMaSlow = null;
  }

  private renderPrice() {
    if (!this.data) return;
    this.clearSeries();
    const { dates, open, high, low, close, indicators } = this.data;
    const times: Time[] = dates as unknown as Time[];

    const fast = indicators.ma.fast;
    const slow = indicators.ma.slow;

    if (this.compare) {
      this.renderPercent(times, close, fast, slow);
    } else if (this.lineChart) {
      this.priceSeries = this.priceChart.addSeries(LineSeries, {
        color: T.up,
        lineWidth: 2 as 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      this.priceSeries.setData(times.map((t, i) => ({ time: t, value: close[i] })));
    } else {
      this.priceSeries = this.priceChart.addSeries(CandlestickSeries, {
        upColor: T.up,
        downColor: T.down,
        wickUpColor: T.up,
        wickDownColor: T.down,
        borderVisible: false,
      });
      this.priceSeries.setData(
        times.map((t, i) => ({
          time: t,
          open: open[i],
          high: high[i],
          low: low[i],
          close: close[i],
        })),
      );
    }

    this.maFast = this.priceChart.addSeries(LineSeries, { color: T.maFast, lineWidth: 1 as 1, priceLineVisible: false });
    this.maFast.setData(times.flatMap((t, i) => fast[i] == null ? [] : [{ time: t, value: fast[i] as number }]));
    this.maSlow = this.priceChart.addSeries(LineSeries, { color: T.maSlow, lineWidth: 1 as 1, priceLineVisible: false });
    this.maSlow.setData(times.flatMap((t, i) => slow[i] == null ? [] : [{ time: t, value: slow[i] as number }]));

    // Golden / death cross arrows on the price series.
    if (this.priceSeries) {
      const dateToTs = (s: string) => Math.floor(new Date(s + "T00:00:00Z").getTime() / 1000);
            const markers: import("lightweight-charts").SeriesMarker<Time>[] = [];
      for (const g of indicators.crosses.golden) {
        markers.push({ time: dateToTs(g.date) as Time, position: "belowBar", color: T.up, shape: "arrowUp", text: "" });
      }
      for (const d of indicators.crosses.death) {
        markers.push({ time: dateToTs(d.date) as Time, position: "aboveBar", color: T.down, shape: "arrowDown", text: "" });
      }
      markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      this.crossMarkers = createSeriesMarkers(this.priceSeries, markers);
    }
  }

  private renderPercent(times: Time[], close: number[], fast: (number | null)[], slow: (number | null)[]) {
    if (!this.compare) return;
    const stock = close;
    const idxClose = this.compare.close;
    const idxDates = this.compare.dates;

    // Map index closes by date for lookup.
    const idxMap = new Map<string, number>();
    for (let i = 0; i < idxDates.length; i++) idxMap.set(idxDates[i], idxClose[i]);

    // Align to the visible window start (leftmost date in `times`).
    const baseDate = times[0] as unknown as string;
    const baseS = stock[0];
    let baseI = idxMap.get(baseDate);
    if (baseI == null) {
      // Fallback: nearest earlier index date.
      for (let i = idxDates.length - 1; i >= 0; i--) {
        if (idxDates[i] <= baseDate) { baseI = idxClose[i]; break; }
      }
      if (baseI == null) baseI = idxClose[0];
    }

    const pct = (s: number, b: number) => (b === 0 ? 0 : (s / b - 1) * 100);

    const stockPct: { time: Time; value: number }[] = [];
    const idxPct: { time: Time; value: number }[] = [];
    const maFPct: { time: Time; value: number }[] = [];
    const maSPct: { time: Time; value: number }[] = [];
    for (let i = 0; i < times.length; i++) {
      const date = times[i] as unknown as string;
      stockPct.push({ time: times[i], value: pct(stock[i], baseS) });
      const iv = idxMap.get(date);
      if (iv != null) idxPct.push({ time: times[i], value: pct(iv, baseI) });
      if (fast[i] != null) maFPct.push({ time: times[i], value: pct(fast[i] as number, baseS) });
      if (slow[i] != null) maSPct.push({ time: times[i], value: pct(slow[i] as number, baseS) });
    }

    this.compareSeries = this.priceChart.addSeries(AreaSeries, {
      lineColor: T.maFast,
      topColor: "rgba(31,111,235,0.30)",
      bottomColor: "rgba(31,111,235,0.02)",
      lineWidth: 1 as 1,
      priceLineVisible: false,
    });
    this.compareSeries.setData(stockPct);

    this.compareIndex = this.priceChart.addSeries(LineSeries, {
      color: T.compare,
      lineWidth: 1 as 1,
      priceLineVisible: false,
    });
    this.compareIndex.setData(idxPct);

    this.compareMaFast = this.priceChart.addSeries(LineSeries, {
      color: "#ef4444",
      lineWidth: 1 as 1,
      priceLineVisible: false,
    });
    this.compareMaFast.setData(maFPct);

    this.compareMaSlow = this.priceChart.addSeries(LineSeries, {
      color: "#7fb8ff",
      lineWidth: 1 as 1,
      priceLineVisible: false,
    });
    this.compareMaSlow.setData(maSPct);
  }

  private renderVolume() {
    if (this.volSeries) { try { this.volChart.removeSeries(this.volSeries); } catch {} }
    if (!this.data) return;
    const { dates, open, close, volume } = this.data;
    this.volSeries = this.volChart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceLineVisible: false,
    });
    this.volSeries.setData(
      dates.map((d, i) => ({
        time: d as unknown as Time,
        value: volume[i] ?? 0,
        color: close[i] >= open[i] ? T.volUp : T.volDown,
      })),
    );
  }

  private renderRsi() {
    if (this.rsiSeries) { try { this.rsiChart.removeSeries(this.rsiSeries); } catch {} }
    if (!this.data) return;
    const { dates, indicators } = this.data;
    this.rsiSeries = this.rsiChart.addSeries(LineSeries, {
      color: T.maFast,
      lineWidth: 1 as 1,
      priceLineVisible: false,
    });
    this.rsiSeries.setData(
      dates.flatMap((d, i) => indicators.rsi[i] == null ? [] : [{ time: d as unknown as Time, value: indicators.rsi[i] as number }]),
    );
  }

  private renderMacd() {
    for (const s of [this.macdLine, this.macdSignal, this.macdHist]) {
      if (s) { try { this.macdChart.removeSeries(s); } catch {} }
    }
    if (!this.data) return;
    const { dates, indicators } = this.data;
    const m = indicators.macd;
    this.macdLine = this.macdChart.addSeries(LineSeries, { color: T.maFast, lineWidth: 1 as 1, priceLineVisible: false });
    this.macdLine.setData(dates.flatMap((d, i) => m.line[i] == null ? [] : [{ time: d as unknown as Time, value: m.line[i] as number }]));
    this.macdSignal = this.macdChart.addSeries(LineSeries, { color: T.maSlow, lineWidth: 1 as 1, priceLineVisible: false });
    this.macdSignal.setData(dates.flatMap((d, i) => m.signal[i] == null ? [] : [{ time: d as unknown as Time, value: m.signal[i] as number }]));
    this.macdHist = this.macdChart.addSeries(HistogramSeries, { priceLineVisible: false });
    this.macdHist.setData(
      dates.map((d, i) => ({
        time: d as unknown as Time,
        value: m.histogram[i] ?? 0,
        color: (m.histogram[i] ?? 0) >= 0 ? T.up : T.down,
      })),
    );
  }
}
