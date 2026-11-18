import { test } from "node:test";
import assert from "node:assert/strict";
import { audit, contrastRatio, deltaE, type SnapNode, type Snapshot } from "../src/rules";

const base = (over: Partial<SnapNode>): SnapNode => ({
  id: "1:1", name: "Card", type: "FRAME", path: "Home / Card", visible: true, width: 320, height: 180,
  layoutMode: "NONE", itemSpacing: null, padding: null, radius: null, fills: [], text: null,
  backgroundHex: null, detached: false, ...over,
});

const snapshot = (nodes: SnapNode[]): Snapshot => ({
  nodes,
  colorStyles: [{ id: "S:surface", name: "Surface/Raised", hex: "#1F2431" }],
  textStyles: [{ id: "S:body", name: "Body/M", fontSize: 16, fontWeight: 400, family: "Inter" }],
});

test("contrast ratio matches WCAG reference values", () => {
  assert.equal(contrastRatio("#000000", "#FFFFFF").toFixed(1), "21.0");
  assert.equal(contrastRatio("#777777", "#FFFFFF").toFixed(2), "4.48");
});

test("flags low-contrast body text but not large text at 3:1", () => {
  const text = { styled: true, fontSize: 14, fontWeight: 400, family: "Inter", sample: "Watch now" };
  const grey = [{ hex: "#777777", opacity: 1, styled: true }];
  const small = audit(snapshot([base({ id: "t1", type: "TEXT", name: "Label", text, fills: grey, backgroundHex: "#FFFFFF" })]));
  assert.ok(small.some((i) => i.rule === "contrast" && i.severity === "error"));
  const large = audit(snapshot([base({ id: "t2", type: "TEXT", name: "Title", text: { ...text, fontSize: 28 }, fills: grey, backgroundHex: "#FFFFFF" })]));
  assert.ok(!large.some((i) => i.rule === "contrast"));
});

test("suggests the nearest color style for a raw fill", () => {
  const issues = audit(snapshot([base({ fills: [{ hex: "#202533", opacity: 1, styled: false }] })]));
  const color = issues.find((i) => i.rule === "color" && i.fix);
  assert.equal(color?.fix?.kind, "color-style");
  assert.ok(deltaE("#202533", "#1F2431") < 6);
});

test("snaps off-grid auto layout spacing to the grid", () => {
  const issues = audit(snapshot([base({ layoutMode: "VERTICAL", itemSpacing: 10, padding: [16, 18, 16, 16] })]));
  const spacing = issues.find((i) => i.rule === "spacing");
  assert.deepEqual(spacing?.fix, { kind: "spacing", itemSpacing: 12, padding: [16, 20, 16, 16], label: "Snap to 4px grid" });
});

test("moves odd radii to the nearest value on the scale", () => {
  const issues = audit(snapshot([base({ radius: 11 })]));
  assert.equal(issues.find((i) => i.rule === "radius")?.fix?.kind, "radius");
  assert.deepEqual(issues.find((i) => i.rule === "radius")?.fix, { kind: "radius", value: 12, label: "Set to 12px" });
});

test("unstyled text gets the closest text style", () => {
  const issues = audit(snapshot([base({ type: "TEXT", name: "Text 4", text: { styled: false, fontSize: 15, fontWeight: 400, family: "Inter", sample: "Continue watching" } })]));
  assert.equal(issues.find((i) => i.rule === "text-style")?.fix?.kind, "text-style");
  assert.deepEqual(issues.find((i) => i.rule === "naming")?.fix, { kind: "rename", name: "Continue watching", label: "Rename to “Continue watching”" });
});

test("small buttons, detached copies and hidden layers are reported", () => {
  const issues = audit(snapshot([
    base({ id: "b", name: "Button / Play", height: 32 }),
    base({ id: "d", name: "Rail card", detached: true }),
    base({ id: "h", name: "Old hero", visible: false }),
  ]));
  assert.deepEqual(new Set(issues.map((i) => i.rule)), new Set(["tap-target", "detached", "hidden"]));
});

test("a clean, styled layer produces no issues", () => {
  const issues = audit(snapshot([base({ name: "Hero", layoutMode: "HORIZONTAL", itemSpacing: 16, padding: [24, 24, 24, 24], radius: 12, fills: [{ hex: "#1F2431", opacity: 1, styled: true }] })]));
  assert.equal(issues.length, 0);
});

test("errors sort before warnings and notes", () => {
  const issues = audit(snapshot([
    base({ id: "n", name: "Frame 12" }),
    base({ id: "t", type: "TEXT", name: "Caption", text: { styled: true, fontSize: 12, fontWeight: 400, family: "Inter", sample: "x" }, fills: [{ hex: "#999999", opacity: 1, styled: true }], backgroundHex: "#FFFFFF" }),
  ]));
  assert.equal(issues[0].severity, "error");
});
