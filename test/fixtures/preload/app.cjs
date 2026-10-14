// An app that knows nothing about routelens. Its handler is attached after the
// server exists, the way some frameworks do it, so the preload cannot rely on
// the listener passed to createServer.
const http = require('node:http');

const server = http.createServer();
server.on('request', (request, response) => {
  response.end(`app ${request.url}`);
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`listening ${server.address().port}\n`);
});
