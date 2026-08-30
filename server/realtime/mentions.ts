// server/realtime/mentions.ts — @handle token parser.
//
// Handles are lowercase, no '@' (shared/types.ts User.handle doc comment). A mention token is
// '@' followed by 2-32 word characters, not preceded by another word character (so 'foo@bar'
// is not a mention of 'bar').

const MENTION_RE = /(^|[^\w@])@([a-z0-9_]{2,32})\b/gi;

export function extractHandles(text: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(text))) {
    out.add(m[2]!.toLowerCase());
  }
  return [...out];
}
