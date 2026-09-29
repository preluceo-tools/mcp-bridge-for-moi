import { test } from "node:test";
import assert from "node:assert/strict";
import { sectionOf } from "./readme-section.js";

test("a # line inside a fenced code block does not end a README section", () => {
  const md = ["## A", "text", "```sh", "# a comment, not a heading", "```", "more", "## B", "other"].join("\n");
  const a = sectionOf(md, "## A");
  assert.ok(a.includes("# a comment") && a.includes("more"));
  assert.ok(!a.includes("other"));
});
