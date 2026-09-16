// End-to-end check: does the bridge actually work inside a real MoI?
// Uses SessionHost directly, so this tests the bridge and the MoI-side script without
// the MCP layer in the way.
import { SessionHost } from "../../dist/session.js";
import { GET_SCENE, GET_SELECTION, setSelection, deleteObjects } from "../../dist/scripts.js";

const host = new SessionHost();
const port = await host.start();
console.log(`[e2e] server up on ${port}, waiting for the bridge to dial in...`);

const deadline = Date.now() + 90_000;
while (!host.connected && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 500));
}
if (!host.connected) {
  console.log("[e2e] FAIL: no bridge connected within 90s");
  await host.stop();
  process.exit(1);
}
console.log("[e2e] bridge attached\n");

let boxIds = [];

async function step(name, script) {
  process.stdout.write(`[e2e] ${name}: `);
  try {
    const value = await host.call({ op: "eval", script });
    console.log("OK " + JSON.stringify(value));
    return value;
  } catch (err) {
    console.log(`FAIL [${err.code ?? "?"}] ${err.message}`);
    return null;
  }
}

await step("version", "return { version: moi.version, major: moi.majorVersionNumber };");
await step("prelude helpers present", "return { pt: typeof pt, bbox: typeof bbox, toJson: typeof toJson };");
await step("get_scene (empty doc)", GET_SCENE);
await step("get_selection", GET_SELECTION);

const created = await step(
  "create a box via factory",
  `
var vm = moi.vectorMath;
var f = moi.command.createFactory( 'box' );
f.setInput( 0, vm.createTopFrame( vm.createPoint( 0, 0, 0 ) ) );
f.setInput( 2, 10 );
f.setInput( 3, 20 );
f.setInput( 4, 5 );
f.update();
var made = f.getCreatedObjects();
var ids = [];
for ( var i = 0; i < made.length; ++i ) ids.push( made.item( i ).id );
f.commit();
return { ids: ids, count: ids.length };
`,
);
if (created && created.ids) boxIds = created.ids;

await step("get_scene (after box)", GET_SCENE);

if (boxIds.length) {
  await step("set_selection", setSelection(boxIds));
  await step("get_selection (after select)", GET_SELECTION);
  await step("delete_objects", deleteObjects(boxIds));
  await step("findObject on a dead id returns null", `return moi.geometryDatabase.findObject( ${JSON.stringify(boxIds[0])} ) === null;`);
}

await step("error path: a throwing script", "throw new Error('deliberate');");
await step("scene is empty again", GET_SCENE);

console.log("\n[e2e] closing MoI");
try {
  await host.call({ op: "eval", script: "moi.exit( true ); return true;" });
} catch (err) {
  console.log(`[e2e] exit call returned: ${err.message}`);
}

await host.stop();
console.log("[e2e] done");
process.exit(0);
