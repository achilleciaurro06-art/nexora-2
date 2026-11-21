// Mini gateway (sostituisce Kong) per lo stack di verifica locale: /auth/v1 -> GoTrue, /rest/v1 -> PostgREST, /storage/v1 -> Storage API.
import http from "node:http";

const routes = { "/auth/v1": 9999, "/rest/v1": 3000, "/storage/v1": 5000 };
const port = Number(process.env.GATEWAY_PORT ?? 54321);

http.createServer((req, res) => {
  const prefix = Object.keys(routes).find((p) => req.url === p || req.url?.startsWith(p + "/") || req.url?.startsWith(p + "?"));
  if (!prefix) { res.writeHead(404, { "content-type": "application/json" }); res.end('{"message":"no route"}'); return; }
  const upstream = http.request(
    { host: "127.0.0.1", port: routes[prefix], method: req.method, path: req.url.slice(prefix.length) || "/", headers: { ...req.headers, host: `127.0.0.1:${routes[prefix]}` } },
    (up) => { res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res); },
  );
  upstream.on("error", (e) => { res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ message: "upstream error", detail: String(e.message) })); });
  req.pipe(upstream);
}).listen(port, "127.0.0.1", () => console.log(`gateway su :${port}`));
