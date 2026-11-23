# minimi on Railway (or any container host) with memory that survives restarts.
# Mount a persistent volume at /app/data: the app keeps its SQLite memory in data/minimi.db,
# relative to /app. Without a volume, memory is lost on every redeploy.
# Node 26.13 is the floor (package.json engines): its node:sqlite has FTS5.
FROM node:26.13-bookworm-slim

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 3000
# Railway sets PORT. The keys come from the host's variables, never from the image.
CMD ["sh", "-c", "exec npx next start -H 0.0.0.0 -p ${PORT:-3000}"]
