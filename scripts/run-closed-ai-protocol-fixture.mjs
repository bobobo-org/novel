import http from "node:http";

const origin = "http://localhost:3000";
const server = http.createServer((request, response) => {
  if (request.headers.origin !== origin) { response.writeHead(403).end(); return; }
  if (request.method === "OPTIONS") {
    response.writeHead(204, { "Access-Control-Allow-Origin": origin, Vary: "Origin, Access-Control-Request-Private-Network", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Bridge-Protocol,X-Bridge-CSRF,Idempotency-Key", "Access-Control-Allow-Private-Network": "true", "Access-Control-Max-Age": "0" });
    response.end(); return;
  }
  response.writeHead(409, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": origin, Vary: "Origin" });
  response.end(JSON.stringify({ errorCode: "BRIDGE_PROTOCOL_INCOMPATIBLE", message: "This test fixture represents an older Bridge protocol.", retryable: false }));
});
server.listen(3217, "127.0.0.1", () => process.stdout.write("PROTOCOL_FIXTURE_READY\n"));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
