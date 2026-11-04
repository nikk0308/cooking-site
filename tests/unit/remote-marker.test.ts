import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseRemoteMarker } from "../../scripts/backup/remote-marker";

const schema = z.object({
  format: z.literal(1),
  bytes: z.number().int().positive(),
});
describe("owner-decrypted COMPLETE wire types", () => {
  it("accepts historical integer tokens and formatting", () => {
    expect(
      schema.parse(parseRemoteMarker(' { "bytes": 1, "format": 1 } ')),
    ).toEqual({ format: 1, bytes: 1 });
  });
  for (const value of ["true", "false", "1.0", "1e0", '"1"']) {
    it(`rejects format ${value}`, () => {
      const check = () =>
        schema.parse(parseRemoteMarker(`{"format":${value},"bytes":1}`));
      if (value === "1.0" || value === "1e0")
        expect(check).toThrow("INVALID_REMOTE_MARKER_NUMBER");
      else expect(check).toThrow();
    });
    it(`rejects bytes ${value}`, () => {
      expect(() =>
        schema.parse(parseRemoteMarker(`{"format":1,"bytes":${value}}`)),
      ).toThrow();
    });
  }
  it("rejects duplicate keys, including escaped and nested spellings", () => {
    for (const text of [
      '{"format":true,"format":1}',
      '{"format":1,"\\u0066ormat":1}',
      '{"objects":{"media":{"bytes":1,"bytes":1}}}',
    ])
      expect(() => parseRemoteMarker(text)).toThrow(
        "INVALID_REMOTE_MARKER_JSON",
      );
    expect(parseRemoteMarker('{"a":{"bytes":1},"b":{"bytes":1}}')).toEqual({
      a: { bytes: 1 },
      b: { bytes: 1 },
    });
  });
  it("rejects unsafe rounded sizes", () => {
    expect(() => parseRemoteMarker('{"bytes":9007199254740993}')).toThrow(
      "INVALID_REMOTE_MARKER_NUMBER",
    );
  });
});
