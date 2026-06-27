#!/usr/bin/env node
/* Exercises the ACTUAL makeDocProxy / makeWinProxy from gen1_harness.js against stub objects,
 * to validate the routing that the Shadow-DOM mount depends on (browser-untestable here). */
const fs = require("fs");
const src = fs.readFileSync("gen1_harness.js", "utf8");

// pull the two factory functions verbatim out of the harness source
function grab(name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error("missing " + name);
  // brace-match to the end of the function
  let depth = 0, started = false, j = i;
  for (; j < src.length; j++) { const ch = src[j]; if (ch === "{") { depth++; started = true; } else if (ch === "}") { depth--; if (started && depth === 0) { j++; break; } } }
  return src.slice(i, j);
}
const factories = grab("makeDocProxy") + "\n" + grab("makeWinProxy");

let ok = true;
const eq = (cond, msg) => { console.log((cond ? "✓ " : "✗ ") + msg); if (!cond) ok = false; };

// stubs
const recorded = { docEvents: [], winEvents: [], deferred: 0 };
const root = {
  getElementById: (id) => ({ _id: id }),
  querySelector: (s) => ({ _q: s }),
  querySelectorAll: (s) => [{ _qa: s }],
  activeElement: { tag: "INPUT" },
};
const host = { _host: true };
const fakeDoc = {
  createElement: (t) => ({ _created: t }),
  body: { _realBody: true },
  addEventListener: (t) => recorded.docEvents.push(t),
  readyState: "complete",
  documentElement: { _docEl: true },
  title: "T",
};
const fakeWin = {
  addEventListener: (t) => recorded.winEvents.push(t),
  requestAnimationFrame: () => 1,
  devicePixelRatio: 2,
};
const realSetTimeout = setTimeout;

// build the factories with fakes injected as `document`/`window`/global setTimeout
const make = new Function(
  "document", "window", "setTimeout", "CSS",
  factories + "\n return { makeDocProxy, makeWinProxy };"
);
const { makeDocProxy, makeWinProxy } = make(fakeDoc, fakeWin, (fn) => { recorded.deferred++; return realSetTimeout(fn, 0); }, { escape: (s) => s });

const dp = makeDocProxy(root, host);
const wp = makeWinProxy();

// document proxy routing
eq(dp.getElementById("view")._id === "view", "doc.getElementById → shadow root");
eq(dp.querySelector(".x")._q === ".x", "doc.querySelector → shadow root");
eq(dp.querySelectorAll(".y")[0]._qa === ".y", "doc.querySelectorAll → shadow root");
eq(dp.body === host, "doc.body → host element (classList/appends)");
eq(dp.activeElement === root.activeElement, "doc.activeElement → shadow root (focus guard works)");
eq(dp.createElement("canvas")._created === "canvas", "doc.createElement → real document");
eq(dp.documentElement._docEl === true, "doc.documentElement → real (theme reads)");
eq(dp.title === "T", "doc.<other> → real document");

recorded.docEvents = []; recorded.deferred = 0;
dp.addEventListener("DOMContentLoaded", () => {});
eq(recorded.docEvents.length === 0 && recorded.deferred === 1, "doc.addEventListener(DOMContentLoaded) → deferred, not bound");
dp.addEventListener("keydown", () => {});
eq(recorded.docEvents.includes("keydown"), "doc.addEventListener(keydown) → real document (drags/keys work)");

// window proxy routing
eq(wp.requestAnimationFrame() === 1, "win.requestAnimationFrame → real window");
eq(wp.devicePixelRatio === 2, "win.<prop> → real window");
recorded.winEvents = []; recorded.deferred = 0;
wp.addEventListener("load", () => {});
eq(recorded.winEvents.length === 0 && recorded.deferred === 1, "win.addEventListener(load) w/ readyState complete → deferred");
wp.addEventListener("resize", () => {});
eq(recorded.winEvents.includes("resize"), "win.addEventListener(resize) → real window");

console.log(ok ? "\n✓ PROXY ROUTING VERIFIED" : "\n✗ PROXY ROUTING FAILED");
process.exit(ok ? 0 : 1);
