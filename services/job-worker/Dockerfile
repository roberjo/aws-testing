# Build from the repository root:  docker build -f services/job-worker/Dockerfile .
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
# npm ci validates the lockfile against every workspace manifest.
COPY packages/core/package.json packages/core/
COPY services/functions/package.json services/functions/
COPY services/job-worker/package.json services/job-worker/
COPY web/package.json web/
COPY tests/package.json tests/
RUN npm ci -w @poc/core -w @poc/job-worker
COPY packages/core packages/core
COPY services/job-worker services/job-worker
RUN npm run build -w @poc/core && npm run build -w @poc/job-worker \
 && npm prune --omit=dev -w @poc/core -w @poc/job-worker

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/services/job-worker/package.json services/job-worker/
COPY --from=build /app/services/job-worker/dist services/job-worker/dist
USER node
CMD ["node", "services/job-worker/dist/index.js"]
