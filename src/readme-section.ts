/**
 * The README reader the tests share. Test-only; never published.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The text under the heading line `heading` (e.g. "## Token use"), up to the next heading. A `#`
 * line inside a fenced code block is code, not a heading.
 */
export function sectionOf(markdown: string, heading: string): string {
  const out: string[] = [];
  let found = false, fenced = false;
  for (const line of markdown.split("\n")) {
    if (!found) {
      found = line.startsWith(heading);
      continue;
    }
    if (/^(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && line.startsWith("#")) break;
    out.push(line);
  }
  return `\n${out.join("\n")}`;
}

/** The README's section under `heading`. */
export const readmeSection = (heading: string) =>
  sectionOf(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "README.md"), "utf8"), heading);
