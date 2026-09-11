# Contexte de build : la racine du dépôt (voir services/api/Dockerfile).
FROM node:20-alpine

WORKDIR /app/services/worker

COPY services/worker/package*.json ./
RUN npm ci

COPY services/shared /app/services/shared
COPY services/worker/index.js ./index.js
COPY services/worker/src ./src

EXPOSE 3001

CMD ["npm", "start"]
