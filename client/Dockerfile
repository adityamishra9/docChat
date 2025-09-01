# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN if [ -f pnpm-lock.yaml ]; then \
      corepack enable && pnpm i --frozen-lockfile; \
    elif [ -f yarn.lock ]; then \
      corepack enable && yarn --frozen-lockfile; \
    else \
      npm ci; \
    fi

# ---------- build ----------
FROM node:20-alpine AS builder
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN if [ -f pnpm-lock.yaml ]; then \
      corepack enable && pnpm build; \
    elif [ -f yarn.lock ]; then \
      yarn build; \
    else \
      npm run build; \
    fi

# ---------- runtime ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# If using output:'standalone' this is all you need:
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 49151
ENV HOST=0.0.0.0 PORT=49151
CMD ["node", "server.js"]
