#!/bin/bash

brew install ios-webkit-debug-proxy > /dev/null 2>&1

git clone https://github.com/macaca-sample/sample-nodejs.git --depth=1
cd sample-nodejs

npm i npm@6 -g
npm i
npm run test:ios
