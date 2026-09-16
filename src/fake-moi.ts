/**
 * The fake moi: a stateful stand-in for the `moi` object, for running the scripts a tool sends
 * in `npm test`, with the bridge's real prelude ahead of them. Test-only; never published.
 *
 * It models MoI as the probe docs record it, and only as far as the scripts touch it: lists have
 * `length` and `item( i )` and nothing else, because MoI lists do not enumerate; `findObject`
 * returns null for an unknown GUID and throws for anything that is not one
 * (docs/research/probe-05-object-identity.md); a deselect takes effect on a render with no redraw
 * (docs/research/probe-08-screenshot.md); `fileExport` writes the selection and only the
 * selection (docs/research/probe-13-file-export.md); `readLine` returns '' forever past the end and
`createFactory` throws on an unknown name (docs/research/probe-07-factory-coverage.md). Files,
read or written, live in memory only.
 *
 * `moi.ui.sidePane.window` is the fake window the shipped bridge runs in: `setTimeout` (driven by
 * `node:test` mock timers), and a `WebSocket` and `XMLHttpRequest` the test answers.
 *
 * Nothing here proves the model right. `npm run e2e` against a live MoI is what keeps it honest.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";

/** The shipped bridge, `assets/bridge.js`. */
export const BRIDGE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "bridge.js");

/** The whole `PRELUDE` the bridge puts ahead of every script, run from between its markers. */
export function prelude(): string {
  const source = readFileSync(BRIDGE_PATH, "utf8");
  const begin = source.indexOf("// prelude-begin"), end = source.indexOf("// prelude-end");
  if (begin < 0 || end < begin) throw new Error("assets/bridge.js has lost its prelude-begin / prelude-end markers");
  return new Function(`${source.slice(begin, end)}\nreturn PRELUDE;`)() as string;
}

/**
 * Moves the mocked clock in 5 ms steps: one large `tick()` does not fire timers that the timers
 * it fires schedule inside the same window, and the bridge chains its polls that way.
 */
export function advance(t: TestContext, ms: number) {
  for (let done = 0; done < ms; done += 5) t.mock.timers.tick(Math.min(5, ms - done));
}

/** The ids of a list of object records, in order. */
export const ids = (objects: { id: string }[]) => objects.map((o) => o.id);

/** Runs `script` the way the bridge does: `new Function( 'moi', PRELUDE + '\n' + script )`. */
export const runScript = (script: string, moi: unknown): any =>
  new Function("moi", `${prelude()}\n${script}`)(moi);

/** A real-looking object id, brace-wrapped. `guid(0)` is the all-zero id MoI refuses. */
export const guid = (n: number) => `{00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}}`;

/** The ids most tests need. */
export const A = guid(1), B = guid(2), C = guid(3);

/** A document holding these objects: an id alone, or a full spec. */
export const sceneOf = (...objects: (string | ObjectSpec)[]) =>
  fakeMoi({ objects: objects.map((o) => (typeof o === "string" ? { id: o } : o)) });

/** The fake's command folders: MoI's own, and the user's under its app-data folder. */
export const COMMANDS_DIR = "C:\\MoI\\commands";
export const APPDATA_DIR = "C:\\AppData\\Moi\\";

/** MoI's unit systems and the `unitsShortLabel` each gives; empty when there are none. */
const SHORT_LABELS: Record<string, string> = {
  "No unit system": "",
  Millimeters: "mm",
  Centimeters: "cm",
  Meters: "m",
  Kilometers: "km",
  Inches: "in",
  Feet: "ft",
  Miles: "mi",
};

const GUID = /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i;

export type Pt = { x: number; y: number; z: number };
export type Box = { min: Pt; max: Pt };

type ObjectSpec = { id: string; selected?: boolean; hidden?: boolean; type?: number; solid?: boolean; bbox?: Box | null };
type ViewportSpec = Partial<{
  projection: string;
  cameraPt: Pt;
  targetPt: Pt;
  fieldOfViewAngle: number;
  upDownAngle: number;
  leftRightAngle: number;
  tiltAngle: number;
  pixelWidth: number;
  pixelHeight: number;
}>;

/** Each pane looking at the origin from 10 units out along the axis it names. */
const PANES: Record<string, ViewportSpec> = {
  "3D": { projection: "Perspective", cameraPt: { x: 0, y: -10, z: 0 }, fieldOfViewAngle: 90, upDownAngle: 90 },
  Top: { cameraPt: { x: 0, y: 0, z: 10 } },
  Front: { cameraPt: { x: 0, y: -10, z: 0 }, upDownAngle: 90 },
  Right: { cameraPt: { x: 10, y: 0, z: 0 }, upDownAngle: 90, leftRightAngle: 90 },
};

