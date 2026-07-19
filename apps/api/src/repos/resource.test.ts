import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import {
  createResource, listResources, getResource, deleteResource,
  setResourceImageRef, listImageReferences,
} from "./resource.js";

let userId = "", accountId = "";
beforeAll(async () => {
  userId = `r${Date.now()}`;
  await prisma.user.create({ data: { id: userId, email: `${userId}@ex.com`, name: "R" } });
  const a = await prisma.linkedInAccount.create({
    data: { userId, memberUrn: `urn:li:person:${Date.now()}`, displayName: "T", accessToken: "e", scopes: [] },
  });
  accountId = a.id;
});
afterAll(async () => { await prisma.user.delete({ where: { id: userId } }); await prisma.$disconnect(); });

describe("resource repo", () => {
  it("creates, lists by kind, toggles ref, deletes", async () => {
    const img = await createResource({ accountId, kind: "image", name: "me.png", mimeType: "image/png", sizeBytes: 10, storageKey: "k1", status: "ready" });
    await createResource({ accountId, kind: "document", name: "grundschutz.pdf", mimeType: "application/pdf", sizeBytes: 99, storageKey: "k2", status: "pending" });

    expect((await listResources(accountId, "image")).length).toBe(1);
    expect((await listResources(accountId, "document")).length).toBe(1);
    expect((await listResources(accountId)).length).toBe(2);

    await setResourceImageRef(img.id, accountId, true, "a person with short dark hair");
    const refs = await listImageReferences(accountId);
    expect(refs.map((r) => r.id)).toEqual([img.id]);
    expect((refs[0]!.meta as { refDescription?: string }).refDescription).toContain("dark hair");

    expect(await getResource(img.id, "nope")).toBeNull();
    await deleteResource(img.id, accountId);
    expect(await getResource(img.id, accountId)).toBeNull();
  });
});
