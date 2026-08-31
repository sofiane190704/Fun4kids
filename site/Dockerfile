# Fun4Kids site — Node/Express server serving public/ + form APIs.
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY lib ./lib
COPY public ./public

# Persistent volume is mounted here in production (see fly.toml) so
# contact.csv / inscriptions-log.csv / stage-*.xlsx / academie.xlsx / etc.
# survive restarts and redeploys.
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
