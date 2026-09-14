FROM oven/bun:1.3.11

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8085

# pinets is pure JS (acorn/astring) — no native build deps needed.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY src ./src
COPY tsconfig.json ./tsconfig.json

# Run unprivileged (the base image ships a `bun` user).
USER bun

EXPOSE 8085

CMD ["bun", "run", "src/service/index.ts"]
