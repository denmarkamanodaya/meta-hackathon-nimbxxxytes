# Renderer: Remotion on Node 22 (Debian bookworm) with Chrome Headless Shell. Built for
# linux/arm64 on the Mac and shipped to the app box; reachable only on the compose network.

# Stage 1: production dependencies + the Chrome Headless Shell Remotion downloads.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN node -e "import('@remotion/renderer').then((r) => r.ensureBrowser())"

# Stage 2: runtime with Chrome's shared libraries and a sans font for captions.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev \
    libxfixes3 libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
    fonts-inter \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# The bundler caches into node_modules/.cache; the app runs as the unprivileged node user.
RUN mkdir -p node_modules/.cache && chown node:node node_modules/.cache
COPY package.json tsconfig.json ./
COPY fixtures ./fixtures
COPY public ./public
COPY src ./src
COPY scripts ./scripts
ENV NODE_ENV=production PORT=3001
EXPOSE 3001
USER node
CMD ["node", "--experimental-strip-types", "src/server.ts"]
