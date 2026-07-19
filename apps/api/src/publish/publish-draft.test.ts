// apps/api/src/publish/publish-draft.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@outreach/db";
import { encrypt } from "@outreach/core";
import { env } from "../env.js";
import { publishDraft } from "./publish-draft.js";
import type { PublishDeps } from "./publish-draft.js";

let userId = "";

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

beforeAll(async () => {
  userId = uid("u");
  await prisma.user.create({ data: { id: userId, email: `${userId}@ex.com` } });
});

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

async function makeAccount(overrides?: {
  tokenExpiresAt?: Date | null;
  refreshToken?: string | null;
  status?: string;
}) {
  const a = await prisma.linkedInAccount.create({
    data: {
      userId,
      memberUrn: `urn:li:person:${uid("m")}`,
      displayName: "T",
      accessToken: encrypt("access-token", env.ENCRYPTION_KEY),
      refreshToken:
        overrides?.refreshToken === undefined
          ? encrypt("refresh-token", env.ENCRYPTION_KEY)
          : overrides.refreshToken
            ? encrypt(overrides.refreshToken, env.ENCRYPTION_KEY)
            : null,
      tokenExpiresAt: overrides?.tokenExpiresAt === undefined ? new Date(Date.now() + 3600_000) : overrides.tokenExpiresAt,
      scopes: [],
      status: overrides?.status ?? "active",
    },
  });
  return a;
}

async function makeDraft(accountId: string, data: { text?: string; imageUrl?: string; sourceFeedItemId?: string } = {}) {
  return prisma.draft.create({
    data: {
      linkedinAccountId: accountId,
      text: data.text ?? "hello world",
      imageUrl: data.imageUrl,
      sourceFeedItemId: data.sourceFeedItemId,
    },
  });
}

function fakeClient(overrides?: {
  uploadImage?: (...args: unknown[]) => Promise<string>;
  createPost?: (...args: unknown[]) => Promise<string>;
  addComment?: (...args: unknown[]) => Promise<void>;
}) {
  return {
    uploadImage: vi.fn(overrides?.uploadImage ?? (async () => "urn:li:image:fake")),
    createPost: vi.fn(overrides?.createPost ?? (async () => "urn:li:share:fake")),
    addComment: vi.fn(overrides?.addComment ?? (async () => undefined)),
  };
}

