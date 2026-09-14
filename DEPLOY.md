# Deploying pine-runner

A tiny Bun service that runs Pine Script over supplied candles and returns the
plotted series. It sits on the VM next to the other tool services, behind an
nginx path, and the frontend reaches it through the `/api/pine/run` proxy.

`<VM_HOST>` below is the same host used by `BACKEND_URL` in
`gaiin-frontend/apphosting.yaml`.

## 1. Repo

Already created and public: **https://github.com/GAIINAPP/pine_runner**
(AGPL-3.0, holds no proprietary logic). Public visibility satisfies AGPL §13:
network users can reach the source, which the service also advertises via
`GET /source` and the `X-Source-Repository` header.

To push later updates:

```bash
cd services/pine_runner
git add -A && git commit -m "..." && git push
```

## 2. Build + run on the VM

Copy the folder to the VM (or `git clone` it there), then:

```bash
cd pine_runner
docker build -t pine-runner .

docker run -d --name pine-runner --restart unless-stopped \
  -p 127.0.0.1:8085:8085 \
  -e PORT=8085 \
  -e SAMWISE_INTERNAL_SECRET="<same secret the frontend/tools use>" \
  -e SOURCE_URL="https://github.com/GAIINAPP/pine_runner" \
  --memory=512m --cpus=1 \
  --security-opt no-new-privileges \
  pine-runner
```

Hardening (recommended): the service never needs the internet (candles are
passed in every request), so cut its egress, e.g. run it on an internal-only
docker network, or add firewall rules. The container already runs as the
unprivileged `bun` user and has a per-request timeout + candle cap.

Bind to `127.0.0.1` only; nginx (below) is the public door.

## 3. nginx route

Add to the VM's nginx site (same file that routes `/strategy-builder`,
`/analyzer`, etc.). The trailing slash on `proxy_pass` strips the `/pine`
prefix so the service sees `/run`, `/healthz`, `/source`:

```nginx
location /pine/ {
    proxy_pass http://127.0.0.1:8085/;
    proxy_set_header Host $host;
    proxy_read_timeout 30s;
}
```

Reload: `sudo nginx -t && sudo systemctl reload nginx`

## 4. Wire the frontend

Add to `gaiin-frontend/apphosting.yaml` (mirrors `BACKEND_URL`):

```yaml
  - variable: PINE_RUNNER_URL
    value: http://<VM_HOST>/pine
    availability:
      - BUILD
      - RUNTIME
```

The frontend proxy (`app/api/pine/run/route.ts`) injects `X-Internal-Auth`
from the same internal secret the other proxies use, so make sure that secret
is present in the frontend env and equals `SAMWISE_INTERNAL_SECRET` on the
container. Until `PINE_RUNNER_URL` is set the UI shows a graceful
"live preview isn't available yet" message.

## 5. Verify

```bash
# on the VM
curl -s http://127.0.0.1:8085/healthz
# through nginx
curl -s http://<VM_HOST>/pine/healthz
# a real run (needs the secret if set)
curl -s http://<VM_HOST>/pine/run \
  -H 'content-type: application/json' \
  -H 'x-internal-auth: <secret>' \
  -d '{"source":"//@version=6\nindicator(\"T\",overlay=true)\nplot(ta.ema(close,9))","candles":[{"time":1704067200,"open":100,"high":101,"low":99,"close":100.5,"volume":10}]}'
```

Expect `{"ok":true,"overlay":true,"plots":[...],"warnings":[...]}`.

## Updating

```bash
git pull && docker build -t pine-runner . \
  && docker rm -f pine-runner \
  && docker run -d --name pine-runner ...   # same flags as above
```
