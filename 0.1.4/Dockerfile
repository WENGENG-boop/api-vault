FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.main.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3210
ENV HOST=0.0.0.0
ENV API_VAULT_DOCKER=1
ENV API_VAULT_NO_OPEN=1

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-main ./dist-main

RUN mkdir -p /app/.api-vault

EXPOSE 3210

CMD ["npm", "run", "serve"]
