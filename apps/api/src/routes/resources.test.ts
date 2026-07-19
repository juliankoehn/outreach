import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { createApp } from "../app.js";

let userId = "", accountId = "", cookie = "";
const app = createApp();

async function signup() {
  const email = `res${Date.now()}-${Math.random().toString(36).slice(2)}@ex.com`;
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: process.env.WEB_ORIGIN! },
    body: JSON.stringify({ email, password: "password-1234", name: "R" }),
  });
  return { cookie: res.headers.get("set-cookie")!.split(";")[0]!, email };
}

beforeAll(async () => {
  const s = await signup(); cookie = s.cookie;
  userId = (await prisma.user.findFirstOrThrow({ where: { email: s.email } })).id;
  accountId = (await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:li:person:${Date.now()}`, displayName: "T", accessToken: "e", scopes: [] },
  })).id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

function upload(kind: "image" | "document") {
  const fd = new FormData();
  const [bytes, name, type] = kind === "image"
    ? [new Uint8Array([137, 80, 78, 71]), "me.png", "image/png"]
    : [new TextEncoder().encode("norm text"), "norm.pdf", "application/pdf"];
  fd.set("file", new File([bytes], name, { type }));
  return app.request(`/linkedin/accounts/${accountId}/resources`, { method: "POST", headers: { Cookie: cookie }, body: fd });
}

describe("resources routes", () => {
  it("uploads image + document, lists, streams, deletes", async () => {
    const up = await upload("image");
    expect(up.status).toBe(200);
    const { resource } = (await up.json()) as { resource: { id: string; kind: string; status: string } };
    expect(resource.kind).toBe("image");
    expect(resource.status).toBe("ready");

    const doc = await upload("document");
    expect(((await doc.json()) as { resource: { status: string } }).resource.status).toBe("pending");

    const list = await app.request(`/linkedin/accounts/${accountId}/resources?kind=image`, { headers: { Cookie: cookie } });
    expect(((await list.json()) as { resources: unknown[] }).resources.length).toBe(1);

    const content = await app.request(`/linkedin/accounts/${accountId}/resources/${resource.id}/content`, { headers: { Cookie: cookie } });
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toContain("image/png");
    expect(content.headers.get("x-content-type-options")).toBe("nosniff");

    const del = await app.request(`/linkedin/accounts/${accountId}/resources/${resource.id}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(del.status).toBe(200);
  });

  it("rejects an SVG upload with 415", async () => {
    const fd = new FormData();
    fd.set("file", new File([new TextEncoder().encode("<svg onload=alert(1)/>")], "x.svg", { type: "image/svg+xml" }));
    const res = await app.request(`/linkedin/accounts/${accountId}/resources`, { method: "POST", headers: { Cookie: cookie }, body: fd });
    expect(res.status).toBe(415);
  });

  it("rejects cross-user access", async () => {
    const other = await signup();
    const res = await app.request(`/linkedin/accounts/${accountId}/resources`, { headers: { Cookie: other.cookie } });
    expect(res.status).toBe(404);
  });
});
