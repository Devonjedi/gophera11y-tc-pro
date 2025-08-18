# /api/Dockerfile
FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    # Let Puppeteer download its matching Chromium
    PUPPETEER_SKIP_DOWNLOAD=false \
    PUPPETEER_CACHE_DIR=/usr/local/share/puppeteer \
    # Silence headless warning logs
    PUPPETEER_DISABLE_HEADLESS_WARNING=true \
    # Make sure Chrome has writable temp dirs
    TMPDIR=/tmp

# Runtime libs for Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation \
    libasound2 libatk1.0-0 libatk-bridge2.0-0 \
    libc6 libcairo2 libcups2 libdbus-1-3 libdrm2 libexpat1 \
    libfontconfig1 libgbm1 libglib2.0-0 libgtk-3-0 \
    libnspr4 libnss3 libpango-1.0-0 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 \
    libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
    libxshmfence1 libxss1 libxtst6 \
    xdg-utils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install prod deps first (better layer cache)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the rest
COPY . .

# Create Chrome temp dirs & ensure they're writable at runtime
RUN mkdir -p /tmp/chrome-user-data /tmp/chrome-cache /tmp/chrome-data \
 && chmod -R 0777 /tmp/chrome-user-data /tmp/chrome-cache /tmp/chrome-data

# Run as non-root (your original)
RUN useradd -r -u 1001 -g root appuser && chown -R appuser:root /app
USER appuser

EXPOSE 4002

# Simple healthcheck
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4002/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
