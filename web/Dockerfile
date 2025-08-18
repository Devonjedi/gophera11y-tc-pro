FROM node:20-bullseye
WORKDIR /usr/src/app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
RUN npm run build
EXPOSE 3002
CMD ["npm","start"]
