# Contexte de build : la racine du dépôt, pour embarquer `services/shared`
# (modules purs partagés avec le worker) en conservant les chemins relatifs.
FROM node:20-alpine

WORKDIR /app/services/api

COPY services/api/package*.json ./
RUN npm ci

COPY services/shared /app/services/shared
COPY services/api/prisma ./prisma
RUN npx prisma generate
COPY services/api/src ./src

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
