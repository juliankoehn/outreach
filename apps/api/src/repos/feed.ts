import { prisma } from "@outreach/db";
import type { FeedSource, FeedItem } from "@outreach/db";

export interface ParsedItem {
	guid: string;
	title: string;
	url: string;
	excerpt: string;
	imageUrl?: string | null;
	author?: string | null;
	publishedAt?: Date | null;
}

export function createSource(input: {
	userId: string;
	url: string;
	title: string;
}): Promise<FeedSource> {
	return prisma.feedSource.create({ data: input });
}
export function listSources(userId: string): Promise<FeedSource[]> {
	return prisma.feedSource.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}
export function getSource(id: string, userId: string): Promise<FeedSource | null> {
	return prisma.feedSource.findFirst({ where: { id, userId } });
}
export async function deleteSource(id: string, userId: string): Promise<boolean> {
	const s = await getSource(id, userId);
	if (!s) return false;
	await prisma.feedSource.delete({ where: { id } });
	return true;
}
export async function updateSourceFetchState(
	id: string,
	patch: { status?: string; error?: string | null; lastFetchedAt?: Date },
): Promise<void> {
	await prisma.feedSource.update({ where: { id }, data: patch });
}
export async function insertItems(
	sourceId: string,
	userId: string,
	items: ParsedItem[],
): Promise<number> {
	if (items.length === 0) return 0;
	const res = await prisma.feedItem.createMany({
		data: items.map((i) => ({
			sourceId,
			userId,
			guid: i.guid,
			title: i.title,
			url: i.url,
			excerpt: i.excerpt,
			imageUrl: i.imageUrl ?? null,
			author: i.author ?? null,
			publishedAt: i.publishedAt ?? null,
		})),
		skipDuplicates: true, // dedupe on @@unique([sourceId, guid])
	});
	return res.count;
}
export function listItems(
	userId: string,
	status?: string,
	limit = 100,
): Promise<FeedItem[]> {
	return prisma.feedItem.findMany({
		where: { userId, ...(status && status !== "all" ? { status } : {}) },
		orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
		take: limit,
	});
}
export function getItem(id: string, userId: string): Promise<FeedItem | null> {
	return prisma.feedItem.findFirst({ where: { id, userId } });
}
export async function setItemStatus(
	id: string,
	userId: string,
	status: string,
): Promise<FeedItem | null> {
	const it = await getItem(id, userId);
	if (!it) return null;
	return prisma.feedItem.update({ where: { id }, data: { status } });
}
