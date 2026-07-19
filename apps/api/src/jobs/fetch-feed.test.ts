import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import { createSource, listItems } from "../repos/feed.js";
import { fetchFeed } from "../feed/fetch.js";
import { fetchFeedSource } from "./fetch-feed.js";

vi.mock("../feed/fetch.js");

let userId = "";
let sourceId = "";
beforeAll(async () => {
	const u = await prisma.user.create({
		data: { id: `u${Date.now()}`, email: `ff${Date.now()}@ex.com`, name: "FF" },
	});
	userId = u.id;
	const s = await createSource({ userId, url: "https://ex.com/rss", title: "Ex" });
	sourceId = s.id;
});
afterAll(async () => {
	await prisma.user.delete({ where: { id: userId } });
	await prisma.$disconnect();
});

describe("fetchFeedSource", () => {
	it("inserts items and marks source active on success", async () => {
		vi.mocked(fetchFeed).mockResolvedValueOnce({
			title: "Ex",
			items: [
				{ guid: "g1", title: "A", url: "https://ex.com/a", excerpt: "aa", publishedAt: new Date() },
				{ guid: "g2", title: "B", url: "https://ex.com/b", excerpt: "bb", publishedAt: new Date() },
			],
		});

		await fetchFeedSource(sourceId);

		const items = await listItems(userId, "all");
		expect(items.length).toBe(2);
		const source = await prisma.feedSource.findUniqueOrThrow({ where: { id: sourceId } });
		expect(source.status).toBe("active");
		expect(source.lastFetchedAt).not.toBeNull();
	});

	it("marks source error and does not throw when fetchFeed fails", async () => {
		vi.mocked(fetchFeed).mockRejectedValueOnce(new Error("boom"));

		await expect(fetchFeedSource(sourceId)).resolves.toBeUndefined();

		const source = await prisma.feedSource.findUniqueOrThrow({ where: { id: sourceId } });
		expect(source.status).toBe("error");
		expect(source.error).toBe("boom");
	});

	it("returns early for an unknown source id", async () => {
		await expect(fetchFeedSource("nonexistent-id")).resolves.toBeUndefined();
	});
});
