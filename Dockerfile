# syntax=docker/dockerfile:1
# ARC worker: the cloud half of AIVEN ARC. One self-contained file (dist-worker/worker.mjs) plus the tools the agent shells out to.

FROM node:22-bookworm-slim AS build
WORKDIR /app
# The desktop app's dev dependencies come along with npm ci; do not download Electron's binary for a server image.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build:worker

FROM node:22-bookworm-slim
# git: clone and push. ripgrep, bash, curl: what the agent's Grep and Bash tools expect to find.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep bash ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
# Not root: the agent's shell runs as this user. /data holds clones and session files.
RUN useradd --uid 10001 --create-home --home-dir /home/arc --shell /bin/bash arc \
 && mkdir -p /data \
 && chown arc:arc /data
WORKDIR /app
COPY --from=build /app/dist-worker/worker.mjs ./worker.mjs
ENV ARC_DATA_DIR=/data \
    NODE_ENV=production \
    PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER arc
CMD ["node", "worker.mjs"]
