FROM node:26-alpine

WORKDIR /app

COPY package.json .
COPY package-lock.json .

RUN npm install

COPY index.js .

CMD ["npm","start"]

EXPOSE 3080
