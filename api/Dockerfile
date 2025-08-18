FROM node:20-bullseye
RUN apt-get update && apt-get install -y chromium --no-install-recommends && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
EXPOSE 4002
CMD ["npm","start"]

# /api/Dockerfile
FROM node:20-bullseye

# System deps commonly required by Chromium
RUN apt-get update && apt-get install -y \
  ca-certificates fonts-liberation libasound2 libatk1.0-0 libc6 libcairo2 \
  libcups2 libdbus-1-3 libdrm2 libexpat1 libfontconfig1 libglib2.0-0 \
  libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 \
  libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
  libxrandr2 libxrender1 libxss1 libxtst6 xdg-utils wget gnupg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Puppeteer downloads Chromium during npm ci if puppeteer is a prod dep
# If you pinned SKIP_DOWNLOAD earlier, remove that env to allow download:
# ENV PUPPETEER_SKIP_DOWNLOAD=false

EXPOSE 4002
CMD ["node", "index.js"]
