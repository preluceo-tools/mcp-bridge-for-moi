# Driving Moment of Inspiration (MoI3D) v4 from an external process

Research date: 2026-09-08. Target: MoI 4.0, Windows, installed at `<MoI install folder>`
(this machine: build stamped `Dec-22-2020`, per a version string in `moi_lib.dll`).

Sources are (a) the local install's own binaries and files, (b) moi3d.com wiki, (c) Michael
Gibson's posts on the moi3d.com forum. Every claim is cited. Anything I could not verify is
marked **UNVERIFIED** rather than smoothed over.

---

## Answer to the bridge question

**There is no official external API — no COM, no DDE, no documented socket, no headless SDK.**
Michael Gibson, MoI's author: *"Sorry no there is not currently a documented API for MoI."* and
*"There is an undocumented internal API used by scripts (using the JavaScript language)"*
([forum 10720.1](https://moi3d.com/forum/lmessages.php?webtag=MOI&msg=10720.1)).

But three real bridges exist, and two of them are strong:

### Bridge 1 — launch a fresh MoI process with a `.js` script (documented, works, one-shot)

`MoI.exe "<path to script.js>" [/showwindow]`. MoI runs the script at startup **without ever
showing the main window** unless `/showwindow` is passed. This is the documented batch path.

> *"you need to run MoI.exe as the primary program that is launched, and then that should take
> the batchconvert.js as a command-line parameter to MoI.exe"* — Gibson,
> [forum 2100.8](http://moi3d.com/forum/lmessages.php?webtag=MOI&msg=2100.8)

> *"the external program can write out a .js script file that calls into MoI's API and then it
> can launch moi.exe giving it the path to the script file as a command line parameter. When
> launched in that way MoI can be used to process files without showing any of the regular
> program UI."* — Gibson,
> [forum 10884.1](https://moi3d.com/forum/lmessages.php?webtag=MOI&msg=10884.1)

`/showwindow` confirmed present in the v4 binary: `moi_lib.dll` contains the UTF-16 literals
`-showwindow` and `/showwindow` (adjacent, at wide-string dump offsets 5715–5716; extracted with
`strings -e l`). Also present next to them: `-macnewwindow`, and the extension tokens `.key` and
`.ini`, consistent with the documented "pass a moi.ini path as a parameter" behaviour
([Hidden Secrets wiki](http://moi3d.com/wiki/Hidden_Secrets)).

Cost: a full process start per call. State does **not** persist between calls.

### Bridge 2 — from inside MoI, shell out and capture stdout (undocumented but confirmed by Gibson)

`moi.filesystem.shellExecute( exe, params, waitForFinished )`. With the third argument `true`,
MoI uses Qt `QProcess`, waits, and **captures the child's output**, returned on the result
object's `.output`:

> *"If the optional 'WaitForFinished' function argument is false then it will run straight Win32
> ShellExecute(). If 'WaitForFinished' is true then it will use Qt QProcess to create the
> process, wait for it to finish, and capture it's output."* — Gibson,
> [forum 10134.38](https://moi3d.com/forum/lmessages.php?webtag=MOI&msg=10134.38)

Working user example from that same thread:
`var res = moi.filesystem.shellExecute('cmd /c ...', '', true ); if ( res.output ) moi.ui.alert( res.output );`

This is a **synchronous, bidirectional** channel out of a *running* MoI: in-process JS calls an
external helper and reads back its stdout. Combined with Bridge 3 it gives a full request/response
loop against a live MoI session.

### Bridge 3 — a startup script inside a running MoI that polls / listens

MoI 4 auto-creates `%APPDATA%\Moi\startup\` and runs `.js` files placed there at launch
([forum 10397.1](https://moi3d.com/forum/lmessages.php?webtag=MOI&msg=10397.1); both
`%APPDATA%\Moi\startup` and `%APPDATA%\Moi\commands` exist on this machine, empty). From there,
in-process JS has:

- **File I/O**: `moi.filesystem.openFileStream( name, 'r'|'w' )` → a FileStream with
  `.readLine()`, `.writeLine(text)`, `.atEOF`, `.close()`, `.setWriteBOM()`, `.setCodec(name)`
  — Gibson, [forum 9665.2](http://moi3d.com/forum/lmessages.php?webtag=MOI&msg=9665.2).
  **Text only** — Gibson states it *"is currently only focused on reading text files line by line"*
  with no binary reading. So a file-drop/file-watch bridge is buildable, but the transport must be
  line-oriented text (JSON-per-line is the obvious choice).
- **Process launch + stdout capture** — Bridge 2 above.
- **Command dispatch**: `moi.command.execCommand( 'Name params' )` — see §2.
- Probably **XMLHttpRequest / WebSocket** — see §5, which is where the real leverage is *if* it
  holds up under test.

**Recommended architecture for an MCP server**, given the above:
a persistent MoI instance with a startup script acting as the in-process agent, talking to the MCP
server over whichever of §5's network primitives survives testing; falling back to
`shellExecute(..., true)` polling or a line-oriented file mailbox if not. Use Bridge 1 (fresh
process per job) only for stateless batch conversion, where it is clean and documented.

### What does NOT exist as a bridge

- **`moi_commandprocessor.exe` is not an entry point.** It is a *child worker* MoI spawns for
  out-of-process geometry computation. Symbol evidence from `strings moi_commandprocessor.exe`:
  `MoiInitCommandProcessor`, `BuildCommandProcessorServerName`, `WorkerThread`, `FactoryThread`,
  `BeginCalculateAsyncFactory`, `ReceiveRequestedObjects`, `InterProcessMemoryReceiver`,
  `CheckParentProcessClosedTimer`, and imports of **`QLocalSocket`** (client side) from
  `Qt5Network.dll` — plus `OpenProcess`/`GetExitCodeProcess` to watch its parent. `moi_lib.dll`
  holds the matching **`QLocalServer`** (`listen`, `nextPendingConnection`, `newConnection`) and
  the same `BuildCommandProcessorServerName` symbol, and contains the wide literal
  `moi_command_processor_socket_name$$` — a name template, i.e. the pipe name is generated per
  launch, not fixed. So: MoI is the server, `moi_commandprocessor.exe` is a disposable client that
  computes one geometry *factory* and dies. The wire protocol is raw shared-memory blobs
  (`InterProcessMemoryReceiver`), undocumented and version-locked. **Do not build on it.**
  It takes no useful user-facing arguments; the two args it consumes appear to be the generated
  socket name and the parent PID (`QString::toLongLong` + `OpenProcess`).
- **No COM registration, no DDE.** The published `moi.idl` is MSIDL (`IDispatch`-derived
  interfaces) — a fossil of MoI v1/v2 hosting the IE ActiveX control. Nothing in the v4 install
  registers a COM server. **UNVERIFIED but strongly indicated**: I did not enumerate the registry.
- **`moi://` is internal only.** `moi://ui/...` and `moi://commands/...` are MoI's own resource
  scheme for its WebKit views (`moi_lib.dll` wide strings: `moi://ui/CommandBar.htm`,
  `moi://commands/dimradius.htm`, `moi://commands/`). No evidence it is registered as a Windows
  URL protocol handler. **UNVERIFIED** — registry not checked.
- **The one named pipe/mailslot with a *fixed* name is the license counter**, not a control
  channel: `moi_lib.dll` contains `\\.\mailslot\moi\$$_moi_license_$$`. Do not poke it.
- **`script:` is not a URL scheme for outsiders.** It is an in-`moi.ini` prefix (see §3).

---

## 1. `MoI.exe` command line, in detail

| Argument form | Effect | Source |
|---|---|---|
| `<file>.js` | Run as a startup script; main window stays hidden | [2100.8](http://moi3d.com/forum/lmessages.php?webtag=MOI&msg=2100.8), [Hidden Secrets](http://moi3d.com/wiki/Hidden_Secrets) |
| `/showwindow` (or `-showwindow`) | Show the UI while the script runs | [2100.25](https://moi3d.com/forum/lmessages.php?webtag=MOI&msg=2100.25); literals in `moi_lib.dll` |
| `<path>\moi.ini` | Use that ini instead of the default | [Hidden Secrets](http://moi3d.com/wiki/Hidden_Secrets) |
| `<file>.key` | **UNVERIFIED** — `.key` literal sits beside `.ini` in the arg-parsing string block; license-key install is the obvious guess | `moi_lib.dll` wide strings |
| `-macnewwindow` | macOS only, **UNVERIFIED** | `moi_lib.dll` wide strings |
| `<file>.3dm` / other model | Opens it. `moi.geometryDatabase.initialFileToLoad` exists; MoI also supports drag/drop (`ui/PromptDragDrop.htm`). **UNVERIFIED** by direct test | `moi_lib.dll` wide strings; `<MoI install folder>\ui\PromptDragDrop.htm` |

Quoting: *"enclosed in quotes if there are any spaces in the file name or path"*; and *"make sure
when you add the /showwindow parameter that it has a space character separating it from any other
parameters"* ([2100.25](https://moi3d.com/forum/lmessages.php?webtag=MOI&msg=2100.25)).

Inside the script, `moi.exit( true )` ends the process; *"Pass true to suppress save changes
prompt"* ([2100.8](http://moi3d.com/forum/lmessages.php?webtag=MOI&msg=2100.8)).

A script can also read its own process args via `moi.getExecutableCommandLineArgs` (present in the
v4 binary; **not** in the published MoI 3-era `moi.idl` — so this looks like a v4 addition, and it
means Bridge 1 can take parameters without rewriting the script file each time). Signature
**UNVERIFIED**.

**Open question worth testing before committing to an architecture:** if MoI is already running and
you launch `MoI.exe script.js`, does it start a second process or hand off to the running instance?
The only fixed-name IPC object found is the license mailslot, which suggests **separate processes**,
but I did not test this and the answer decides whether Bridge 1 can ever touch a live session.

---

## 2. In-process JavaScript API surface

Two grounded sources: the published `moi.idl`
([download link on the Scripting wiki](https://moi3d.com/wiki/Scripting) →
`http://moi3d.com/forum/get_attachment.php?webtag=MOI&hash=2bf297a1a2b667929e93a23d8805271c&filename=moi.idl`
— 4522 lines, 46 interfaces, MoI 3-era), and the UTF-16 name table inside this install's
`moi_lib.dll` (which is the v4 truth). Where they disagree, the DLL wins.

Engine: *"JavaScriptCore that comes with QtWebKit with Qt 5.4.1"*, **ECMAScript 5 only** — Gibson,
[9665.2](http://moi3d.com/forum/lmessages.php?webtag=MOI&msg=9665.2). No `let`/`const`/arrow
functions/Promise. Write ES5.

### Root object `moi` (from `IMoi` in moi.idl + v4 strings)

`ui`, `selection`, `grid`, `view`, `drawingAids`, `vectorMath`, `command`, `filesystem`,
`settings`, `geometryDatabase`, `sceneBrowser`, `shortcutKeys`, `test`, `getLog`, `log`,
`copyTextToClipboard`, `createList`, `version`, `majorVersionNumber`, `expireDate`,
`launchHelp()`, `exit(suppressPrompt)`, `getExecutableCommandLineArgs`, `formatNumber`,
`formatString`, `formatCoordinate`, `formatFeetInches`, `htmlEntities`, `redrawViewports`,
`getText` / `getTemplatedText` (localisation), `getLicenseKeys`, `showEULA`.

### `moi.geometryDatabase`

File ops: `open`, `openTemplate`, `save`, `saveAs`, `incrementalSave`, `fileNew`, `fileImport`,
`fileImportSubD`, `fileExport`, `startupTemplate`, `initialFileToLoad`, `currentFileName`,
`currentFileNameDir`, `currentFileChanged`, `deleteAll`.

Objects: `addObject`, `addObjects`, `removeObject`, `removeObjects`, `findObject`, `getObjects`,
`getSelectedObjects`, `createObjectList`, `getLastCreated`, `selectLastCreated`, `selectNamed`,
`selectAll`, `deselectAll`, `invertSelection`, `selectVisible`, `selectLoop`, `hide`, `isolate`,
`showSubset`, `lock`, `isolateLock`, `unlockSubset`, `copyToClipboard`, `copyToClipboardAI`,
`copyToClipboardPDF`, `pasteFromClipboard`, `sortCurves`, `calculateCurveOrientations`.

Units/styles/annotations: `units`, `defaultUnits`, `defaultDistanceDisplay`, `unitsShortLabel`,
`getUnitConversionScaleFactor`, `isFeetAndInchesDisplay`, `scaleOnUnitChange`,
`scaleOnImportDifferentUnits`, `getObjectStyles`, `addStyle`, `findStyle`, `activeStyle`,
`addDefaultStyles`, `generatedObjectsInheritStyle`, `getAnnotationPresets`, `addAnnotationPreset`,
`deleteAnnotationPreset`, `importAnnotationPresets`, `findAnnotationPreset`, `notes`, `tolerance`,
`revision`, `print3D`, `isPrint3DInstalled`, `setStatic`, `updateStaticFaceColors`.

`ObjectList` (from `IMoiObjectList` + v4 strings): `getBReps`, `getSolids`, `getOpenBReps`,
`getSingleFaceBReps`, `getCurves`, `getStandaloneCurves`, `getPoints`, `getConstructionLines`,
`getAnnotations`, `getLinearDimensions`, `getRadialDimensions`, `getAngularDimensions`,
`getLeaders`, `getAnnotationTexts`, `getTopLevelObjects`, plus `num*` counterparts
(`numBReps`, `numSolids`, `numCurves`, `numEdges`, `numFacesFromMultiFaceBReps`, …),
`sortBySelectionOrder`, `setProperty`, `invertProperty`, `lockSelection`, `unlockSelection`,
`removeObjectAt`, `getHighAccuracyBoundingBox`, `item`.

Object (`IMoiGeomObject`): `type`, `name`, `selected`, `hidden`, `locked`, `styleIndex`,
`displayMode`, `clone`, `getBoundingBox`, `getSubObjects`, `copyPropertiesFrom`/`To`,
history: `updateWithHistory`, `getHistoryChildren`, `getHistoryParents`, `getHistoryData`,
`deleteHistoryData`; predicates `isCurve`, `isBRep`, `isSolidBRep`, `isOpenBRep`,
`isSingleFaceBRep`, `isFace`, `isEdgeCurve`, `isSeamEdgeCurve`, `isPointObject`, `isMeshObject`,
`isAnnotation`, `isLinearDimension`, `isTopLevelObject`, `getTopLevelParent`, `getParentBRep`, …

BRep/Face/Curve: `getFaces`, `getEdges`, `getJoinedEdges`, `getNakedEdges`, `getSeamEdges`,
`getLoops`, `evaluatePoint`, `evaluateNormal`, `evaluate1stDerivatives`, `evaluate2ndDerivatives`,
`dropPoint`, `domainMin`/`domainMax`, `isPlanar`, `planarFrame`, `getStartPt`, `getEndPt`,
`getLength`, `evaluateTangent`, `evaluateCurvature`, `isLine`, `isArc`, `isCircle`, `isEllipse`,
`isClosed`, `isPeriodic`, `getFacesOfEdge`, `getUVCurvesOfEdge`.

### `moi.command`

`createFactory(name)`, `execCommand(nameAndParams)`, `execCommandSet`, `getCommandLineParams()`,
`undo`, `redo`, `repeatLastCommand`, `currentCommandName`, `nonRepeatingCommands`,
`setCommandSpecificUndo`, `registerCommandSpecificShortcutKey`,
`addSelectedObjectsStateUndoUnit`, `lastCommandRevisionStart`/`End`.

`execCommand` is **asynchronous-ish**: *"it sets some flags and then the command is only actually
launched when on a clean call stack, to avoid one command from running while still inside another
one"*, and *"If the command name … is just the plain command name without a full path, MoI will
only find it if it's under the commands or scripts folders"*
([forum 6336.1](http://moi3d.com/forum/lmessages.php?webtag=MOI&msg=6336.1)). Parameters are
space-separated from the name and typically `;`-separated among themselves. This matters a lot for
an MCP server: **you cannot simply `execCommand` in a loop and expect sequencing.**

### Factories — the real modelling API

`moi.command.createFactory('extrude')` etc. Factory members (`IMoiGeometryFactory` + v4 strings):
`name`, `numInputs`, `getInput(i)`, `setInput(i, v)`, `addToListInput`, `clearInput(i)`,
`createInput`, `createInputType`, `removeInput`, `removeLastInput`, `update()`, `calculate()`,
`commit()`, `reset()`, `disableUpdate(bool)`, `disableUIGeometry`, `waitForAsyncUpdate()`,
`getInputObjects`, `getCreatedObjects`, `getRemovedObjects`, `getUIObjects`.

Factory names are in the DLL's string table (partial, read off the wide-string dump in factory
order): `line`, `polyline`, `curve`, `interpcurve`, `sketchcurve`, `circle`, `circle3pt`,
`circlediameter`, `circletangent`, `arc3pt`, `arccenter`, `arctangent`, `arccontinue`, `conic`,
`ellipse`, `ellipsecorner`, `ellipsediameter`, `rectangle`, `rectcenter`, `rect3pts`, `polygon`,
`polygonstar`, `polygonedge`, `point`, `plane`, `planecenter`, `plane3pts`, `planarsrf`, `box`,
`boxcenter`, `box3pts`, `boundingbox`, `boundingboxcenter`, `sphere`, `cylinder`, `cone`,
`extrude`, `revolve`, `railrevolve`, `loft`, `sweep`, `network`, `nsided`, `blend`, `fillet`,
`chamfer`, `offset`, `shell`, `inset`, `join`, `merge`, `separate`, `trim`, `extend`,
`shrinktrimmedsrf`, `booleanunion`, `booleandifference`, `booleanintersection`, `booleanmerge`,
`intersect`, `project`, `silhouette`, `isocurve`, `rebuildcurve`, `removeduplicates`, `move`,
`copy`, `drag`, `mirror`, `align`, `rotateaxis`, `scale1d`, `scale2d`, `scalenonuniform`, `twist`,
`flow`, `orientlinetoline`, `explodemove`, `arraydir`, `arraygrid`, `arraycircular`, `arraycurve`,
`arraygem`, `helix`, `make2d`, `calcarea`, `calcvolume`, `calclength`, `delete`,
`dimhorizontal`, `dimvertical`, `dimaligned`, `dimradius`, `dimangle`, `leader`, `annotationtext`,
`backgroundimage`, `alignbackgroundimage`, `addpoint`, `addpointsrf`.
Input *indices* are positional and undocumented — learn each one from the matching
`<MoI install folder>\commands\<Name>.js`.

The stock command scripts (e.g. `<MoI install folder>\commands\Extrude.js`) all follow the
same shape: create the factory by name with `moi.command.createFactory`, put the selected
objects into input 0 with `setInput`, wrap UI binding in `disableUpdate( true )` /
`disableUpdate( false )` while `moi.ui.bindUIToInput` ties dialog controls to further inputs
(for extrude, the cap-ends checkbox is input 5), let the user pick points, then `commit()`.

For an MCP server the interactive picker parts (`moi.ui.createPointPicker`,
`pointpicker.waitForEvent()`) are exactly what you *skip*: set inputs numerically and call
`update()` then `commit()`.

### `moi.ui`

Dialogs and panels: `createDialog`, `alert`, `doModal`, `endDialog`, `dialogReturnValue`,
`mainWindow`, `sidePane`, `commandBar`, `getUIPanel(s)`, `findElement`, `showUI`, `hideUI`,
`beginUIUpdate`/`endUIUpdate`, `loadCommandUI`, `clearCommandUI`, `commandUI`, `bindUIToInput`,
`fireUIEvent`, `showMenu`, `reloadPanels`, `propertiesPanel`, `sceneBrowser`, `updateBrowser`,
`getActiveViewport`, `getLastClickedViewport`, `getViewportUnderMouse`, `getRecentFiles`,
`systemDPI`, `getScreenRect`. Pickers: `createObjectPicker`, `createPointPicker`,
`createPointStreamPicker`, `createOrientationPicker`, `createOrientationEditor`,
`createBackgroundImageEditor`, `getActivePointPicker`, `clearPickedPoints`, `addPickedPoint`,
`getLastPickedPoint`, `removeLastPickedPoint`.

### `moi.vectorMath`

`createPoint`, `makeVector`, `average`, `pointsAreEqual`, `pointsWithinTolerance`,
`createBoundingBox`, `createFrame`, `createTopFrame`, `createFrontFrame`, `createRightFrame`.

### `moi.filesystem`

`openFileStream(name, 'r'|'w')`, `shellExecute(cmd, params [, waitForFinished])`, `fileExists`,
`dirExists`, `getFiles`, `getDirs`, `copyFile`, `deleteFile`, `getOpenFileName`, `getSaveFileName`,
`getProcessDir`, `getTempDir`, `getAppDataDir`, `getUIDir`, `getCommandsDir`, `getPathDelimiter`,
`toNativePath`, `toScriptPath`, `getCompactPath`, `getFileNameFromPath`, `incrementFileName`,
`processFileNameToUI`/`FromUI`.

### `moi.settings`, `moi.view`, `moi.grid`, `moi.drawingAids`, `moi.selection`, `moi.shortcutKeys`

`moi.settings.getOption`/`setOption`, `editIniFile`, `getIniPath`, `restoreDefaults`, plus a very
large flat namespace of named options (export defaults such as `objExportScaleFactor`,
`stlExportFileType`, `fbxExportVersion`, `igesWriteSolidsAs`, `meshExportCombineSameNamedObjects`;
display, snap and navigation settings). `moi.view.screenshot`, `getCPlane`/`setCPlane`,
`resetCPlane`, `axisLabels`. `moi.shortcutKeys.addShortcut`/`removeShortcut`/`getShortcuts`.
`moi.selection.setFilter`, `clearSelectionFilters`, `isFilterActive`, `passesSelectionFilter`.

### MoI 4 vs MoI 3

I diffed the v4 `moi_lib.dll` name table against the published (MoI 3-era) `moi.idl`. Names present
in v4 but absent from that idl — i.e. **likely v4 additions**:
`moi.sceneBrowser`, `moi.shortcutKeys`, `moi.getExecutableCommandLineArgs`, the entire annotation /
dimension layer (`getAnnotations`, `getLinearDimensions`, `getRadialDimensions`,
`getAngularDimensions`, `getLeaders`, `getAnnotationTexts`, `isAnnotation`, `getAnnotationPresets`,
`addAnnotationPreset`, `importAnnotationPresets`, `findAnnotationPreset`, and the `dim*`/`leader`/
`annotationtext` factories), `geometryDatabase.fileImportSubD` and the `subDImport*` settings,
`geometryDatabase.notes`, `filesystem.getDirs`, `filesystem.toNativePath`/`toScriptPath`.
**Caveat:** the published idl is undated; it contains v3-era members (`print3D`,
`getHistoryParents`), so I read it as ≈MoI 3. This delta is therefore *indicative*, not a
guaranteed v3→v4 changelog.

---

## 3. Custom commands

Layout, confirmed against `<MoI install folder>\commands\` (286 files, `.htm`/`.js`/`.xml`):

- `Name.js` — the script. Runs when the command is invoked. Optional first-line directive
  `// config: norepeat` or `// config: norepeat noautolaunch` (only two forms occur across all 286
  files; `moi_lib.dll` also knows the token `noautolaunch`).
- `Name.htm` — optional command UI: prompts, `<moi:CheckButton>`, `<moi:NumericInput>`,
  `<moi:PushButton>`, `<moi:CommandDoneCancel />`, and an inline `<script>` block whose globals
  become `moi.ui.commandUI.*`. A command with no UI needs no `.htm` (e.g. `Save.js` is two lines).
- `Name.xml` — flyout/palette grouping (e.g. `Arcs.xml`, `Booleans.xml`).
- `#include "GetObjects.js"` at the top of a `.js` pulls in shared helpers (MoI's own preprocessor;
  the literal `#include "` is in `moi_lib.dll`).

Where to put them:

- `<MoI install folder>\commands\` (v3 style), **or**
- `%APPDATA%\Moi\commands\` — **preferred in v4**, auto-created. Gibson recommends it because
  *"new MoI versions will find them there and you won't need to copy them around again"*
  ([10397.1](https://moi3d.com/forum/lmessages.php?webtag=MOI&msg=10397.1)). Both folders exist on
  this machine.
- Extra directories via `moi.ini` `[Commands] AdditionalCommandsDirs=`
  (`%APPDATA%\Moi\moi.ini:82-83` on this machine).

No registration step — dropping the file in is enough. Invocation:

1. **Command line in the UI**: *"Press the Tab key, type the command name and then push Enter"*
   ([8963.1](http://moi3d.com/forum/lmessages.php?webtag=MOI&msg=8963.1)). Trailing text after the
   name reaches the script as `moi.command.getCommandLineParams()` — that is literally how the
   stock commands work, e.g. `<MoI install folder>\commands\SaveAs.js` is
   `moi.geometryDatabase.saveAs( moi.command.getCommandLineParams() );` and `Import.js` /
   `Export.js` are the same shape.
2. **Shortcut key**, via `moi.ini` `[Shortcut Keys]`. Two value forms:
   a command name with optional params (`OpenTemplate <path>\template.3dm` —
   [Hidden Secrets](http://moi3d.com/wiki/Hidden_Secrets)), or inline JS behind the `script:`
   prefix. Real entries on this machine, `%APPDATA%\Moi\moi.ini:96-109`:
   `Ctrl+A=script:moi.geometryDatabase.selectAll();`, `Ctrl+Z=script:moi.command.undo();`,
   `F1=script:moi.launchHelp();`. `script:` is also a literal in `moi_lib.dll`.
   Gibson's shellExecute-from-a-shortcut example:
   `script: moi.filesystem.shellExecute( '<path>\\test.bat' );`
3. **From other JS**: `moi.command.execCommand('Name params')`, or an `onclick=""` on a
   `<moi:CommandButton>` in a UI `.htm`.
4. **Menus/palettes**: the side-pane `.htm`/`.xml` files under `<MoI install folder>\ui\` and
   `commands\*.xml`.

Note `moi_lib.dll` also carries the token `scripts` alongside `Commands` in the command-lookup
string block, matching Gibson's *"under the commands or scripts folders"*
([6336.1](http://moi3d.com/forum/lmessages.php?webtag=MOI&msg=6336.1)). The exact resolution order
of `commands` vs `scripts` vs `AdditionalCommandsDirs` is **UNVERIFIED**.

---

## 4. Headless / batch

Yes, in the sense that matters: `MoI.exe script.js` runs with the main window never shown
([10884.1](https://moi3d.com/forum/lmessages.php?webtag=MOI&msg=10884.1)). It is not a true
headless build — it is still a GUI process with the window suppressed, so it needs a desktop
session and (per the `Video card initialization failure` / `GraphicsAPI` / `OpenGL` /
`Direct3D11` strings in `moi_lib.dll`) plausibly a working graphics stack. Running it as a Windows
service or in a session-0 context is **UNVERIFIED and I would expect trouble.**

Canonical batch shape (Gibson's own, [10884.1](https://moi3d.com/forum/lmessages.php?webtag=MOI&msg=10884.1)):

```js
moi.geometryDatabase.open( '<input>\\part.step' );
moi.geometryDatabase.saveAs( '<output>\\part.obj' );   // format chosen by extension
moi.exit( true );
```

`moi.filesystem.getFiles()` accepts a wildcard pattern, so one script can walk a whole folder.
Export options are not passed as arguments — they come from the persisted settings
(`moi.settings.*`, e.g. `objExportScaleFactor`, mesh-dialog values under `[Mesh Export]` in
`moi.ini`). For deterministic batch output an MCP server should set those explicitly, or point MoI
at a dedicated `moi.ini` via the ini command-line argument so it does not fight the user's own
settings. Mesh export normally raises the MeshDialog; the stock export path is
`moi.geometryDatabase.fileExport( name )` and **whether it suppresses the dialog under a
command-line script is UNVERIFIED** — this is the single most important thing to test early.
Settled for the bridge by probe-13 (`probe-13-file-export.md`): the dialog does open for a mesh
format, and a second argument `'NoUI=true'` suppresses it.

---

## 5. Networking from inside MoI's JS — the highest-leverage unknown

MoI 4's JS engine is JavaScriptCore from Qt 5.4.1 WebKit, ES5
([9665.2](http://moi3d.com/forum/lmessages.php?webtag=MOI&msg=9665.2)). `Qt5WebKit.dll` in this
install exports/contains the identifier strings **`XMLHttpRequest`**, **`WebSocket`**,
**`localStorage`**, **`FileReader`**, **`Blob`** (verified: `strings -n 4 Qt5WebKit.dll | grep -c "^X$"`
returns 1 for each). `fetch` is **absent** — expected for a 2015-era WebKit.

A forum post shows `XMLHttpRequest` with `xhr.responseType='blob'` plus `FileReader` being used in
MoI's HTML/JS context to pull an image off the web
([Node Wish List, 9581.37](http://moi3d.com/forum/lmessages.php?webtag=MOI&msg=9581.37)).

**But this is not proof for the case we care about**, and I am flagging it hard:

- The identifiers existing in `Qt5WebKit.dll` proves the engine *ships* them. It does not prove
  they are reachable from a **command `.js`** (which MoI executes through its own script host),
  as opposed to from an inline `<script>` in a command's `.htm` page — which is a genuine WebKit
  document context and where the forum example lives.
- Qt WebKit applies same-origin policy. MoI pages load from the `moi://` scheme; whether
  `moi://` is treated as a local/privileged origin allowed to reach `http://127.0.0.1:PORT` is
  **UNVERIFIED**. It could be blocked outright, or need a CORS header from your server.
- Whether MoI's script host injects a `window`/`XMLHttpRequest` global at all into a `.js`
  command is **UNVERIFIED**. There *is* `moi.ui.commandUI.htmlWindow` / `htmlDocument`
  (`moi_lib.dll` wide strings `window`, `htmlDocument`, `htmlWindow`) — so a `.js` command can very
  plausibly reach its `.htm` page's window object and construct an XHR *there*, which would
  sidestep the question entirely.

**Test this first, before designing anything.** Minimal probe as a custom command
(`%APPDATA%\Moi\commands\NetProbe.js`), with a local HTTP server running with permissive CORS:

```js
var w = moi.ui.commandUI ? moi.ui.commandUI.htmlWindow : null;
var X = (typeof XMLHttpRequest !== 'undefined') ? XMLHttpRequest
      : (w && w.XMLHttpRequest) ? w.XMLHttpRequest : null;
moi.ui.alert( 'direct=' + (typeof XMLHttpRequest) +
              ' viaWindow=' + (w ? typeof w.XMLHttpRequest : 'no window') +
              ' ws=' + (typeof WebSocket) );
if ( X ) {
  var x = new X();
  x.open( 'GET', 'http://127.0.0.1:8765/ping', false );   // sync — ES5, no Promise
  x.send( null );
  moi.ui.alert( x.status + ' ' + x.responseText );
}
```

Outcomes and what they mean:

- **Sync XHR works** → build the MCP bridge as long-poll over HTTP. Cleanest option by far: MCP
  server holds a queue, the in-MoI startup script long-polls it, executes, posts results back.
  Synchronous XHR blocks MoI's UI thread, so poll with a short timeout on a `moi.ui` timer rather
  than blocking forever. (No `setTimeout` guarantee in the script host — **UNVERIFIED**; the
  `.htm` window will have it.)
- **Only `WebSocket` works** → event-driven, better, but async callbacks need a live event loop;
  drive it from the command `.htm` page rather than a bare `.js`.
- **Neither works** → fall back to `shellExecute(helper, args, true)` (Bridge 2, synchronous,
  confirmed to work) with a tiny helper exe/script that talks to the MCP server, or to a
  line-oriented text mailbox via `openFileStream` under `moi.filesystem.getTempDir()`.

File I/O caveat again: `openFileStream` is **text/line-oriented only**, no binary
([9665.2](http://moi3d.com/forum/lmessages.php?webtag=MOI&msg=9665.2)). Geometry must move as
files on disk (3DM/STEP/OBJ via `saveAs`/`fileExport`), not as an in-band payload.

---

## Sources

Local install (paths given as placeholders per house rules; on this machine
`<MoI install folder>` = the MoI 4.0 program directory, `<user data>` = `%APPDATA%\Moi`):

- `<MoI install folder>\moi_commandprocessor.exe` — symbol/import strings (30 KB)
- `<MoI install folder>\moi_lib.dll` — UTF-16 name table (`strings -e l`), ~3,300 entries
- `<MoI install folder>\Qt5WebKit.dll` — JS global identifier strings
- `<MoI install folder>\commands\Extrude.js`, `Extrude.htm`, `Save.js`, `SaveAs.js`,
  `Export.js`, `Import.js`, `Image.htm`
- `<MoI install folder>\ui\DebugMenu.htm`, `ui\PromptDragDrop.htm`
- `<MoI install folder>\docs\moi_help.htm`
- `<user data>\moi.ini` lines 4-5, 82-86, 96-109; `<user data>\commands\`, `<user data>\startup\`

Web (primary):

- [Scripting — MoiWiki](https://moi3d.com/wiki/Scripting) and its `moi.idl` attachment
- [Hidden Secrets — MoiWiki](http://moi3d.com/wiki/Hidden_Secrets)
- [MaxScriptArchive — MoiWiki](https://moi3d.com/wiki/MaxScriptArchive) (Max Smirnov's scripts,
  MIT-licensed mirror; his own site `moi.maxsm.net` is dark)
- Forum, Michael Gibson: [2100.8](http://moi3d.com/forum/lmessages.php?webtag=MOI&msg=2100.8) ·
  [2100.25](https://moi3d.com/forum/lmessages.php?webtag=MOI&msg=2100.25) ·
  [6336.1](http://moi3d.com/forum/lmessages.php?webtag=MOI&msg=6336.1) ·
  [8963.1](http://moi3d.com/forum/lmessages.php?webtag=MOI&msg=8963.1) ·
  [9581.37](http://moi3d.com/forum/lmessages.php?webtag=MOI&msg=9581.37) ·
  [9665.2](http://moi3d.com/forum/lmessages.php?webtag=MOI&msg=9665.2) ·
  [10134.38](https://moi3d.com/forum/lmessages.php?webtag=MOI&msg=10134.38) ·
  [10397.1](https://moi3d.com/forum/lmessages.php?webtag=MOI&msg=10397.1) ·
  [10720.1](https://moi3d.com/forum/lmessages.php?webtag=MOI&msg=10720.1) ·
  [10884.1](https://moi3d.com/forum/lmessages.php?webtag=MOI&msg=10884.1)

## Open items to test before committing to an architecture

1. Does `XMLHttpRequest` / `WebSocket` reach a `localhost` server from a MoI command script? (§5)
2. Does `moi.geometryDatabase.fileExport()` suppress the mesh dialog under a command-line script? (§4)
3. Does launching `MoI.exe script.js` while MoI runs create a second process or reuse the first? (§1)
4. `moi.getExecutableCommandLineArgs` signature and return shape. (§1)
5. Command-name resolution order across `commands` / `scripts` / `AdditionalCommandsDirs`. (§3)
