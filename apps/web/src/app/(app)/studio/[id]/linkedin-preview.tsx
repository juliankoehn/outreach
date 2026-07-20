"use client";

import { FeedPostImage, FeedPostShell } from "@/components/linkedin-feed-post";

interface LinkedInPreviewProps {
  authorName: string;
  avatarUrl?: string | null;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  imageUrl?: string | null;
  placeholder?: string;
  readOnly?: boolean;
}

// A LinkedIn-flavoured preview of the draft: author header, the editable post
// body styled like a real feed post, the image edge-to-edge, and a muted
// reaction bar. Adapts to the app theme rather than forcing LinkedIn's exact
// colours, so it reads as a preview in both light and dark.
export function LinkedInPreview({
  authorName,
  avatarUrl,
  value,
  onChange,
  onBlur,
  imageUrl,
  placeholder,
  readOnly,
}: LinkedInPreviewProps) {
  return (
    <FeedPostShell authorName={authorName} avatarUrl={avatarUrl}>
      {/* Post body — editable, styled like the feed */}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        readOnly={readOnly}
        rows={1}
        className="mt-2 field-sizing-content min-h-[7rem] w-full resize-none bg-transparent px-4 pb-1 text-[15px] leading-[1.45] outline-none placeholder:text-muted-foreground read-only:cursor-default"
      />
      <FeedPostImage src={imageUrl} />
    </FeedPostShell>
  );
}
