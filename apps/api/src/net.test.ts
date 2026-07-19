// apps/api/src/net.test.ts
import { describe, it, expect } from "vitest";
import { assertPublicHttpUrl, isPrivateOrLoopbackIp } from "./net.js";

describe("isPrivateOrLoopbackIp", () => {
  it("flags loopback, private, and link-local IPv4 ranges", () => {
    expect(isPrivateOrLoopbackIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrLoopbackIp("10.0.0.5")).toBe(true);
    expect(isPrivateOrLoopbackIp("172.16.0.1")).toBe(true);
    expect(isPrivateOrLoopbackIp("172.31.255.255")).toBe(true);
    expect(isPrivateOrLoopbackIp("192.168.1.1")).toBe(true);
    expect(isPrivateOrLoopbackIp("169.254.1.1")).toBe(true);
    expect(isPrivateOrLoopbackIp("0.0.0.0")).toBe(true);
  });

  it("flags loopback, unique-local, and link-local IPv6 ranges", () => {
    expect(isPrivateOrLoopbackIp("::1")).toBe(true);
    expect(isPrivateOrLoopbackIp("fc00::1")).toBe(true);
    expect(isPrivateOrLoopbackIp("fd12:3456:789a::1")).toBe(true);
    expect(isPrivateOrLoopbackIp("fe80::1")).toBe(true);
  });

  it("flags IPv4-mapped IPv6 addresses via the IPv4 rules", () => {
    expect(isPrivateOrLoopbackIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateOrLoopbackIp("::ffff:10.0.0.1")).toBe(true);
  });

  it("allows public IPv4/IPv6 addresses", () => {
    expect(isPrivateOrLoopbackIp("8.8.8.8")).toBe(false);
    expect(isPrivateOrLoopbackIp("172.15.0.1")).toBe(false);
    expect(isPrivateOrLoopbackIp("172.32.0.1")).toBe(false);
    expect(isPrivateOrLoopbackIp("2606:4700:4700::1111")).toBe(false);
  });

  it("rejects malformed addresses defensively", () => {
    expect(isPrivateOrLoopbackIp("not-an-ip")).toBe(true);
    expect(isPrivateOrLoopbackIp("999.1.1.1")).toBe(true);
  });
});

describe("assertPublicHttpUrl", () => {
  it("rejects non-http(s) protocols", async () => {
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow("bad_protocol");
    await expect(assertPublicHttpUrl("ftp://example.com/feed.xml")).rejects.toThrow("bad_protocol");
  });

  it("rejects unparseable URLs", async () => {
    await expect(assertPublicHttpUrl("not a url")).rejects.toThrow("invalid_url");
  });

  it("accepts a normal https URL resolving to a public address", async () => {
    const url = await assertPublicHttpUrl("https://one.one.one.one/feed.xml");
    expect(url.hostname).toBe("one.one.one.one");
  });
});
