FROM node:22-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY server.js ./
COPY public/ ./public/

# Default agents dir (can be overridden at runtime)
ENV AGENTS_DIR=/data/agents
ENV PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/state || exit 1

CMD ["node", "server.js"]
