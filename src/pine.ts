// Execute Pine Script over supplied OHLCV candles via PineTS and return the
// plotted series in a chart-ready shape. This module is the only place that
// touches the AGPL PineTS runtime; everything the caller sees is plain JSON.
import { PineTS } from "pinets";

/** A candle as the frontend sends it: `time` is UNIX SECONDS. */
export interface InputCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PlotPoint {
  /** UNIX SECONDS (lightweight-charts UTCTimestamp). */
  time: number;
  value: number;
  /** Per-bar colour when the plot's `color=` varies (e.g. SuperTrend); null
   *  when the bar carried no colour. The UI segments the line by this. */
  color?: string | null;
}

export interface PlotSeries {
  name: string;
  /** Hex colour Pine assigned (e.g. "#2196F3"), or null to let the UI pick. */
  color: string | null;
  data: PlotPoint[];
}

export interface RunResult {
  ok: boolean;
  /** True => plots belong on the price pane; false => their own oscillator pane. */
  overlay: boolean;
  plots: PlotSeries[];
  warnings: string[];
  error?: string;
}

const MAX_CANDLES = 6000;
const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * Pine's `indicator(...)` defaults to overlay=false (its own pane) and
 * `strategy(...)` defaults to overlay=true (on price). An explicit
 * `overlay=true|false` argument, when present, wins.
 */
function detectOverlay(source: string): boolean {
  const m = source.match(/overlay\s*=\s*(true|false)/i);
  if (m) return m[1]!.toLowerCase() === "true";
  return /\bstrategy\s*\(/.test(source);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Pine execution timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

function isDrawingKey(name: string): boolean {
  return name.startsWith("__") && name.endsWith("__");
}

/** Run `source` over `candles`; never throws — failures come back as ok:false. */
export async function runPine(
  source: string,
  candles: InputCandle[],
  opts: { timeoutMs?: number } = {},
): Promise<RunResult> {
  const warnings: string[] = [];

  if (typeof source !== "string" || source.trim().length === 0) {
    return { ok: false, overlay: false, plots: [], warnings, error: "Empty Pine source." };
  }
  if (!Array.isArray(candles) || candles.length === 0) {
    return { ok: false, overlay: false, plots: [], warnings, error: "No candles supplied." };
  }
  if (candles.length > MAX_CANDLES) {
    warnings.push(`Truncated to the last ${MAX_CANDLES} candles.`);
    candles = candles.slice(-MAX_CANDLES);
  }

  // PineTS wants oldest→newest with `openTime` in milliseconds.
  const pineCandles = candles.map((c) => ({
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    openTime: Math.round(c.time * 1000),
  }));

  let result: any;
  try {
    // The candles-array constructor form is untyped in pinets, hence the cast.
    const pineTS = new (PineTS as any)(pineCandles);
    result = await withTimeout(pineTS.run(source), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  } catch (e) {
    const error = e instanceof Error ? e.message : "Pine execution failed.";
    return { ok: false, overlay: detectOverlay(source), plots: [], warnings, error };
  }

  const plotsObj: Record<string, any> = result?.plots ?? {};
  const plots: PlotSeries[] = [];

  for (const [name, series] of Object.entries(plotsObj)) {
    if (isDrawingKey(name)) continue; // labels/lines/boxes/tables — not line plots
    const raw: any[] = Array.isArray(series?.data) ? series.data : Array.isArray(series) ? series : [];
    if (raw.length === 0) continue;

    let color: string | null = null;
    const byTime = new Map<number, { value: number; color: string | null }>();
    for (const pt of raw) {
      const c = typeof pt?.options?.color === "string" ? pt.options.color : null;
      if (color == null && c) color = c;
      const tMs = typeof pt?.time === "number" ? pt.time : null;
      const v = typeof pt?.value === "number" ? pt.value : null;
      if (tMs == null || v == null || !Number.isFinite(v)) continue;
      byTime.set(Math.floor(tMs / 1000), { value: v, color: c }); // last write wins per bar
    }
    if (byTime.size === 0) continue;

    const data = Array.from(byTime, ([time, o]) => ({
      time,
      value: o.value,
      color: o.color,
    })).sort((a, b) => a.time - b.time);
    plots.push({ name, color, data });
  }

  const rawWarnings = result?.warnings;
  if (Array.isArray(rawWarnings)) {
    for (const w of rawWarnings) {
      const msg = typeof w === "string" ? w : w?.message;
      if (msg) warnings.push(String(msg));
    }
  }

  if (plots.length === 0 && !warnings.length) {
    warnings.push("The script produced no plottable series (only labels/tables/shapes, or all values were na).");
  }

  return { ok: true, overlay: detectOverlay(source), plots, warnings };
}
