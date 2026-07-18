import { apiUrl } from "@/lib/api";

const API_BASE = process.env.API_BASE ?? "http://localhost:8787";

async function forward(req: Request, path: string[]): Promise<Response> {
  const url = apiUrl(API_BASE, "/" + path.join("/")) + (new URL(req.url).search || "");
  const res = await fetch(url, {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
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
