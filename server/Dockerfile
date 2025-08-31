FROM node:20-bookworm-slim

# System deps used by PDF/OCR flow
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    tesseract-ocr \
    poppler-utils \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# Install deps first for better caching
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN if [ -f pnpm-lock.yaml ]; then \
      corepack enable && pnpm i --frozen-lockfile --prod=false; \
    elif [ -f yarn.lock ]; then \
      corepack enable && yarn --frozen-lockfile; \
    else \
      npm ci; \
    fi

# Copy source
COPY . .

# Build (if your server has TS or build steps—safe to no-op if not)
RUN npm run build || echo "No build step, continuing."

EXPOSE 8000

# Use tini for proper PID 1 signaling
ENTRYPOINT ["/usr/bin/tini", "--"]

# Command is provided by docker-compose (index.js or worker.js)
CMD ["node", "index.js"]
