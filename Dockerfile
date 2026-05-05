FROM node:22-slim

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json ./
RUN npm install --production

# Copy application source
COPY server.js auth.js app.js index.html login.html admin.html style.css sw.js manifest.json ./
COPY logo.png icon-192.png icon-512.png icon-180.png icon-maskable-512.png ./
COPY scripts ./scripts
COPY demo ./demo

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]
