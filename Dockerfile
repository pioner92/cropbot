# syntax = docker/dockerfile:1

  FROM emscripten/emsdk:3.1.74

  # Install Node.js 20
  RUN apt-get update && apt-get install -y curl && \
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
      apt-get install -y nodejs && \
      apt-get clean && rm -rf /var/lib/apt/lists/*

  WORKDIR /app

  COPY package.json ./
  RUN npm install --omit=dev

  COPY . .

  EXPOSE 3000

  CMD ["node", "server.js"]
