# Production image: builds the Astro site and runs the Node server that serves
# the static pages and the /api backend. Works on Render, Railway, Fly.io,
# Google Cloud Run, a VPS: anything that runs a container.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321 DATA_DIR=/data
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
VOLUME /data
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4321/api/health/ || exit 1
CMD ["node", "./dist/server/entry.mjs"]
