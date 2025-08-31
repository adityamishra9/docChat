# -------- Base --------
FROM node:20-bookworm-slim

# System deps for OCR + rasterization
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    curl ca-certificates \
    tesseract-ocr tesseract-ocr-eng \
    poppler-utils unpaper ghostscript imagemagick \
  && rm -rf /var/lib/apt/lists/*

# Optional: tessdata_best (improves tiny text)
RUN mkdir -p /usr/share/tesseract-ocr/4.00/tessdata \
  && curl -L -o /usr/share/tesseract-ocr/4.00/tessdata/eng.traineddata \
     https://github.com/tesseract-ocr/tessdata_best/raw/main/eng.traineddata

WORKDIR /app

# Enable pnpm if you use it
RUN corepack enable

# Install JS deps
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source
COPY . .

# Default command runs the API; docker-compose overrides for worker
CMD ["node", "index.js"]
