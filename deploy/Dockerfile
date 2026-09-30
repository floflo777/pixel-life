# syntax=docker/dockerfile:1.7
# Pixel Life game server (apps/server). Build from the repo root:
#   docker build -f deploy/Dockerfile -t pixel-life-server .
# Stages: manifests (package.json files only, for layer caching) → build (npm ci + esbuild bundle)
#         → runtime (production deps of @pl/server only, non-root, no build tools).

ARG NODE_IMAGE=node:22-slim

FROM ${NODE_IMAGE} AS manifests
WORKDIR /src
COPY . .
# Keep only what `npm ci` needs, so dependency layers are rebuilt only when a manifest or the lockfile changes.
RUN mkdir -p /out \
 && cp package.json package-lock.json /out/ \
 && cp -r vendor /out/vendor \
 && find . -name package.json -not -path "*/node_modules/*" -not -path "./package.json" -exec cp --parents {} /out/ \;

FROM ${NODE_IMAGE} AS build
WORKDIR /app
# --ignore-scripts everywhere: the root patch-package postinstall only patches the SDK's browser runtime
# (ConnectedGameHost), which the server never imports; no dependency needs an install script at runtime.
COPY --from=manifests /out ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build -w @pl/server

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3100
WORKDIR /app
COPY --from=manifests /out ./
RUN npm ci --omit=dev --workspace @pl/server --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force \
 && rm -rf vendor
COPY --from=build /app/apps/server/dist apps/server/dist
COPY apps/server/migrations apps/server/migrations
USER node
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3100/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "apps/server/dist/main.mjs"]
