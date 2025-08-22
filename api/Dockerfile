# Base image
FROM node:20-slim

# Ensure Puppeteer downloads its own Chromium
ENV PUPPETEER_SKIP_DOWNLOAD=false

WORKDIR /app

# Install production dependencies first
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the rest of the app
COPY . .

# Create a non-root user to run the app
RUN useradd -r -u 1001 -g root appuser && chown -R appuser:root /app
USER appuser

EXPOSE 4002

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4002/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
