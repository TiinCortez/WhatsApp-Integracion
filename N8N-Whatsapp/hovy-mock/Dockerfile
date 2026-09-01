FROM node:22-alpine

WORKDIR /app

# Las dependencias se copian aparte del codigo para que Docker cachee esta capa:
# cambiar src/ no reinstala node_modules.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# Documenta el puerto interno. NO lo publica al host: eso lo decide el compose.
EXPOSE 3000

# Nunca correr como root dentro del contenedor.
USER node

CMD ["node", "src/server.js"]
