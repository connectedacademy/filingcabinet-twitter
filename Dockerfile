FROM node:7-alpine

RUN npm install --silent -g nodemon

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

COPY package.json /usr/src/app/package.json

RUN npm install --silent && npm cache clean

COPY . /usr/src/app

CMD node app.js