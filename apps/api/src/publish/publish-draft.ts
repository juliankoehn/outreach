// apps/api/src/publish/publish-draft.ts
import type { Draft } from "@outreach/db";
import { LinkedInPublishClient, LinkedInPublishError, LinkedInOAuthClient, type TokenResponse } from "@outreach/linkedin";
import { getDraft, setPublishResult, claimDraftForPublish } from "../repos/draft.js";
import { recordPublishedPost } from "../repos/post.js";
import { getDecryptedAccount, updateAccountTokens, setAccountStatus } from "../repos/linkedin-account.js";
import { getObject } from "../storage.js";
import { getItem } from "../repos/feed.js";
import { env } from "../env.js";

export interface PublishDeps {
  makeClient?: (accessToken: string) => LinkedInPublishClient;
  oauth?: { refresh(refreshToken: string): Promise<TokenResponse> };
  getObjectImpl?: typeof getObject;
  getItemImpl?: typeof getItem;
  // Set only by the publish-due worker: `claimDuePublishDrafts` already atomically
  // flipped this draft's status to "publishing" via a single UPDATE ... RETURNING
  // before publishDraft was ever called, so re-claiming here would just see
  // status="publishing" and (correctly, for any OTHER caller) refuse to publish.
  // The worker is the legitimate owner of that claim, so it skips this check.
  skipClaim?: boolean;
}

const REFRESH_SKEW_MS = 60_000;

export async function publishDraft(
  draftId: string,
  accountId: string,
  userId: string,
  deps: PublishDeps = {},
): Promise<Draft> {
  const draft = await getDraft(draftId, accountId);
  if (!draft) throw new Error("draft not found");
  if (draft.status === "published") return draft;

  if (!deps.skipClaim) {
    const claimed = await claimDraftForPublish(draftId, accountId);
    if (!claimed) return (await getDraft(draftId, accountId)) as Draft;
  }

  const account = await getDecryptedAccount(accountId, userId);
  if (!account) throw new Error("account not found");

  const oauth = deps.oauth ?? {
    refresh: (refreshToken: string) =>
      new LinkedInOAuthClient({
        clientId: env.LINKEDIN_CLIENT_ID,
        clientSecret: env.LINKEDIN_CLIENT_SECRET,
        redirectUri: env.LINKEDIN_REDIRECT_URI,
      }).refresh(refreshToken),
  };
  const getObjectFn = deps.getObjectImpl ?? getObject;
  const getItemFn = deps.getItemImpl ?? getItem;

  // --- ensureToken ---
  let accessToken = account.accessToken;
  const needsRefresh = account.tokenExpiresAt == null || account.tokenExpiresAt.getTime() <= Date.now() + REFRESH_SKEW_MS;
  if (needsRefresh) {
    if (!account.refreshToken) {
      return failAccountAndDraft(accountId, draftId, "no refresh token available; account requires re-authentication");
    }
    let refreshed: TokenResponse;
    try {
      refreshed = await oauth.refresh(account.refreshToken);
    } catch (e) {
      return failAccountAndDraft(accountId, draftId, e instanceof Error ? e.message : "token refresh failed");
    }
    await updateAccountTokens(accountId, refreshed);
    accessToken = refreshed.accessToken;
  }

  const client = deps.makeClient
    ? deps.makeClient(accessToken)
    : new LinkedInPublishClient({ accessToken, apiVersion: env.LINKEDIN_API_VERSION });

  try {
    let imageUrn: string | undefined;
    if (draft.imageUrl) {
      const key = draft.imageUrl.replace(/^\//, "");
      const obj = await getObjectFn(key);
      if (obj) {
        imageUrn = await client.uploadImage(account.memberUrn, obj.body, obj.contentType);
      }
    }

    const postUrn = await client.createPost({ authorUrn: account.memberUrn, text: draft.text, imageUrn });

    if (draft.sourceFeedItemId) {
      const item = await getItemFn(draft.sourceFeedItemId, userId);
      if (item) {
        try {
          await client.addComment(postUrn, account.memberUrn, `Quelle: ${item.url}`);
        } catch {
          // swallow: the post itself is already live, don't fail the publish for the comment
        }
      }
    }

    const publishedAt = new Date();
    await setPublishResult(draftId, accountId, {
      status: "published",
      publishedAt,
      externalId: postUrn,
      publishError: null,
    });
    // Mirror the published post into the account's post history (best-effort: a
    // failure here must NOT flip the already-live post to "failed").
    try {
      await recordPublishedPost({
        accountId,
        text: draft.text,
        externalId: postUrn,
        mediaType: draft.imageUrl ? "image" : "none",
        publishedAt,
      });
    } catch {
      // swallow: the post is live and the draft is marked published.
    }
  } catch (e) {
    if (e instanceof LinkedInPublishError && e.status === 401) {
      await setAccountStatus(accountId, "expired");
    }
    const message = e instanceof Error ? e.message : "publish failed";
    await setPublishResult(draftId, accountId, { status: "failed", publishError: message });
  }

  return getDraft(draftId, accountId) as Promise<Draft>;
}

async function failAccountAndDraft(accountId: string, draftId: string, message: string): Promise<Draft> {
  await setAccountStatus(accountId, "expired");
  await setPublishResult(draftId, accountId, { status: "failed", publishError: message });
  return getDraft(draftId, accountId) as Promise<Draft>;
}
