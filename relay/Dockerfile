FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY core/package.json ./core/package.json
COPY client/package.json ./client/package.json
COPY relay/package.json ./relay/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /srv
ENV NODE_ENV=production PORT=8131 DATA_DIR=/data
COPY --from=build /app/relay/package.json ./relay/package.json
COPY --from=build /app/relay/src ./relay/src
COPY --from=build /app/core/package.json ./core/package.json
COPY --from=build /app/core/src ./core/src
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/client/dist ./client/dist
VOLUME /data
EXPOSE 8131
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD node --input-type=module -e 'fetch("http://localhost:"+(process.env.PORT??8131)+"/healthz").then(r=>{if(!r.ok)process.exit(1)})'
CMD ["./node_modules/.bin/vite-node", "relay/src/main.ts"]
