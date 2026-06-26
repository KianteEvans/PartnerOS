import { createServer } from "node:http";

/**
 * Runnable local OIDC stub (Rule 5: every external dependency has a runnable
 * local stub, never a production-only mock). It speaks just enough of the flow
 * the DevStubOidcProvider expects:
 *
 *   GET  /authorize  -> 302 back to redirect_uri with a `code` that encodes the
 *                       dev user's claims (and echoes state).
 *   POST /token      -> returns { sub, email } decoded from that code.
 *
 * The dev user can be chosen with ?email= and ?sub= on /authorize.
 */

const PORT = Number(process.env.OIDC_STUB_PORT ?? 4444);

function b64urlEncode(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}
function b64urlDecode<T>(s: string): T {
  return JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as T;
}

export function startOidcStub(port = PORT): ReturnType<typeof createServer> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (req.method === "GET" && url.pathname === "/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state") ?? "";
      const nonce = url.searchParams.get("nonce") ?? "";
      const email = url.searchParams.get("email") ?? "dev@partneros.local";
      const sub = url.searchParams.get("sub") ?? "dev-user";
      if (!redirectUri) {
        res.writeHead(400).end("missing redirect_uri");
        return;
      }
      const code = b64urlEncode({ sub, email, nonce });
      const back = new URL(redirectUri);
      back.searchParams.set("code", code);
      back.searchParams.set("state", state);
      res.writeHead(302, { location: back.toString() }).end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/token") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const params = new URLSearchParams(body);
        const code = params.get("code") ?? "";
        try {
          const claims = b64urlDecode<{ sub: string; email: string }>(code);
          res
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify({ sub: claims.sub, email: claims.email }));
        } catch {
          res.writeHead(400).end("bad code");
        }
      });
      return;
    }

    res.writeHead(404).end("not found");
  });

  server.listen(port, () => {
    console.log(`[oidc-stub] listening on http://localhost:${port}`);
  });
  return server;
}

const isCli =
  process.argv[1] !== undefined && process.argv[1].endsWith("oidc-stub.ts");
if (isCli) startOidcStub();