describe("publishDraft", () => {
  it("text-only success: creates the post, no image/comment calls, persists published state", async () => {
    const account = await makeAccount();
    const draft = await makeDraft(account.id, { text: "just text" });
    const client = fakeClient();
    const deps: PublishDeps = { makeClient: () => client as never };

    const result = await publishDraft(draft.id, account.id, userId, deps);

    expect(client.createPost).toHaveBeenCalledWith(
      expect.objectContaining({ authorUrn: account.memberUrn, text: "just text" }),
    );
    expect(client.uploadImage).not.toHaveBeenCalled();
    expect(client.addComment).not.toHaveBeenCalled();
    expect(result.status).toBe("published");
    expect(result.externalId).toBe("urn:li:share:fake");
    expect(result.publishError).toBeNull();
  });

  it("with image: uploads then creates post with the returned image urn", async () => {
    const account = await makeAccount();
    const draft = await makeDraft(account.id, { imageUrl: "/generated/pic.png" });
    const client = fakeClient({ uploadImage: async () => "urn:li:image:uploaded" });
    const getObjectImpl = vi.fn(async () => ({ body: new Uint8Array([1, 2, 3]), contentType: "image/png" }));
    const deps: PublishDeps = { makeClient: () => client as never, getObjectImpl };

    const result = await publishDraft(draft.id, account.id, userId, deps);

    expect(getObjectImpl).toHaveBeenCalledWith("generated/pic.png");
    expect(client.uploadImage).toHaveBeenCalledWith(account.memberUrn, expect.any(Uint8Array), "image/png");
    expect(client.createPost).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrn: "urn:li:image:uploaded" }),
    );
    expect(result.status).toBe("published");
  });

  it("with source: adds first comment with 'Quelle: <url>'; comment failure still leaves draft published", async () => {
    const account = await makeAccount();
    const source = await prisma.feedSource.create({ data: { userId, url: `https://ex.com/${uid("s")}`, title: "S" } });
    const item = await prisma.feedItem.create({
      data: {
        sourceId: source.id,
        userId,
        guid: uid("g"),
        title: "Item",
        url: "https://example.com/article",
        excerpt: "excerpt",
      },
    });
    const draft = await makeDraft(account.id, { sourceFeedItemId: item.id });
    const client = fakeClient({
      addComment: async () => {
        throw new Error("comment boom");
      },
    });
    const deps: PublishDeps = { makeClient: () => client as never };

    const result = await publishDraft(draft.id, account.id, userId, deps);

    expect(client.addComment).toHaveBeenCalledWith("urn:li:share:fake", account.memberUrn, "Quelle: https://example.com/article");
    expect(result.status).toBe("published"); // comment failure swallowed
  });

  it("token refresh: refreshes an expired token, persists new tokens, uses new token for post", async () => {
    const account = await makeAccount({ tokenExpiresAt: new Date(Date.now() - 1000) });
    const draft = await makeDraft(account.id);
    const client = fakeClient();
    const refresh = vi.fn(async () => ({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresIn: 3600,
      scopes: [],
    }));
    const deps: PublishDeps = { makeClient: () => client as never, oauth: { refresh } };

    const result = await publishDraft(draft.id, account.id, userId, deps);

    expect(refresh).toHaveBeenCalledWith("refresh-token");
    expect(result.status).toBe("published");

    const { getDecryptedAccount } = await import("../repos/linkedin-account.js");
    const updated = await getDecryptedAccount(account.id, userId);
    expect(updated?.accessToken).toBe("new-access-token");
    expect(updated?.status).toBe("active");
  });

  it("refresh failure: marks account expired and draft failed without calling the client", async () => {
    const account = await makeAccount({ tokenExpiresAt: new Date(Date.now() - 1000) });
    const draft = await makeDraft(account.id);
    const client = fakeClient();
    const refresh = vi.fn(async () => {
      throw new Error("refresh boom");
    });
    const deps: PublishDeps = { makeClient: () => client as never, oauth: { refresh } };

    const result = await publishDraft(draft.id, account.id, userId, deps);

    expect(client.createPost).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.publishError).toBeTruthy();

    const { getDecryptedAccount } = await import("../repos/linkedin-account.js");
    const updated = await getDecryptedAccount(account.id, userId);
    expect(updated?.status).toBe("expired");
  });

  it("already published guard: returns unchanged without calling the client", async () => {
    const account = await makeAccount();
    const draft = await prisma.draft.create({
      data: { linkedinAccountId: account.id, text: "already", status: "published", externalId: "urn:li:share:old" },
    });
    const client = fakeClient();
    const deps: PublishDeps = { makeClient: () => client as never };

    const result = await publishDraft(draft.id, account.id, userId, deps);

    expect(client.createPost).not.toHaveBeenCalled();
    expect(result.status).toBe("published");
    expect(result.externalId).toBe("urn:li:share:old");
  });

  it("already publishing guard: concurrent claim (worker mid-publish or double-click) returns without calling the client", async () => {
    const account = await makeAccount();
    const draft = await prisma.draft.create({
      data: { linkedinAccountId: account.id, text: "in flight", status: "publishing" },
    });
    const client = fakeClient();
    const deps: PublishDeps = { makeClient: () => client as never };

    const result = await publishDraft(draft.id, account.id, userId, deps);

    expect(client.createPost).not.toHaveBeenCalled();
    expect(result.status).toBe("publishing");
  });
});
