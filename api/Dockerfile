# /api/Dockerfile
FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install system Chromium and dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      chromium \
      libasound2 \
      libatk1.0-0 \
      libatk-bridge2.0-0 \
      libcups2 \
      libdrm2 \
      libexpat1 \
      libfontconfig1 \
      libgbm1 \
      libgtk-3-0 \
      libpango-1.0-0 \
      libx11-6 \
      libx11-xcb1 \
      libxcb1 \
      libxcomposite1 \
      libxcursor1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxi6 \
      libxrandr2 \
      libxrender1 \
      libxshmfence1 \
      libxss1 \
      libxtst6 \
      xdg-utils && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy source
COPY . .

# Use a non-root user
RUN useradd -r -u 1001 -g root appuser && chown -R appuser:root /app
USER appuser

EXPOSE 4002

# Healthcheck for Render
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:4002/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
