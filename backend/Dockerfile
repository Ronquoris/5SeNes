FROM node:20-alpine

WORKDIR /app

# Install dependencies (including tsx for running typescript in production)
COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 4000

ENV PORT=4000
ENV NODE_ENV=production

CMD ["npm", "run", "start"]
