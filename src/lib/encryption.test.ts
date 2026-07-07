import { describe, it, expect, beforeAll } from "vitest";

// The vault derives its key from SESSION_JWT_SECRET; set it before importing.
beforeAll(() => {
  process.env.SESSION_JWT_SECRET ??= "test-session-secret-at-least-32-chars-long";
});

describe("encryption vault", () => {
  it("round-trips arbitrary secrets", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/encryption");
    const secret = "1//refresh-token-value.with-symbols_and-123";
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret); // ciphertext, not plaintext
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("produces a different ciphertext each time (random IV)", async () => {
    const { encryptSecret } = await import("@/lib/encryption");
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects a tampered ciphertext", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/encryption");
    const enc = encryptSecret("keep me safe");
    const buf = Buffer.from(enc, "base64");
    const last = buf.length - 1;
    buf[last] = (buf[last] ?? 0) ^ 0xff; // flip a ciphertext byte
    expect(() => decryptSecret(buf.toString("base64"))).toThrow();
  });

  it("rejects truncated input", async () => {
    const { decryptSecret } = await import("@/lib/encryption");
    expect(() => decryptSecret("AAAA")).toThrow();
  });
});
