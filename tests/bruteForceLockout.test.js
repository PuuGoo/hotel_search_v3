import { describe, test, expect, beforeEach } from "@jest/globals";
import { recordLoginFailure, getLockoutInfo, _loginAttempts, _LOCKOUT_THRESHOLD, _MAX_DELAY_MS } from "../middleware/rateLimit.js";

function makeReq(ip = "127.0.0.1") {
  return { ip, connection: { remoteAddress: ip } };
}

beforeEach(() => {
  _loginAttempts.clear();
});

describe("Brute Force Lockout", () => {
  test("first few failures return 0 delay", () => {
    const req = makeReq();
    for (let i = 0; i < _LOCKOUT_THRESHOLD; i++) {
      const delay = recordLoginFailure(req);
      expect(delay).toBe(0);
    }
  });

  test("delay starts after threshold", () => {
    const req = makeReq();
    // Reach threshold
    for (let i = 0; i < _LOCKOUT_THRESHOLD; i++) {
      recordLoginFailure(req);
    }
    // Next failure should have delay
    const delay = recordLoginFailure(req);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBe(1000); // 2^0 * 1000
  });

  test("delay doubles with each failure", () => {
    const req = makeReq();
    for (let i = 0; i < _LOCKOUT_THRESHOLD; i++) {
      recordLoginFailure(req);
    }

    const delay1 = recordLoginFailure(req); // 2^0 * 1000 = 1000
    expect(delay1).toBe(1000);

    const delay2 = recordLoginFailure(req); // 2^1 * 1000 = 2000
    expect(delay2).toBe(2000);

    const delay3 = recordLoginFailure(req); // 2^2 * 1000 = 4000
    expect(delay3).toBe(4000);

    const delay4 = recordLoginFailure(req); // 2^3 * 1000 = 8000
    expect(delay4).toBe(8000);
  });

  test("delay caps at MAX_DELAY_MS", () => {
    const req = makeReq();
    for (let i = 0; i < _LOCKOUT_THRESHOLD + 10; i++) {
      const delay = recordLoginFailure(req);
      expect(delay).toBeLessThanOrEqual(_MAX_DELAY_MS);
    }
  });

  test("different IPs have independent lockout", () => {
    const req1 = makeReq("10.0.0.1");
    const req2 = makeReq("10.0.0.2");

    // Exhaust threshold on req1
    for (let i = 0; i <= _LOCKOUT_THRESHOLD; i++) {
      recordLoginFailure(req1);
    }

    // req2 should still have 0 delay
    const delay = recordLoginFailure(req2);
    expect(delay).toBe(0);
  });

  test("getLockoutInfo returns correct state", () => {
    const req = makeReq();

    let info = getLockoutInfo(req);
    expect(info.failures).toBe(0);
    expect(info.delay).toBe(0);

    recordLoginFailure(req);
    recordLoginFailure(req);

    info = getLockoutInfo(req);
    expect(info.failures).toBe(2);
    expect(info.delay).toBe(0);

    recordLoginFailure(req);
    info = getLockoutInfo(req);
    expect(info.failures).toBe(3);
    expect(info.delay).toBe(0); // At threshold, not yet over

    recordLoginFailure(req);
    info = getLockoutInfo(req);
    expect(info.failures).toBe(4);
    expect(info.delay).toBe(1000); // Over threshold
  });

  test("lockout tracks failures per entry", () => {
    const req = makeReq();
    // The recordLoginFailure increments failures on the entry
    recordLoginFailure(req);
    recordLoginFailure(req);
    recordLoginFailure(req);
    recordLoginFailure(req); // 4th failure = over threshold

    const info = getLockoutInfo(req);
    expect(info.failures).toBe(4);
    expect(info.delay).toBe(1000);
  });
});
