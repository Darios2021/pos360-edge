FROM node:20-alpine

WORKDIR /usr/src/app

# Instala dependencias primero (caching)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copia el resto
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
