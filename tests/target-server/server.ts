import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";

export interface TargetServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

const GZIP_JSON = zlib.gzipSync(Buffer.from('{"hello":"gzip"}'));
const BROTLI_JSON = zlib.brotliCompressSync(Buffer.from('{"hello":"brotli"}'));
const BOMB = zlib.gzipSync(Buffer.alloc(20 * 1024 * 1024, "a")); // 20 Mo décompressés

export async function startTargetServer(): Promise<TargetServer> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const path = url.pathname;
    const code = Number(url.searchParams.get("code") ?? 302);

    if (path === "/echo") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ method: req.method, path: req.url, headers: req.headers, body: body.toString("utf8") }));
    } else if (path.startsWith("/status/")) {
      res.statusCode = Number(path.split("/")[2]);
      res.end(`status ${res.statusCode}`);
    } else if (path.startsWith("/redirect/")) {
      const n = Number(path.split("/")[2]);
      res.statusCode = code;
      res.setHeader("location", n <= 1 ? "/echo" : `/redirect/${n - 1}?code=${code}`);
      res.end();
    } else if (path === "/redirect-to") {
      res.statusCode = code;
      res.setHeader("location", url.searchParams.get("url") ?? "/echo");
      res.end();
    } else if (path.startsWith("/delay/")) {
      setTimeout(() => res.end("late"), Number(path.split("/")[2]));
    } else if (path === "/gzip") {
      res.setHeader("content-type", "application/json");
      res.setHeader("content-encoding", "gzip");
      res.end(GZIP_JSON);
    } else if (path === "/brotli") {
      res.setHeader("content-type", "application/json");
      res.setHeader("content-encoding", "br");
      res.end(BROTLI_JSON);
    } else if (path === "/bomb") {
      res.setHeader("content-type", "text/plain");
      res.setHeader("content-encoding", "gzip");
      res.end(BOMB);
    } else if (path === "/large") {
      res.setHeader("content-type", "text/plain");
      res.end(Buffer.alloc(Number(url.searchParams.get("bytes") ?? 0), "a"));
    } else if (path === "/binary") {
      res.setHeader("content-type", "application/octet-stream");
      res.end(Buffer.from([0, 1, 2, 255, 254]));
    } else if (path === "/cookies") {
      res.setHeader("set-cookie", ["a=1", "b=2"]);
      res.end("ok");
    } else {
      res.statusCode = 404;
      res.end("not found");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}