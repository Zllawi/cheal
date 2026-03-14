FROM node:22-alpine AS base
WORKDIR /app

COPY package*.json ./
COPY services/api/package.json services/api/package.json
RUN npm install

COPY . .
RUN npm run build -w @fuelmap/api

EXPOSE 4000
CMD ["npm", "run", "start", "-w", "@fuelmap/api"]
