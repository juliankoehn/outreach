import { prisma } from "@outreach/db";
import { updateSourceFetchState, insertItems } from "../repos/feed.js";
import { fetchFeed } from "../feed/fetch.js";

// Loaded without a userId (job context has none) — read the row directly.
async function sourceById(id: string) {
	return prisma.feedSource.findUnique({ where: { id } });
}

// A single broken feed must not crash the worker or retry-storm — mark it
// "error" and return (no throw), so pg-boss treats the job as done.
export async function fetchFeedSource(sourceId: string): Promise<void> {
	const source = await sourceById(sourceId);
	if (!source) return;
	try {
		const feed = await fetchFeed(source.url);
		await insertItems(source.id, source.userId, feed.items);
		await updateSourceFetchState(source.id, { status: "active", error: null, lastFetchedAt: new Date() });
	} catch (e) {
		await updateSourceFetchState(source.id, {
			status: "error",
			error: String((e as Error).message ?? e),
			lastFetchedAt: new Date(),
		});
	}
}
