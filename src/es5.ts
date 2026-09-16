import assert from "node:assert/strict";
import { parse } from "acorn";

/**
 * Test helper. MoI runs ECMAScript 5 only, and `new Function` accepts anything Node can
 * run, so every MoI-side script is parsed here as ES5. The source is parsed as a function
 * body (a top-level `return` is legal); a failure names `label` and acorn's line:column.
 */
export function assertES5(source: string, label: string): void {
  try {
    parse(source, { ecmaVersion: 5, allowReturnOutsideFunction: true });
  } catch (e) {
    assert.fail(`${label} is not ES5: ${(e as Error).message}`);
  }
}
