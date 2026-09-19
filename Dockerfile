FROM node:22-slim

WORKDIR /app

# Copy package configs and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code and assets
COPY . .

# Install internal resolver dependencies
RUN cd resolver && npm install

# Build the bundled distribution
RUN npm run build

# Configure runtime environment
ENV PORT=7000
ENV NODE_ENV=production
EXPOSE 7000

HEALTHCHECK --interval=60s --timeout=10s --start-period=40s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start server directly with node
CMD ["node", "dist/index.js"]

