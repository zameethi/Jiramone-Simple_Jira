FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

# Copia arquivos de dependência e schema
COPY package.json ./
COPY prisma ./prisma/

# Instala TypeScript estável e dependências
RUN npm install
RUN npm install typescript@5.4.5 --save-dev

# Copia o restante do código fonte
COPY . .

# Gera o client do prisma e compila TypeScript
RUN npx prisma generate
RUN npx tsc

EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node dist/index.js"]
