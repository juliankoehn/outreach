// LinkedIn renders plain text — strip Markdown so the canvas never shows raw
// syntax mid-stream. Mirrors packages/ai/src/compose.ts stripMarkdown (server
// is the source of truth; this keeps the live preview clean too).
export function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```[^\n]*\n?/g, "").replace(/```/g, ""))
    .replace(/^#{1,6}[ \t]+/gm, "")
    .replace(/^\s{0,3}>[ \t]?/gm, "")
    .replace(/^\s*([*_-])\1{2,}\s*$/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(?<![*\w])(\*|_)(?!\s)(.+?)(?<!\s)\1(?![*\w])/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[ \t]*[*+][ \t]+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
