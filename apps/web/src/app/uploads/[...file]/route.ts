const API_BASE = process.env.API_BASE ?? "http://localhost:8787";

// Only image files are ever stored under /uploads; restrict what this public
// proxy will serve and how the browser treats it.
const SAFE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;

export async function GET(_req: Request, ctx: { params: Promise<{ file: string[] }> }) {
  const { file } = await ctx.params;

  // Reject traversal / encoded slashes / empty segments before building the URL.
  for (const seg of file) {
    if (seg === "." || seg === ".." || !SEGMENT.test(seg)) {
      return new Response("bad path", { status: 400 });
    }
  }

  const target = new URL(`/uploads/${file.join("/")}`, API_BASE);
  const res = await fetch(target);

  const upstream = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const type = SAFE_TYPES.has(upstream) ? upstream : "application/octet-stream";

  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": type,
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    },
  });
}
