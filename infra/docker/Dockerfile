FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends sqlite3 tar ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/exam-planner
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist ./dist
COPY server ./server

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/auth-static-server.mjs"]
