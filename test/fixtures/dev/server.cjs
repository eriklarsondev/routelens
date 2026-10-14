// A dev server that knows nothing about routelens. `/quit` stops it, so a test
// can end it without reaching through the shell npm runs scripts in, and it
// stops itself after a minute in case a failed test never asks.
const http = require('node:http');

const server = http.createServer((request, response) => {
  response.end(`app ${request.url}`, () => {
    if (request.url === '/quit') process.exit(0);
  });
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`listening ${server.address().port}\n`);
});
setTimeout(() => process.exit(1), 60_000).unref();