/**
 * A fresh document. `log` holds every call that changes something, in order: `select <id>`,
 * `deselect <id>`, `deselectAll`, `removeObject <id>`, `redraw`, `setAngles <upDown>,<leftRight>`,
 * `setCameraAndTarget <pane>`, `render <pane> <w>x<h>`, `screenshot <name>`, `fileExport <path>`,
 * `saveAs <path>`, `units <name>`, `execCommand <name>`. `renders` and `exports` record what was selected when each ran.
 */
export function fakeMoi(
  opts: {
    objects?: ObjectSpec[];
    viewports?: Record<string, ViewportSpec>;
    mode?: string;
    minimized?: boolean;
    renderThrows?: boolean;
    saveWritesNothing?: boolean;
    fileExportThrows?: boolean;
    /** `fileExport` leaves every object selected, as a MoI export that changes the selection would. */
    fileExportSelectsAll?: boolean;
    /** The file tree `moi.filesystem` reads: path to text, e.g. `${COMMANDS_DIR}\\Box.js`. */
    tree?: Record<string, string>;
    /** Folders `getFiles` throws on. */
    unlistable?: string[];
    /** What `moi.command.createFactory( name )` knows: name to its inputs. */
    factories?: Record<string, { name: string; type: number }[]>;
    /** MoI's name for the unit system, e.g. `Inches` or `No unit system`. Default `Millimeters`. */
    units?: string;
    currentFileName?: string;
    /** `moi.majorVersionNumber`, default 4; `moi.version` follows it. */
    majorVersion?: number;
    /** Folders `openFileStream( path, 'w' )` returns null in. */
    unwritable?: string[];
    /** Members the side pane window lacks, e.g. `['WebSocket']`. */
    windowLacks?: ("WebSocket" | "XMLHttpRequest" | "setTimeout")[];
    /** Commands wait until the test calls `runHeldCommands()`, instead of running on the next timer turn. */
    holdCommands?: boolean;
    /** How the view panel spells a layout it is given, when read back. Default: as given. */
    modeReadsBack?: (mode: string) => string;
  } = {},
) {
  const log: string[] = [];
  /** MoI's log as lines. Like MoI, `moi.log` adds no line break, so a message without one runs into the next. */
  const logLines: string[] = [];
  let logText = "";
  const heldCommands: (() => void)[] = [];
  const runHeldCommands = () => {
    while (heldCommands.length) heldCommands.shift()!();
  };

  /** A socket the test opens, feeds, closes and inspects; the bridge sets its `on*` handlers. */
  class FakeWebSocket {
    sent: string[] = [];
    closeCalled = false;
    onopen?: () => void;
    onmessage?: (ev: { data: string }) => void;
    onclose?: () => void;
    onerror?: () => void;
    constructor(public url: string) {
      sockets.push(this);
    }
    send(text: string) {
      this.sent.push(text);
    }
    close() {
      this.closeCalled = true;
    }
    /** Test side: the server accepts, sends a message, or goes away. */
    open() {
      this.onopen?.();
    }
    receive(msg: unknown) {
      this.onmessage?.({ data: JSON.stringify(msg) });
    }
    serverClose() {
      this.onclose?.();
    }
    /** Every frame sent so far, parsed. */
    frames(): any[] {
      return this.sent.map((s) => JSON.parse(s));
    }
  }
  /** A request the test answers with `respond( status, body )`. */
  class FakeXMLHttpRequest {
    method = "";
    url = "";
    readyState = 0;
    status = 0;
    responseText = "";
    onreadystatechange?: () => void;
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    send() {
      requests.push(this);
    }
    respond(status: number, body: string) {
      this.readyState = 4;
      this.status = status;
      this.responseText = body;
      this.onreadystatechange?.();
    }
  }
  const sockets: FakeWebSocket[] = [];
  const requests: FakeXMLHttpRequest[] = [];
  /** The side pane window. `setTimeout` is looked up at call time, so `node:test` mock timers drive it. */
  const window: Record<string, any> = {
    Function,
    WebSocket: FakeWebSocket,
    XMLHttpRequest: FakeXMLHttpRequest,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  };
  for (const name of opts.windowLacks ?? []) delete window[name];
  const files = new Map<string, string>(Object.entries(opts.tree ?? {}));
  /** How many times `readLine` was called on each path. */
  const reads = new Map<string, number>();
  let mode = opts.mode ?? "split";
  const renders: { viewport: string; width: number; height: number; selected: string[] }[] = [];
  const exports: { via: string; path: string; options: string; selected: string[] }[] = [];

  const list = <T>(items: T[]) => ({ length: items.length, item: (i: number) => items[i] });
  const image = (what: string) => ({
    save: (path: string) => {
      if (!opts.saveWritesNothing) files.set(path, what);
    },
  });

  const makeObject = (spec: ObjectSpec) => {
    let selected = spec.selected ?? false;
    const bbox = spec.bbox === undefined ? { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } : spec.bbox;
    return {
      id: spec.id,
      hidden: spec.hidden ?? false,
      type: spec.type ?? 3,
      /** A property, not a method, as in live MoI (probe-11). */
      isSolidBRep: spec.solid ?? false,
      get selected() {
        return selected;
      },
      set selected(v: boolean) {
        log.push(`${v ? "select" : "deselect"} ${spec.id}`);
        selected = v;
      },
      getBoundingBox: () => bbox,
    };
  };
  const objects = (opts.objects ?? []).map(makeObject);
  let units = opts.units ?? "Millimeters";
  type FakeObject = (typeof objects)[number];
  const selectedIds = () => objects.filter((o) => o.selected).map((o) => o.id);

  const viewport = (name: string) => {
    const vp = {
      projection: "Parallel",
      cameraPt: { x: 0, y: 0, z: 10 },
      targetPt: { x: 0, y: 0, z: 0 },
      fieldOfViewAngle: 20,
      upDownAngle: 0,
      leftRightAngle: 0,
      tiltAngle: 0,
      pixelWidth: 800,
      pixelHeight: 600,
      ...PANES[name],
      ...opts.viewports?.[name],
      /** Swings the camera round the target at the same distance; 0 up/down looks straight down. */
      setAngles(upDown: number, leftRight: number) {
        log.push(`setAngles ${upDown},${leftRight}`);
        const t = vp.targetPt, c = vp.cameraPt;
        const d = Math.hypot(c.x - t.x, c.y - t.y, c.z - t.z);
        const u = (upDown * Math.PI) / 180, l = (leftRight * Math.PI) / 180;
        vp.cameraPt = {
          x: t.x + d * Math.sin(u) * Math.sin(l),
          y: t.y - d * Math.sin(u) * Math.cos(l),
          z: t.z + d * Math.cos(u),
        };
        vp.upDownAngle = upDown;
        vp.leftRightAngle = leftRight;
      },
      setCameraAndTarget(camera: Pt, target: Pt) {
        log.push(`setCameraAndTarget ${name}`);
        vp.cameraPt = camera;
        vp.targetPt = target;
      },
      render(width: number, height: number) {
        log.push(`render ${name} ${width}x${height}`);
        renders.push({ viewport: name, width, height, selected: selectedIds() });
        if (opts.renderThrows) throw new Error("render failed");
        return image(`render ${name}`);
      },
    };
    return vp;
  };
  const viewports = Object.fromEntries(["3D", "Top", "Front", "Right"].map((n) => [n, viewport(n)]));

  const moi = {
    /** Test-only: adds an object from inside a script, the way a factory's commit would. */
    __add: (spec: ObjectSpec) => {
      objects.push(makeObject(spec));
    },
    majorVersionNumber: opts.majorVersion ?? 4,
    version: `${opts.majorVersion ?? 4}.0`,
    log: (message: string) => {
      logText += message;
      logLines.splice(0, logLines.length, ...logText.split("\n").filter((line) => line !== ""));
    },
    command: {
      /** The user's running command, or '' for none. The test sets it. */
      currentCommandName: "",
      /**
       * Runs `<app data>\commands\<name>.js` — the file as written — against this fake moi, once
       * the call stack is clean (the next timer turn), or when the test releases it.
       */
      execCommand(name: string) {
        log.push(`execCommand ${name}`);
        const src = files.get(`${APPDATA_DIR}commands\\${name}.js`);
        if (src === undefined) throw new Error(`execCommand: no command ${name}`);
        const run = () => new Function("moi", src)(moi);
        if (opts.holdCommands) heldCommands.push(run);
        else window.setTimeout(run, 0);
      },
      createFactory(name: string) {
        const inputs = opts.factories?.[name];
        if (!inputs) throw new Error("Invalid function argument 1");
        return { numInputs: inputs.length, getInput: (i: number) => inputs[i] };
      },
    },
    geometryDatabase: {
      /** A name, as live MoI holds it. An unknown name is not taken, and nothing says so. */
      get units() {
        return units;
      },
      set units(v: string) {
        log.push(`units ${v}`);
        if (Object.hasOwn(SHORT_LABELS, v)) units = v;
      },
      get unitsShortLabel() {
        return SHORT_LABELS[units];
      },
      currentFileName: opts.currentFileName ?? "",
      findObject(id: string) {
        // MoI takes the id with or without its braces, in either case (live, 2026-09-15).
        const braced = `{${id.replace(/^\{|\}$/g, "")}}`;
        if (!GUID.test(braced) || braced === guid(0)) throw new Error(`findObject: ${id} is not a GUID`);
        return objects.find((o) => o.id.toLowerCase() === braced.toLowerCase()) ?? null;
      },
      getObjects: () => list(objects),
      getSelectedObjects: () => list(objects.filter((o) => o.selected)),
      deselectAll() {
        log.push("deselectAll");
        for (const o of objects) if (o.selected) o.selected = false;
      },
      removeObject(o: FakeObject) {
        log.push(`removeObject ${o.id}`);
        const i = objects.indexOf(o);
        if (i >= 0) objects.splice(i, 1);
      },
      fileExport(path: string, options: string) {
        log.push(`fileExport ${path}`);
        exports.push({ via: "fileExport", path, options, selected: selectedIds() });
        if (opts.fileExportThrows) throw new Error("export failed");
        if (opts.fileExportSelectsAll) for (const o of objects) o.selected = true;
        files.set(path, "fileExport");
      },
      saveAs(path: string, options: string) {
        log.push(`saveAs ${path}`);
        exports.push({ via: "saveAs", path, options, selected: selectedIds() });
        files.set(path, "saveAs");
      },
    },
    vectorMath: { createPoint: (x: number, y: number, z: number): Pt => ({ x, y, z }) },
    ui: {
      redrawViewports: () => {
        log.push("redraw");
      },
      sidePane: { window },
      mainWindow: {
        isMinimized: opts.minimized ?? false,
        viewpanel: {
          get mode() {
            return mode;
          },
          set mode(v: string) {
            mode = opts.modeReadsBack ? opts.modeReadsBack(v) : v;
          },
          getViewport: (name: string) => viewports[name] ?? null,
        },
      },
    },
    view: {
      screenshot: (name: string) => {
        log.push(`screenshot ${name}`);
        return image(`screenshot ${name}`);
      },
    },
    filesystem: {
      getTempDir: () => "C:\\Temp",
      getPathDelimiter: () => "\\",
      fileExists: (path: string) => files.has(path),
      getCommandsDir: () => COMMANDS_DIR,
      getAppDataDir: () => APPDATA_DIR,
      getFileNameFromPath: (path: string) => path.slice(path.lastIndexOf("\\") + 1),
      getFiles(dir: string, pattern: string) {
        if (opts.unlistable?.includes(dir)) throw new Error(`getFiles: cannot read ${dir}`);
        const ext = pattern.replace("*", "");
        const prefix = dir.endsWith("\\") ? dir : `${dir}\\`;
        return list(
          [...files.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("\\") && p.endsWith(ext)),
        );
      },
      /**
       * Past the end, readLine returns '' forever, and the stream has no size member (probe-07).
       * Mode 'w' gives a stream whose lines land in the file on `close()`.
       */
      openFileStream(path: string, mode: string) {
        if (mode === "w") {
          if (opts.unwritable?.some((dir) => path.startsWith(dir))) return null;
          const lines: string[] = [];
          return {
            writeLine: (line: string) => {
              lines.push(line);
            },
            close: () => {
              files.set(path, lines.join("\n"));
            },
          };
        }
        const text = files.get(path);
        if (text === undefined) return null;
        const lines = text.split("\n");
        let at = 0;
        return {
          readLine: () => {
            reads.set(path, (reads.get(path) ?? 0) + 1);
            return at < lines.length ? lines[at++] : "";
          },
          close: () => {},
        };
      },
    },
  };

  return {
    moi, log, files, renders, exports, objects, viewports, selectedIds,
    window, sockets, requests, logLines, runHeldCommands, reads,
  };
}
