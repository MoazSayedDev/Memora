
FROM node:24-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" ./node_modules/.bin/prisma generate

EXPOSE 3000

CMD ["npm", "run", "start:dev"]
