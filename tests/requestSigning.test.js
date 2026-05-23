import { describe, test, expect } from "@jest/globals";
import {
  signRequest,
  buildRequestSignHeaders,
  verifyRequestSignature,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  NONCE_HEADER,
} from "../middleware/requestSigning.js";

describe("Request Signing", () => {
  const secret = "test-signing-secret";

  test("signRequest returns consistent signature", () => {
    const timestamp = "1234567890";
    const nonce = "abc123";
    const sig1 = signRequest("POST", "/api/data", '{"key":"value"}', secret, timestamp, nonce);
    const sig2 = signRequest("POST", "/api/data", '{"key":"value"}', secret, timestamp, nonce);
    expect(sig1).toBe(sig2);
    expect(sig1).toHaveLength(64);
  });

  test("different methods produce different signatures", () => {
    const timestamp = "1234567890";
    const nonce = "abc123";
    const sig1 = signRequest("GET", "/api/data", "", secret, timestamp, nonce);
    const sig2 = signRequest("POST", "/api/data", "", secret, timestamp, nonce);
    expect(sig1).not.toBe(sig2);
  });

  test("buildRequestSignHeaders returns all required headers", () => {
    const headers = buildRequestSignHeaders("POST", "/api/test", '{"a":1}', secret);
    expect(headers[SIGNATURE_HEADER]).toBeDefined();
    expect(headers[TIMESTAMP_HEADER]).toBeDefined();
    expect(headers[NONCE_HEADER]).toBeDefined();
    expect(headers[SIGNATURE_HEADER]).toHaveLength(64);
  });

  test("verifyRequestSignature succeeds with valid signature", () => {
    const headers = buildRequestSignHeaders("POST", "/api/test", '{"a":1}', secret);
    const req = {
      method: "POST",
      path: "/api/test",
      body: { a: 1 },
      headers: {
        [SIGNATURE_HEADER.toLowerCase()]: headers[SIGNATURE_HEADER],
        [TIMESTAMP_HEADER.toLowerCase()]: headers[TIMESTAMP_HEADER],
        [NONCE_HEADER.toLowerCase()]: headers[NONCE_HEADER],
      },
    };
    const res = { status: () => ({ json: () => {} }) };
    let nextCalled = false;
    verifyRequestSignature(secret)(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  test("verifyRequestSignature fails with missing headers", () => {
    const req = { method: "POST", path: "/api/test", body: {}, headers: {} };
    let statusCode;
    const res = { status: (code) => { statusCode = code; return { json: () => {} }; } };
    verifyRequestSignature(secret)(req, res, () => {});
    expect(statusCode).toBe(401);
  });

  test("verifyRequestSignature fails with wrong signature", () => {
    const req = {
      method: "POST",
      path: "/api/test",
      body: {},
      headers: {
        [SIGNATURE_HEADER.toLowerCase()]: "a".repeat(64),
        [TIMESTAMP_HEADER.toLowerCase()]: String(Math.floor(Date.now() / 1000)),
        [NONCE_HEADER.toLowerCase()]: "test-nonce-123",
      },
    };
    let statusCode;
    const res = { status: (code) => { statusCode = code; return { json: () => {} }; } };
    verifyRequestSignature(secret)(req, res, () => {});
    expect(statusCode).toBe(401);
  });

  test("signRequest with empty body", () => {
    const sig = signRequest("GET", "/api/test", "", secret, "123", "abc");
    expect(sig).toHaveLength(64);
  });
});
