import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@outreach/db";
import {
	createSource,
	listSources,
	deleteSource,
	updateSourceFetchState,
	insertItems,
	listItems,
	setItemStatus,
} from "./feed.js";

let userId = "";
let sourceId = "";
beforeAll(async () => {
	const u = await prisma.user.create({
		data: { id: `u${Date.now()}`, email: `f${Date.now()}@ex.com`, name: "F" },
	});
	userId = u.id;
});
afterAll(async () => {
	await prisma.user.delete({ where: { id: userId } });
	await prisma.$disconnect();
});

describe("feed repo", () => {
	it("creates source, inserts items with dedupe, lists+scopes, sets status", async () => {
		const s = await createSource({ userId, url: "https://ex.com/rss", title: "Ex" });
		sourceId = s.id;
		expect((await listSources(userId)).length).toBe(1);

		const items = [
			{ guid: "g1", title: "A", url: "https://ex.com/a", excerpt: "aa", publishedAt: new Date() },
			{ guid: "g2", title: "B", url: "https://ex.com/b", excerpt: "bb", publishedAt: new Date() },
		];
		expect(await insertItems(sourceId, userId, items)).toBe(2);
		expect(await insertItems(sourceId, userId, items)).toBe(0); // dedupe: no new rows

		expect((await listItems(userId, "new")).length).toBe(2);
		const first = (await listItems(userId, "new"))[0]!;
		await setItemStatus(first.id, userId, "dismissed");
		expect((await listItems(userId, "new")).length).toBe(1);
		expect((await listItems(userId, "dismissed")).length).toBe(1);

		await updateSourceFetchState(sourceId, { status: "error", error: "boom" });
		expect((await listSources(userId))[0]!.status).toBe("error");

		await deleteSource(sourceId, userId); // cascades items
		expect((await listItems(userId, "all")).length).toBe(0);
	});
});
