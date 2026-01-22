# Veritas HTTP Server - Docker Image
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

# Install tsx for running TypeScript directly
RUN npm install -g tsx

# Default port
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Run HTTP server by default
CMD ["tsx", "src/http-server.ts"]

# Expose port
EXPOSE 3000
