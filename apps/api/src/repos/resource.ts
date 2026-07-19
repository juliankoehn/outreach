import { prisma } from "@outreach/db";
import type { Resource } from "@outreach/db";

export interface CreateResourceInput {
  accountId: string; kind: "image" | "document"; name: string;
  mimeType: string; sizeBytes: number; storageKey: string;
  status?: string; meta?: object;
}

export function createResource(input: CreateResourceInput): Promise<Resource> {
  return prisma.resource.create({
    data: {
      accountId: input.accountId, kind: input.kind, name: input.name,
      mimeType: input.mimeType, sizeBytes: input.sizeBytes, storageKey: input.storageKey,
      status: input.status ?? "ready", meta: (input.meta as object | undefined) ?? undefined,
    },
  });
}

export function listResources(accountId: string, kind?: "image" | "document"): Promise<Resource[]> {
  return prisma.resource.findMany({
    where: { accountId, ...(kind ? { kind } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

export function getResource(id: string, accountId: string): Promise<Resource | null> {
  return prisma.resource.findFirst({ where: { id, accountId } });
}

export async function deleteResource(id: string, accountId: string): Promise<Resource | null> {
  const r = await getResource(id, accountId);
  if (!r) return null;
  await prisma.resource.delete({ where: { id } });
  return r;
}

export async function setResourceImageRef(
  id: string, accountId: string, on: boolean, refDescription?: string,
): Promise<Resource | null> {
  const r = await prisma.resource.findFirst({ where: { id, accountId, kind: "image" } });
  if (!r) return null;
  const meta = { ...((r.meta as object | null) ?? {}), ...(refDescription ? { refDescription } : {}) };
  return prisma.resource.update({ where: { id }, data: { isImageRef: on, meta } });
}

export function listImageReferences(accountId: string): Promise<Resource[]> {
  return prisma.resource.findMany({ where: { accountId, kind: "image", isImageRef: true } });
}
