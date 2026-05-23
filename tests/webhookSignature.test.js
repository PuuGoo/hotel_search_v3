import { describe, test, expect } from "@jest/globals";
import {
  signPayload,
  verifySignature,
  buildSignedHeaders,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from "../utils/webhookSignature.js";

describe("Webhook Signature", () => {
  const secret = "test-webhook-secret-key";
  const body = JSON.stringify({ event: "test", data: { id: 1 } });
  const timestamp = Math.floor(Date.now() / 1000).toString();

  test("signPayload returns v1=<hex> format", () => {
    const sig = signPayload(body, secret, timestamp);
    expect(sig).toMatch(/^v1=[a-f0-9]{64}$/);
  });

  test("signPayload is deterministic", () => {
    const sig1 = signPayload(body, secret, timestamp);
    const sig2 = signPayload(body, secret, timestamp);
    expect(sig1).toBe(sig2);
  });

  test("different secrets produce different signatures", () => {
    const sig1 = signPayload(body, "secret1", timestamp);
    const sig2 = signPayload(body, "secret2", timestamp);
    expect(sig1).not.toBe(sig2);
  });

  test("different bodies produce different signatures", () => {
    const sig1 = signPayload('{"a":1}', secret, timestamp);
    const sig2 = signPayload('{"b":2}', secret, timestamp);
    expect(sig1).not.toBe(sig2);
  });

  test("different timestamps produce different signatures", () => {
    const sig1 = signPayload(body, secret, "1000000");
    const sig2 = signPayload(body, secret, "2000000");
    expect(sig1).not.toBe(sig2);
  });

  test("verifySignature accepts valid signature", () => {
    const sig = signPayload(body, secret, timestamp);
    expect(verifySignature(body, secret, sig, timestamp)).toBe(true);
  });

  test("verifySignature rejects invalid signature", () => {
    const sig = "v1=" + "a".repeat(64);
    expect(verifySignature(body, secret, sig, timestamp)).toBe(false);
  });

  test("verifySignature rejects tampered body", () => {
    const sig = signPayload(body, secret, timestamp);
    const tamperedBody = JSON.stringify({ event: "test", data: { id: 999 } });
    expect(verifySignature(tamperedBody, secret, sig, timestamp)).toBe(false);
  });

  test("verifySignature rejects expired timestamp", () => {
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 600).toString(); // 10 min ago
    const sig = signPayload(body, secret, oldTimestamp);
    expect(verifySignature(body, secret, sig, oldTimestamp)).toBe(false);
  });

  test("verifySignature accepts timestamp within maxAgeSeconds", () => {
    const recentTimestamp = (Math.floor(Date.now() / 1000) - 100).toString(); // 100s ago
    const sig = signPayload(body, secret, recentTimestamp);
    expect(verifySignature(body, secret, sig, recentTimestamp, 300)).toBe(true);
  });

  test("verifySignature rejects missing signature", () => {
    expect(verifySignature(body, secret, null, timestamp)).toBe(false);
  });

  test("verifySignature rejects missing timestamp", () => {
    const sig = signPayload(body, secret, timestamp);
    expect(verifySignature(body, secret, sig, null)).toBe(false);
  });

  test("verifySignature rejects missing secret", () => {
    const sig = signPayload(body, secret, timestamp);
    expect(verifySignature(body, null, sig, timestamp)).toBe(false);
  });

  test("buildSignedHeaders returns correct headers", () => {
    const headers = buildSignedHeaders(body, secret);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers[SIGNATURE_HEADER]).toMatch(/^v1=[a-f0-9]{64}$/);
    expect(headers[TIMESTAMP_HEADER]).toBeDefined();
    expect(Number(headers[TIMESTAMP_HEADER])).toBeGreaterThan(0);
  });

  test("buildSignedHeaders signature can be verified", () => {
    const headers = buildSignedHeaders(body, secret);
    const sig = headers[SIGNATURE_HEADER];
    const ts = headers[TIMESTAMP_HEADER];
    expect(verifySignature(body, secret, sig, ts)).toBe(true);
  });

  test("custom maxAgeSeconds is respected", () => {
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 30).toString(); // 30s ago
    const sig = signPayload(body, secret, oldTimestamp);
    // 10s max age should reject 30s old
    expect(verifySignature(body, secret, sig, oldTimestamp, 10)).toBe(false);
    // 60s max age should accept 30s old
    expect(verifySignature(body, secret, sig, oldTimestamp, 60)).toBe(true);
  });
});
