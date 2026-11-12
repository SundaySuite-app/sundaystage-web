/**
 * Pins the vendored lib/webframe.schema.json to the live zod schema. The same
 * file is vendored into the desktop repo (sundaystage/src/lib/webframe.schema.json),
 * where a test validates the desktop forwarder's output against it — so any
 * change to the WebFrame contract fails CI here until the checked-in schema is
 * regenerated, and fails the desktop CI until its copy (and its clamping) is
 * updated to match. That closes the drift that once let the desktop send
 * frames the server 400-rejected wholesale (silently freezing displays).
 *
 * The checked-in file keeps the legacy `zod-to-json-schema` envelope
 * (`$ref` + `definitions.WebFrame`) because the desktop repo vendors it
 * byte-for-byte. Zod 4 ships its own generator, so this test compares the
 * native `z.toJSONSchema` output against the unwrapped definition. Regenerate
 * the body with:
 *   z.toJSONSchema(WebFrame, { target: "draft-7", io: "output" })
 * and re-wrap it as `{ $ref: "#/definitions/WebFrame", definitions: { WebFrame: <body without $schema> }, $schema }`.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { WebFrame } from "@/lib/webframe";
import checkedIn from "@/lib/webframe.schema.json";

describe("webframe.schema.json", () => {
  it("matches the schema generated from the live zod WebFrame", () => {
    const { $schema, ...body } = z.toJSONSchema(WebFrame, {
      target: "draft-7",
      io: "output",
    }) as Record<string, unknown>;
    const wrapped = {
      $ref: "#/definitions/WebFrame",
      definitions: { WebFrame: body },
      $schema,
    };
    expect(JSON.parse(JSON.stringify(wrapped))).toEqual(checkedIn);
  });
});
