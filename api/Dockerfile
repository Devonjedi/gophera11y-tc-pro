FROM node:20-bullseye
RUN apt-get update && apt-get install -y chromium --no-install-recommends && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
EXPOSE 4002
CMD ["npm","start"]
