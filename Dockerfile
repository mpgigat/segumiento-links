FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Copiar primero los manifests aprovecha el cache de capas si solo cambia el código.
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

# Sin root dentro del contenedor.
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/healthz || exit 1

CMD ["node", "src/server.js"]
