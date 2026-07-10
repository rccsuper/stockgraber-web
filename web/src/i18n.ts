/* Tiny bilingual dictionary — English + Traditional Chinese, mirroring the
 * desktop app. Default to English; users can flip with the header button. */

export type Lang = "en" | "zh";

export const TR: Record<string, Record<Lang, string>> = {
  load:           { en: "Load",        zh: "載入" },
  find:           { en: "🔍 Find",     zh: "🔍 搜尋" },
  find_tip:       { en: "Find a stock code by company name", zh: "以公司名稱搜尋股票代碼" },
  reset:          { en: "Reset",       zh: "重設" },
  exit:           { en: "✕  Exit",     zh: "✕  退出" },
  lang_btn:       { en: "中文",        zh: "EN" },
  lang_tip:       { en: "Switch language (English / 繁體中文)", zh: "切換語言（English / 繁體中文）" },
  off:            { en: "Off",         zh: "關閉" },
  ma_crossover:   { en: "MA CROSSOVER", zh: "移動平均交叉" },
  comparison:     { en: "COMPARISON",  zh: "比較" },
  legend:         { en: "LEGEND",      zh: "圖例" },
  date_range:     { en: "DATE RANGE",  zh: "日期範圍" },
  panels:         { en: "PANELS",      zh: "面板" },
  fast:           { en: "FAST",        zh: "快線" },
  slow:           { en: "SLOW",        zh: "慢線" },
  ema:            { en: "Exponential (EMA)", zh: "指數平均 (EMA)" },
  volume:         { en: "Volume",      zh: "成交量" },
  rsi:            { en: "RSI (14)",    zh: "RSI (14)" },
  macd:           { en: "MACD (12,26,9)", zh: "MACD (12,26,9)" },
  line_chart:     { en: "Line chart",  zh: "線圖" },
  log_scale:      { en: "Log scale",   zh: "對數刻度" },
  from:           { en: "FROM",        zh: "由" },
  to:             { en: "TO",          zh: "至" },
  daily_close:    { en: "Daily close", zh: "每日收市價" },
  golden_cross:   { en: "Golden cross", zh: "黃金交叉" },
  death_cross:    { en: "Death cross", zh: "死亡交叉" },
  rebased:        { en: "rebased",     zh: "重新基準" },
  find_title:     { en: "Find a stock code", zh: "搜尋股票代碼" },
  find_ph:        { en: "Company name or ticker — e.g. apple, tencent, hsbc", zh: "公司名稱或代碼 — 例如 apple、tencent、hsbc" },
  search:         { en: "Search",      zh: "搜尋" },
  col_code:       { en: "Code",        zh: "代碼" },
  col_name:       { en: "Name",        zh: "名稱" },
  col_exch:       { en: "Exchange",    zh: "交易所" },
  col_type:       { en: "Type",        zh: "類型" },
  use_in_chart:   { en: "Use in chart", zh: "套用至圖表" },
  copy_code:      { en: "Copy code",   zh: "複製代碼" },
  close:          { en: "Close",       zh: "關閉" },
  find_hint:      { en: "Type a name or ticker and press Search.", zh: "輸入名稱或代碼後按搜尋。" },
  searching:      { en: "Searching…",  zh: "搜尋中…" },
  no_match:       { en: "No matches.", zh: "沒有符合的結果。" },
  load_failed:    { en: "Load failed", zh: "載入失敗" },
  invalid_range:  { en: "Invalid range", zh: "日期範圍無效" },
  invalid_range_msg: { en: "The 'To' date is before the 'From' date.", zh: "「至」日期早於「由」日期。" },
  vol_lbl:        { en: "Volume",      zh: "成交量" },
  loading:        { en: "Loading…",    zh: "載入中…" },
};

export function tr(key: string, lang: Lang): string {
  const e = TR[key];
  if (!e) return key;
  return e[lang] ?? e.en ?? key;
}
