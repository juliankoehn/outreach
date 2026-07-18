const API_BASE = process.env.API_BASE ?? "http://localhost:8787";

export async function GET(_req: Request, ctx: { params: Promise<{ file: string[] }> }) {
  const { file } = await ctx.params;
  const res = await fetch(`${API_BASE}/uploads/${file.join("/")}`);
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "image/png" },
  });
}
