import { createServer } from "node:http";

/**
 * Runnable local email/delivery stub (Rule 5: every external dependency has a
 * runnable local stub). The playbook engine POSTs { to, subject, body } here
 * instead of sending real email in dev, so notification delivery is observable
 * without SES. Point EMAIL_DELIVERY_URL at http://localhost:5555 in .env to use it.
 */
const PORT = Number(process.env.EMAIL_STUB_PORT ?? 5555);

export function startEmailStub(port = PORT): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const msg = JSON.parse(body || "{}") as { to?: string; subject?: string };
          console.log(`[email-stub] -> ${msg.to ?? "?"}: ${msg.subject ?? ""}`);
        } catch {
          console.log("[email-stub] received (unparseable body)");
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    res.writeHead(200);
    res.end("email-stub");
  });
  server.listen(port, () => console.log(`[email-stub] listening on http://localhost:${port}`));
  return server;
}
