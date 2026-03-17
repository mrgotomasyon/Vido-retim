FROM node:20-slim

# ffmpeg-static için gerekli sistem kütüphaneleri
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Bağımlılıkları önce kopyala (Docker layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Uygulama dosyalarını kopyala
COPY . .

# Render + voice dizinleri (volume mount edilecek)
RUN mkdir -p /data/renders /data/voice

EXPOSE 3000

# Sağlık kontrolü
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "startup.js"]
