/**
 * Pins the vendored lib/webframe.schema.json to the live zod schema. The same
 * file is vendored into the desktop repo (sundaystage/src/lib/webframe.schema.json),
 * where a test validates the desktop forwarder's output against it — so any
 * change to the WebFrame contract fails CI here until the checked-in schema is
 * regenerated, and fails the desktop CI until its copy (and its clamping) is
 * updated to match. That closes the drift that once let the desktop send
 * frames the server 400-rejected wholesale (silently freezing displays).
 *
 * Regenerate with:
 *   import { zodToJsonSchema } from "zod-to-json-schema";
 *   zodToJsonSchema(WebFrame, { name: "WebFrame", target: "jsonSchema7" })
 */
import { describe, expect, it } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import { WebFrame } from "@/lib/webframe";
import checkedIn from "@/lib/webframe.schema.json";

describe("webframe.schema.json", () => {
  it("matches the schema generated from the live zod WebFrame", () => {
    const generated = zodToJsonSchema(WebFrame, {
      name: "WebFrame",
      target: "jsonSchema7",
    });
    expect(JSON.parse(JSON.stringify(generated))).toEqual(checkedIn);
  });
});
