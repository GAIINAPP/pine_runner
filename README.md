# pine-runner

A tiny standalone HTTP service that executes **Pine Script** over OHLCV candles
you supply and returns the plotted series as JSON, ready to draw on a chart.

It exists so the GAIIN platform can *run* generated Pine (not just show the
code) without embedding a Pine runtime in the proprietary app. It wraps
[PineTS](https://github.com/LuxAlgo/PineTS) by LuxAlgo.

## Why it is a separate service (licensing)

PineTS is **AGPL-3.0**. This service links PineTS, so **this service is also
AGPL-3.0** and its source is published here. Everything else in the platform
talks to it only over the HTTP boundary below (JSON in, JSON out), which is an
arm's-length interface, so no other codebase is affected by the copyleft.
Per AGPL §13 the source is advertised to network users via the
`X-Source-Repository` response header and `GET /source`.

## API

### `GET /healthz`
Liveness. Open (no auth). `{ status: "ok", service, source }`.

### `GET /source`
The AGPL source pointer. `{ service, source, license }`.

### `POST /run`
Gated by `X-Internal-Auth` when `SAMWISE_INTERNAL_SECRET` is set.

Request:
```json
{
  "source": "//@version=6\nindicator(\"EMA\", overlay=true)\nplot(ta.ema(close, 21))",
  "candles": [{ "time": 1704067200, "open": 100, "high": 105, "low": 99, "close": 103, "volume": 1000 }]
}
```
`time` is **UNIX SECONDS** (lightweight-charts style).

Response:
```json
{
  "ok": true,
  "overlay": true,
  "plots": [
    { "name": "EMA", "color": "#2196F3", "data": [{ "time": 1704067200, "value": 101.2 }] }
  ],
  "warnings": []
}
```
- `overlay` — `true` => draw on the price pane; `false` => a separate oscillator pane.
- On failure: `{ "ok": false, "error": "...", "warnings": [...] }` (still HTTP 200).

## Run locally

```bash
bun install
bun run src/service/index.ts   # listens on :8085
```

## Notes / hardening

- Execution has a per-request timeout (default 12s) and a candle cap. Because
  PineTS transpiles Pine to JS and evaluates it, run this container
  unprivileged, with tight CPU/memory limits and no outbound network (candles
  are always supplied in the request; the built-in data providers are unused).
- Only `plot()` line series are returned today. Drawing objects (labels, lines,
  boxes, tables, shapes) are ignored.
