import { createServer } from "node:http";

export function startRelay() {
  const requests = [];
  let mode = "ok";
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/result") {
      const body = mode === "fail"
        ? JSON.stringify({ ok: false, error: "mailbox rejected" })
        : JSON.stringify({ ok: true });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }
    if (req.method === "POST" && req.url === "/send") {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        if (mode === "down") {
          req.socket.destroy();
          return;
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          requests.push(JSON.parse(raw));
        } catch {
          requests.push({ raw });
        }
        res.writeHead(302, { Location: "/result" });
        res.end();
      });
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/send`,
        secret: "test-relay-secret",
        requests,
        setMode(next) { mode = next; },
        stop: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
