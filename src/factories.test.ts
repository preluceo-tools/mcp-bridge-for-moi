import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { moiFactoryHelpTool } from "./tools/moi-factory-help.js";
import { assertES5 } from "./es5.js";
import { FACTORY_TABLE, checkCommit, commitScript, probeScript } from "./e2e-factories-table.js";
import { APPDATA_DIR, COMMANDS_DIR, fakeMoi, runScript } from "./fake-moi.js";

const here = dirname(fileURLToPath(import.meta.url));
const FACTORIES = JSON.parse(
  readFileSync(join(here, "..", "assets", "factories.json"), "utf8"),
) as { factories: Record<string, number>; notes: Record<string, string> };

const names = Object.keys(FACTORIES.factories);

test("the bundled factory table is the full enumeration", () => {
  assert.equal(names.length, 110);
  for (const expected of ["box", "fillet", "loft", "polyline", "scale1d", "arrow3d"]) {
    assert.ok(names.includes(expected), `${expected} missing from the table`);
  }
});

test("every factory has a positive-or-zero input count", () => {
  for (const [name, n] of Object.entries(FACTORIES.factories)) {
    assert.equal(typeof n, "number", `${name} has a non-numeric numInputs`);
    assert.ok(n >= 0, `${name} has a negative numInputs`);
  }
});

test("cylinder and cone carry the End pt note (probe-12)", () => {
  for (const name of ["cylinder", "cone"]) {
    assert.match(FACTORIES.notes[name] ?? "", /End pt/, `${name} note missing End pt`);
  }
});

test("the factory sweep's table has one entry per factory, and its scripts are ES5", () => {
  assert.deepEqual(FACTORY_TABLE.map((e) => e.name), names);
  assertES5(probeScript("box"), "probeScript");
  for (const e of FACTORY_TABLE) if (e.expect) assertES5(commitScript(e), `commitScript(${e.name})`);
});

test("every factory is committed with a checked outcome or skipped with a reason", () => {
  const unverified = FACTORY_TABLE.filter((e) => !e.expect && !(e.commit === false && e.reason));
  assert.deepEqual(unverified.map((e) => e.name), []);
});

test("checkCommit compares a reply with the entry's expect", () => {
  const e = { name: "x", expect: { created: { count: 1, typeName: "brep" }, consumed: ["a"], value: "true" } };
  const ok = { error: null, created: ["brep"], consumed: { a: true }, value: true };
  assert.deepEqual(checkCommit(e, ok), []);
  assert.deepEqual(checkCommit(e, { ...ok, error: "boom" }), ["boom"]);
  assert.equal(checkCommit(e, { ...ok, created: ["curve"] }).length, 1);
  assert.equal(checkCommit(e, { ...ok, consumed: { a: false } }).length, 1);
  assert.equal(checkCommit(e, { ...ok, value: 3 }).length, 1);
});

describe("moi_factory_help's end-of-file guard", () => {
  // readLine never signals the end, so the guard is all that stops the read; count the reads.
  const readsOf = (text: string) => {
    const path = `${COMMANDS_DIR}\\Endless.js`;
    const fake = fakeMoi({ tree: { [path]: text } });
    runScript(moiFactoryHelpTool.script({ name: "box", full: false }), fake.moi);
    return fake.reads.get(path);
  };

  test("stops at 8000 lines, however long the file", () => {
    assert.equal(readsOf(Array(9000).fill("x").join("\n")), 8000);
  });

  test("stops after ten blank lines past the end", () => {
    // One real line, then '' forever: the 11th blank in a row ends the read.
    assert.equal(readsOf("x"), 12);
  });
});

