# /api/Dockerfile
FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    # Skip Puppeteer's chromium download, we'll use system one
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable \
    # Silence headless warning logs
    PUPPETEER_DISABLE_HEADLESS_WARNING=true \
    # Make sure Chrome has writable temp dirs
    TMPDIR=/tmp

# Install Google Chrome Stable and deps
RUN apt-get update && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
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

# Run as non-root
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser \
    && chown -R pptruser:pptruser /app

USER pptruser

EXPOSE 4002

# Simple healthcheck
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4002/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
