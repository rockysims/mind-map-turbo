# ---------- Build stage ----------
FROM node:20-alpine AS builder

RUN corepack enable
WORKDIR /app

COPY package*.json ./
COPY pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# ---------- Runtime stage ----------
FROM node:20-alpine AS runner

RUN corepack enable
WORKDIR /app

COPY --from=builder /app/build ./build
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile --prod

EXPOSE 3000
CMD ["node", "build"]
