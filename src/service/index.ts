#!/usr/bin/env bun
/**
 * pine-runner — executes Pine Script over supplied OHLCV candles and returns
 * the plotted series as JSON. Wraps PineTS (AGPL-3.0). Because this program
 * links PineTS, it is itself AGPL-3.0 and its source is offered to network
 * users (see SOURCE_URL / the X-Source-Repository header); callers talk to it
 * only over this HTTP boundary, so nothing on the other side is affected.
 */
import { timingSafeEqual } from "node:crypto";
import { runPine, type InputCandle } from "../pine.ts";

const SERVICE_NAME = "pine-runner";
const DEFAULT_PORT = 8085;
const SOURCE_URL =
  process.env.SOURCE_URL?.trim() || "https://github.com/GAIINAPP/pine_runner";

function port(): number {
  const p = Number.parseInt(process.env.PORT ?? "", 10);
  return Number.isFinite(p) && p > 0 ? p : DEFAULT_PORT;
}

function json(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // AGPL §13: point network users at the corresponding source.
      "x-source-repository": SOURCE_URL,
      ...init.headers,
    },
  });
}

/** Constant-time check of the shared service-to-service secret. */
function authorized(request: Request): boolean {
  const secret = process.env.SAMWISE_INTERNAL_SECRET || process.env.INTERNAL_API_SECRET;
  if (!secret) return true; // fail-open until the secret is set on both sides
  const provided = request.headers.get("x-internal-auth") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function validCandles(v: unknown): v is InputCandle[] {
  return (
    Array.isArray(v) &&
    v.every(
      (c) =>
        c &&
        typeof c === "object" &&
        ["time", "open", "high", "low", "close", "volume"].every(
          (k) => typeof (c as Record<string, unknown>)[k] === "number",
        ),
    )
  );
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/health")) {
    return json({ status: "ok", service: SERVICE_NAME, source: SOURCE_URL });
  }
  if (request.method === "GET" && url.pathname === "/source") {
    return json({ service: SERVICE_NAME, source: SOURCE_URL, license: "AGPL-3.0-only" });
  }

  if (!authorized(request)) {
    return json({ status: "error", service: SERVICE_NAME, error: "Unauthorized" }, { status: 401 });
  }

  if (request.method === "POST" && url.pathname === "/run") {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
    }
    const source = typeof body?.source === "string" ? body.source : "";
    if (!source.trim()) {
      return json({ ok: false, error: 'Field "source" (Pine code) is required.' }, { status: 400 });
    }
    if (!validCandles(body?.candles)) {
      return json(
        { ok: false, error: 'Field "candles" must be an array of {time,open,high,low,close,volume}.' },
        { status: 400 },
      );
    }
    const result = await runPine(source, body.candles, {
      timeoutMs: typeof body?.timeoutMs === "number" ? body.timeoutMs : undefined,
    });
    return json(result, { status: result.ok ? 200 : 200 });
  }

  return json({ status: "error", service: SERVICE_NAME, error: "Not found." }, { status: 404 });
}

const server = Bun.serve({ hostname: "0.0.0.0", port: port(), fetch: handle });
console.log(`${SERVICE_NAME} listening on http://${server.hostname}:${server.port} (source: ${SOURCE_URL})`);

export { handle };
