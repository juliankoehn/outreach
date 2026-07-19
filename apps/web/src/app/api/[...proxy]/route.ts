import { apiUrl } from "@/lib/api";

const API_BASE = process.env.API_BASE ?? "http://localhost:8787";
const MAX_BODY_BYTES = 50 * 1024 * 1024; // 50MB — matches the api's MAX_DOC cap.

async function forward(req: Request, path: string[]): Promise<Response> {
  const url = apiUrl(API_BASE, "/" + path.join("/")) + (new URL(req.url).search || "");
  const isBodyless = req.method === "GET" || req.method === "HEAD";
  if (!isBodyless) {
    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: "too_large" }), {
        status: 413,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
  const res = await fetch(url, {
    method: req.method,
    headers: req.headers,
    body: isBodyless ? undefined : await req.arrayBuffer(),
    redirect: "manual",
  });
  // Pass through status, body, and Set-Cookie/Location headers.
  const headers = new Headers(res.headers);
  return new Response(res.body, { status: res.status, headers });
}

export async function GET(req: Request, ctx: { params: Promise<{ proxy: string[] }> }) {
  return forward(req, (await ctx.params).proxy);
}
export async function POST(req: Request, ctx: { params: Promise<{ proxy: string[] }> }) {
  return forward(req, (await ctx.params).proxy);
}
export async function PATCH(req: Request, ctx: { params: Promise<{ proxy: string[] }> }) {
  return forward(req, (await ctx.params).proxy);
}
export async function DELETE(req: Request, ctx: { params: Promise<{ proxy: string[] }> }) {
  return forward(req, (await ctx.params).proxy);
}
