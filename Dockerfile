# Multi-stage build for engine-server
FROM node:20-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY markets ./markets

RUN --mount=type=cache,target=/root/.npm \
    npm install --workspaces --include-workspace-root --no-audit --fund=false || npm install --no-audit --fund=false
RUN npm run build -w @hydra-ws/core \
 && npm run build -w @hydra-ws/market-config \
 && npm run build -w @hydra-ws/adapters-alpaca \
 && npm run build -w @hydra-ws/hydra-connector \
 && npm run build -w @hydra-ws/anchoring \
 && npm run build -w @hydra-ws/sdk \
 && npm run build -w engine-server \
 && npm run build -w anchoring-server

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app /app
EXPOSE 8080
CMD ["node", "apps/engine-server/dist/server.js", "--port", "8080", "--markets", "markets/*"]
