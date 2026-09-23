# One image for the API and the collector worker.
# The Playwright base image already contains Chromium and its system libraries;
# its version must match the "playwright" version in package.json.
FROM mcr.microsoft.com/playwright:v1.56.0-noble AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.56.0-noble
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY db ./db
COPY seeds ./seeds
USER pwuser
EXPOSE 4000
# Default: API. The worker service overrides the command with: node dist/worker/index.js
CMD ["node", "dist/api/index.js"]