describe("moi_factory_help on the fake", () => {
  const USER_DIR = `${APPDATA_DIR}commands`;
  const tree = {
    [`${COMMANDS_DIR}\\Scale.js`]: `#include "DoScale.js"\nfunction go() {\n\tDoScale( 'scale1d', 3 );\n}`,
    // An isolated blank line inside, and a run of trailing blanks to trim.
    [`${COMMANDS_DIR}\\DoScale.js`]: "function DoScale( name, n ) {\n\tvar f = moi.command.createFactory( name );\n\n\tf.setInput( 0, n );\n}\n\n\n",
    [`${COMMANDS_DIR}\\Box.js`]: "var f = moi.command.createFactory( 'box' );",
    // Same file name in the user's folder: reported once, from the first folder.
    [`${USER_DIR}\\Scale.js`]: "DoScale( 'scale1d', 9 );",
  };
  const factories = {
    scale1d: [
      { name: "Objects", type: 8 },
      { name: "Factor", type: 4 },
      { name: "Path", type: 7 },
      { name: "Odd", type: 9 },
    ],
  };
  const help = (name: string, full = false, extra: Parameters<typeof fakeMoi>[0] = {}) =>
    runScript(moiFactoryHelpTool.script({ name, full }), fakeMoi({ tree, factories, ...extra }).moi);

  test("follows an #include one level, reports a file name once, and names the input types", () => {
    assert.deepEqual(help("scale1d"), {
      factory: "scale1d",
      numInputs: 4,
      inputs: [
        { index: 0, name: "Objects", type: "objects" },
        { index: 1, name: "Factor", type: "number" },
        { index: 2, name: "Path", type: "object" },
        { index: 3, name: "Odd", type: "type9" },
      ],
      note: FACTORIES.notes.scale1d,
      filesFound: 1,
      hits: [
        {
          file: "Scale.js",
          lines: ["3: DoScale( 'scale1d', 3 );"],
          via: [{ file: "DoScale.js", lines: ["2: var f = moi.command.createFactory( name );", "4: f.setInput( 0, n );"] }],
        },
      ],
    });
  });

  test("full adds the source, isolated blanks kept and trailing blanks trimmed", () => {
    const hit = help("scale1d", true).hits[0];
    assert.equal(hit.source, tree[`${COMMANDS_DIR}\\Scale.js`]);
    assert.equal(hit.via[0].source, "function DoScale( name, n ) {\n\tvar f = moi.command.createFactory( name );\n\n\tf.setInput( 0, n );\n}");
    assert.equal(help("scale1d").hits[0].source, undefined);
  });

  test("a folder getFiles throws on is skipped", () => {
    const reply = help("scale1d", false, { unlistable: [COMMANDS_DIR] });
    assert.deepEqual(reply.hits, [{ file: "Scale.js", lines: ["1: DoScale( 'scale1d', 9 );"], via: [] }]);
  });

  test("an unknown factory says so, and still reports the files that name it", () => {
    const reply = help("box");
    assert.equal(reply.numInputs, "no such factory");
    assert.equal(reply.inputs, null);
    assert.deepEqual(reply.hits.map((h: { file: string }) => h.file), ["Box.js"]);
  });

  test("a hand-probed factory carries its note in full", () => {
    assert.equal(help("cone").note, FACTORIES.notes.cone);
    assert.match(help("cone").note, /End pt/);
  });
});

/**
 * The real coverage check: every factory must be documented either by one of MoI's own
 * command scripts or by a hand-probed note here. Needs MoI installed, so it skips
 * rather than fails where it is not — CI and contributors without MoI stay green.
 */
describe("coverage against the installed MoI", () => {
  const installDirs = [
    "C:\\Program Files\\MoI 4.0\\commands",
    join(process.env.APPDATA ?? "", "Moi", "commands"),
  ].filter((d) => d && existsSync(d));

  const skip = installDirs.length === 0 ? "MoI is not installed on this machine" : false;

  test("every factory is documented by a stock script or a note", { skip }, () => {
    let corpus = "";
    for (const dir of installDirs) {
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
        corpus += readFileSync(join(dir, file), "utf8");
      }
    }

    const undocumented = names.filter(
      (n) => !corpus.includes(`'${n}'`) && !(n in FACTORIES.notes),
    );
    assert.deepEqual(
      undocumented,
      [],
      `factories with neither a stock example nor a note: ${undocumented.join(", ")}`,
    );
  });
});
