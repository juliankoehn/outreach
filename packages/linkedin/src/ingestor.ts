import type { RawPost } from "@outreach/core";

export interface PostIngestor {
  fetch(): Promise<RawPost[]>;
}

export class LinkedInReadUnavailableError extends Error {
  constructor(message = "LinkedIn API does not permit reading this member's posts.") {
    super(message);
    this.name = "LinkedInReadUnavailableError";
  }
}
