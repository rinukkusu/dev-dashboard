# 1. The web app (web/ → dist/web). Built on the build machine's own platform: the result is plain
#    HTML/JS/CSS, the same for every image, so arm64 doesn't have to run Vite under emulation.
FROM --platform=$BUILDPLATFORM oven/bun:1-alpine AS web
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY web ./web
# the web app shares types, texts and a few pure functions with the server
COPY src ./src
RUN bun run build

# 2. The server. No runtime dependencies (everything in package.json is for the web app's build,
#    the typecheck and the tests), so no install step.
FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
COPY --from=web /app/dist/web ./dist/web

# State lives in a volume, so the change log survives container restarts.
RUN mkdir /data && chown bun:bun /data
VOLUME /data

ENV NODE_ENV=production \
    OUT_DIR=/data \
    HOST=0.0.0.0 \
    PORT=3000

USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["bun", "run", "src/server.ts"]
