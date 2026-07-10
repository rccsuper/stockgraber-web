# --- build stage: build the web SPA ---
FROM oven/bun:1.3 AS web
WORKDIR /app/web
COPY web/package.json web/bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY web/ ./
RUN bun run build

# --- runtime stage: server serves the SPA + API ---
FROM oven/bun:1.3
WORKDIR /app
COPY server/package.json server/bun.lock* ./server/
RUN cd server && bun install --frozen-lockfile || bun install
COPY server/ ./server/
COPY --from=web /app/web/dist ./web/dist
ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001
# Server is configured to serve the built SPA from ../web/dist
WORKDIR /app/server
CMD ["bun", "run", "start"]
