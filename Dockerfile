# ZeroSync Docker Setup
# multi-stage build: signaling server + static client + hardhat node

FROM node:18-slim AS base
WORKDIR /app
COPY package.json ./
COPY server/package.json server/
RUN cd server && npm install --production

FROM base AS app
COPY . .

# default: run signaling server
EXPOSE 4200 8000 8545
CMD ["node", "server/signaling.js"]
