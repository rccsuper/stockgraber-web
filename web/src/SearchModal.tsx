/* Modal dialog for looking up ticker codes by company name. */
import { useEffect, useRef, useState } from "react";
import { api, type SearchResult } from "./api";
import { tr, type Lang } from "./i18n";

export function SearchModal(props: {
  lang: Lang;
  onPick: (symbol: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState(tr("find_hint", props.lang));
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function runSearch() {
    const qq = q.trim();
    if (!qq || busy) return;
    setBusy(true);
    setStatus(tr("searching", props.lang));
    try {
      const r = await api.search(qq);
      setResults(r.results);
      setStatus(r.results.length ? `${r.count} result(s)` : tr("no_match", props.lang));
    } catch (e) {
      setStatus("Search failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function pick() {
    const sel = (document.activeElement as HTMLElement)?.getAttribute("data-row");
    let sym = sel || (results[0]?.symbol ?? null);
    if (!sym) return;
    props.onPick(sym);
  }

  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{tr("find_title", props.lang)}</div>
        <div className="modal-row">
          <input
            ref={inputRef}
            className="input"
            placeholder={tr("find_ph", props.lang)}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
          />
          <button className="btn btn-primary" onClick={runSearch} disabled={busy}>
            {tr("search", props.lang)}
          </button>
        </div>
        <table className="results">
          <thead>
            <tr>
              <th>{tr("col_code", props.lang)}</th>
              <th>{tr("col_name", props.lang)}</th>
              <th>{tr("col_exch", props.lang)}</th>
              <th>{tr("col_type", props.lang)}</th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--mut)", padding: 24 }}>{status}</td></tr>
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
                <td style={{ color: "var(--accent)", fontWeight: 600 }}>{r.symbol}</td>
                <td>{r.name}</td>
                <td>{r.exchange}</td>
                <td>{r.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ color: "var(--mut)", fontSize: 12, marginTop: 8 }}>{status}</div>
        <div className="modal-actions">
          <button
            className="btn btn-ghost"
            onClick={() => {
              const sel = document.querySelector("tr.sel") as HTMLElement | null;
              if (sel) navigator.clipboard?.writeText(sel.getAttribute("data-row") || "");
            }}
          >
            {tr("copy_code", props.lang)}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={props.onClose}>{tr("close", props.lang)}</button>
          <button className="btn btn-primary" onClick={pick}>{tr("use_in_chart", props.lang)}</button>
        </div>
      </div>
    </div>
  );
}
