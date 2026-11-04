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
  return parse(text, (_key, value, context) => {
    if (
      typeof value === "number" &&
      (!context?.source ||
        !/^(0|[1-9][0-9]*)$/.test(context.source) ||
        !Number.isSafeInteger(value))
    )
      throw new Error("INVALID_REMOTE_MARKER_NUMBER");
    return value;
  });
}
