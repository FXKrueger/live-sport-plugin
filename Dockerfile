FROM node:22-slim

WORKDIR /app

# Install dependencies first so Docker layer cache survives source edits
COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY resolver/package*.json ./resolver/
RUN cd resolver && npm install --no-audit --no-fund

# Copy source and build the bundled distribution
COPY . .
RUN npm run build

ENV PORT=7000
ENV NODE_ENV=production
EXPOSE 7000

HEALTHCHECK --interval=60s --timeout=10s --start-period=40s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
