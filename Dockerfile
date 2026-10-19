FROM oven/bun:1-alpine

WORKDIR /app
# No runtime dependencies (devDependencies are only for the typecheck), so no install step.
COPY package.json tsconfig.json ./
COPY src ./src

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
