// JSON.parse normally erases 1 vs 1.0. Node 24 provides the original primitive
// token to the reviver: validate wire number types before Zod sees the marker.
export function parseRemoteMarker(text: string): unknown {
  const parse = JSON.parse as (
    text: string,
    reviver: (
      key: string,
      value: unknown,
      context: { source?: string },
    ) => unknown,
  ) => unknown;
  const marker = parse(text, (_key, value, context) => {
    if (
      typeof value === "number" &&
      (!context?.source ||
        !/^(0|[1-9][0-9]*)$/.test(context.source) ||
        !Number.isSafeInteger(value))
    )
      throw new Error("INVALID_REMOTE_MARKER_NUMBER");
    return value;
  });
  // Native JSON.parse keeps only the last duplicate key. Scan the already valid
  // JSON token stream as well, including escaped spellings of the same key.
  const tokens =
    text.match(/"(?:[^"\\]|\\.)*"|[{}[\],:]|[^\s{}[\],:"]+/g) ?? [];
  const scopes: (Set<string> | null)[] = [];
  tokens.forEach((token, index) => {
    if (token === "{") scopes.push(new Set());
    else if (token === "[") scopes.push(null);
    else if (token === "}" || token === "]") scopes.pop();
    else if (token.startsWith('"') && tokens[index + 1] === ":") {
      const keys = scopes.at(-1);
      const key = JSON.parse(token) as string;
      if (keys?.has(key)) throw new Error("INVALID_REMOTE_MARKER_JSON");
      keys?.add(key);
    }
  });
  return marker;
}
