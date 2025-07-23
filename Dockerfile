FROM node:18

# Instalar FFmpeg
RUN apt-get update && apt-get install -y ffmpeg

# Definir diretório de trabalho
WORKDIR /app

# Copiar arquivos do projeto
COPY package.json .
COPY server.js .
COPY public/ ./public/

# Instalar dependências
RUN npm install

# Expor a porta
EXPOSE 3000

# Comando para iniciar o servidor
CMD ["node", "server.js"]
