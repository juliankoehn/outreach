import { Hono, type Context } from "hono";
import { describeImageReferences } from "@outreach/ai";
import type { AppEnv } from "../app.js";
import { getAccountSummary } from "../repos/linkedin-account.js";
import { putObject, getObject, deleteObject } from "../storage.js";
import {
  createResource, listResources, getResource, deleteResource, setResourceImageRef,
} from "../repos/resource.js";

const MAX_IMAGE = 25 * 1024 * 1024;
const MAX_DOC = 50 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const DOC_TYPES = new Set(["application/pdf", "text/plain", "text/markdown"]);
const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
  "application/pdf": "pdf", "text/plain": "txt", "text/markdown": "md",
};

export function resourcesRoutes() {
  const r = new Hono<AppEnv>();

  async function owned(c: Context<AppEnv>) {
    const user = c.get("user")!;
    const accountId = c.req.param("accountId");
    if (!accountId) return null;
    const acct = await getAccountSummary(accountId, user.id);
    return acct ? accountId : null;
  }

  r.post("/accounts/:accountId/resources", async (c) => {
    const accountId = await owned(c);
    if (!accountId) return c.json({ error: "not_found" }, 404);

    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) return c.json({ error: "no_file" }, 400);

    const mime = file.type || "application/octet-stream";
    const isImage = IMAGE_TYPES.has(mime);
    const kind: "image" | "document" = isImage ? "image" : "document";
    if (!isImage && !DOC_TYPES.has(mime)) return c.json({ error: "unsupported_type" }, 415);

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.byteLength > (isImage ? MAX_IMAGE : MAX_DOC)) return c.json({ error: "too_large" }, 413);

    const ext = EXT[mime] ?? "bin";
    // Placeholder id via storage key; row id assigned by DB. Use a random key.
    const key = `resources/${accountId}/${crypto.randomUUID()}.${ext}`;
    await putObject(key, buf, mime);

    const resource = await createResource({
      accountId, kind, name: file.name || `upload.${ext}`, mimeType: mime,
      sizeBytes: buf.byteLength, storageKey: key,
      status: isImage ? "ready" : "pending",
    });
    return c.json({ resource });
  });

  r.get("/accounts/:accountId/resources", async (c) => {
    const accountId = await owned(c);
    if (!accountId) return c.json({ error: "not_found" }, 404);
    const kindParam = c.req.query("kind");
    const kind = kindParam === "image" || kindParam === "document" ? kindParam : undefined;
    return c.json({ resources: await listResources(accountId, kind) });
  });

  r.get("/accounts/:accountId/resources/:id/content", async (c) => {
    const accountId = await owned(c);
    if (!accountId) return c.json({ error: "not_found" }, 404);
    const res = await getResource(c.req.param("id"), accountId);
    if (!res) return c.json({ error: "not_found" }, 404);
    const obj = await getObject(res.storageKey);
    if (!obj) return c.json({ error: "not_found" }, 404);
    // Serve the Content-Type from the upload-validated DB field, never the
    // storage layer's echoed value. Combined with nosniff + a locked-down CSP
    // this prevents a crafted upload from executing as script on the app origin.
    const headers: Record<string, string> = {
      "Content-Type": res.mimeType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };
    if (res.kind === "document") {
      const filename = res.name.replace(/["\r\n]/g, "") || "download";
      headers["Content-Disposition"] = `attachment; filename="${filename}"`;
    }
    return new Response(obj.body, { headers });
  });

  r.patch("/accounts/:accountId/resources/:id/image-ref", async (c) => {
    const accountId = await owned(c);
    if (!accountId) return c.json({ error: "not_found" }, 404);
    const { on } = await c.req.json<{ on: boolean }>().catch(() => ({ on: false }));
    const id = c.req.param("id");

    // Turning a reference ON: derive a short vision descriptor of the photo once
    // and cache it on the resource, so image generation can reuse it as a text
    // hint without re-reading pixels every time. Turning OFF is a pure toggle.
    let refDescription: string | undefined;
    if (on) {
      const res = await getResource(id, accountId);
      if (!res) return c.json({ error: "not_found" }, 404);
      const obj = await getObject(res.storageKey);
      if (obj) {
        const base64 = Buffer.from(obj.body).toString("base64");
        refDescription = await describeImageReferences([{ base64, mediaType: res.mimeType }]);
      }
    }

    const updated = await setResourceImageRef(id, accountId, on, refDescription);
    if (!updated) return c.json({ error: "not_found" }, 404);
    return c.json({ resource: updated });
  });

  r.delete("/accounts/:accountId/resources/:id", async (c) => {
    const accountId = await owned(c);
    if (!accountId) return c.json({ error: "not_found" }, 404);
    const removed = await deleteResource(c.req.param("id"), accountId);
    if (!removed) return c.json({ error: "not_found" }, 404);
    await deleteObject(removed.storageKey);
    return c.json({ ok: true });
  });

  return r;
}
