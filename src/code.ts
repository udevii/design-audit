/// <reference types="@figma/plugin-typings" />
// main plugin code: reads the selection, runs the rules, applies fixes when clicked
import { audit, rgbToHex, DEFAULT_OPTIONS, type AuditOptions, type Fix, type Issue, type SnapNode, type SnapPaint, type Snapshot } from "./rules";

const MAX_NODES = 4000;

figma.showUI(__html__, { width: 400, height: 640, themeColors: true });

// --- snapshot ---

function isMixed(v: unknown): v is symbol {
  return typeof v === "symbol";
}

function solidFills(node: SceneNode): SnapPaint[] {
  if (!("fills" in node) || isMixed(node.fills)) return [];
  const styled = "fillStyleId" in node && typeof node.fillStyleId === "string" && node.fillStyleId !== "";
  return (node.fills as readonly Paint[])
    .filter((p): p is SolidPaint => p.type === "SOLID" && p.visible !== false)
    .map((p) => ({
      hex: rgbToHex(p.color.r, p.color.g, p.color.b),
      opacity: p.opacity ?? 1,
      styled: styled || !!p.boundVariables?.color,
    }));
}

function opaqueFill(node: SceneNode): string | null {
  if (!("opacity" in node) || node.opacity < 0.99) return null;
  const top = solidFills(node).filter((f) => f.opacity >= 0.99).pop();
  return top ? top.hex : null;
}

function contains(outer: Rect | null, inner: Rect | null): boolean {
  if (!outer || !inner) return false;
  return outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;
}

function weightFromStyle(style: string): number {
  const s = style.toLowerCase();
  if (s.includes("thin")) return 100;
  if (s.includes("extra light") || s.includes("extralight")) return 200;
  if (s.includes("light")) return 300;
  if (s.includes("medium")) return 500;
  if (s.includes("semi") || s.includes("demi")) return 600;
  if (s.includes("extra bold") || s.includes("extrabold")) return 800;
  if (s.includes("bold")) return 700;
  if (s.includes("black") || s.includes("heavy")) return 900;
  return 400;
}

async function snapshot(roots: readonly SceneNode[]): Promise<{ snap: Snapshot; truncated: boolean }> {
  const nodes: SnapNode[] = [];
  let truncated = false;

  const visit = (node: SceneNode, path: string[], bg: string | null, siblings: readonly SceneNode[]) => {
    if (nodes.length >= MAX_NODES) { truncated = true; return; }

    // a filled shape behind this layer counts as its background
    let background = bg;
    const idx = siblings.indexOf(node);
    for (let i = idx - 1; i >= 0; i--) {
      const sib = siblings[i];
      if (sib.visible && contains(sib.absoluteBoundingBox, node.absoluteBoundingBox)) {
        const hex = opaqueFill(sib);
        if (hex) { background = hex; break; }
      }
    }

    const auto = "layoutMode" in node ? node : null;
    const text = node.type === "TEXT" ? node : null;
    const radius = "cornerRadius" in node && !isMixed(node.cornerRadius) ? node.cornerRadius : null;

    nodes.push({
      id: node.id,
      name: node.name,
      type: node.type,
      path: [...path, node.name].slice(-3).join(" / "),
      visible: node.visible,
      width: "width" in node ? node.width : 0,
      height: "height" in node ? node.height : 0,
      layoutMode: auto ? auto.layoutMode : "NONE",
      itemSpacing: auto && auto.layoutMode !== "NONE" ? auto.itemSpacing : null,
      padding: auto && auto.layoutMode !== "NONE" ? [auto.paddingTop, auto.paddingRight, auto.paddingBottom, auto.paddingLeft] : null,
      radius: radius && radius > 0 ? radius : null,
      fills: solidFills(node),
      text: text
        ? {
            styled: typeof text.textStyleId === "string" && text.textStyleId !== "",
            fontSize: isMixed(text.fontSize) ? null : text.fontSize,
            fontWeight: isMixed(text.fontWeight) ? null : text.fontWeight,
            family: isMixed(text.fontName) ? null : text.fontName.family,
            sample: text.characters.replace(/\s+/g, " ").trim().slice(0, 40),
          }
        : null,
      backgroundHex: background,
      detached: "detachedInfo" in node && !!(node as FrameNode).detachedInfo,
    });

    // skip inside hidden layers and instances (check the main component instead)
    if (!node.visible || node.type === "INSTANCE" || !("children" in node)) return;
    const own = opaqueFill(node) ?? background;
    for (const child of node.children) visit(child, [...path, node.name], own, node.children);
  };

  for (const root of roots) {
    const parentBg = root.parent && "type" in root.parent && root.parent.type !== "PAGE" && root.parent.type !== "DOCUMENT" ? opaqueFill(root.parent as SceneNode) : null;
    visit(root, [], parentBg, [root]);
  }

  const paintStyles = await figma.getLocalPaintStylesAsync();
  const textStyles = await figma.getLocalTextStylesAsync();

  return {
    truncated,
    snap: {
      nodes,
      colorStyles: paintStyles
        .map((s) => ({ s, p: s.paints.find((p): p is SolidPaint => p.type === "SOLID") }))
        .filter((x): x is { s: PaintStyle; p: SolidPaint } => !!x.p)
        .map(({ s, p }) => ({ id: s.id, name: s.name, hex: rgbToHex(p.color.r, p.color.g, p.color.b) })),
      textStyles: textStyles.map((s) => ({
        id: s.id, name: s.name, fontSize: s.fontSize, fontWeight: weightFromStyle(s.fontName.style), family: s.fontName.family,
      })),
    },
  };
}

// --- fixes ---

async function applyFix(nodeId: string, fix: Fix): Promise<void> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.type === "DOCUMENT" || node.type === "PAGE") throw new Error("That layer no longer exists. Run the audit again.");
  const n = node as SceneNode;

  switch (fix.kind) {
    case "spacing": {
      if (!("layoutMode" in n)) throw new Error("This layer has no auto layout.");
      if (fix.itemSpacing !== undefined) n.itemSpacing = fix.itemSpacing;
      if (fix.padding) [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft] = fix.padding;
      break;
    }
    case "radius":
      if (!("cornerRadius" in n)) throw new Error("This layer has no corner radius.");
      (n as RectangleNode).cornerRadius = fix.value;
      break;
    case "color-style":
      if (!("setFillStyleIdAsync" in n)) throw new Error("This layer can't take a fill style.");
      await (n as GeometryMixin & SceneNode & { setFillStyleIdAsync(id: string): Promise<void> }).setFillStyleIdAsync(fix.styleId);
      break;
    case "text-style": {
      if (n.type !== "TEXT") throw new Error("Only text layers take text styles.");
      const style = (await figma.getStyleByIdAsync(fix.styleId)) as TextStyle | null;
      if (!style) throw new Error("That text style was deleted.");
      const current = n.characters.length ? n.getRangeAllFontNames(0, n.characters.length) : [];
      await Promise.all([style.fontName, ...current].map((f) => figma.loadFontAsync(f)));
      await n.setTextStyleIdAsync(fix.styleId);
      break;
    }
    case "rename":
      n.name = fix.name;
      break;
  }
}

// --- messages from the UI ---

type FromUi =
  | { type: "scan"; scope: "selection" | "page"; options?: Partial<AuditOptions> }
  | { type: "select"; nodeId: string }
  | { type: "fix"; issue: Issue }
  | { type: "load-settings" }
  | { type: "save-settings"; apiKey: string; grid: number };

let lastOptions: AuditOptions = DEFAULT_OPTIONS;
let lastScope: "selection" | "page" = "selection";

async function runScan(scope: "selection" | "page", options: AuditOptions) {
  lastOptions = options;
  lastScope = scope;
  const roots = scope === "page" ? figma.currentPage.children : figma.currentPage.selection;
  if (!roots.length) {
    figma.ui.postMessage({ type: "error", message: "Select at least one frame or component, or switch to scanning the whole page." });
    return;
  }
  const { snap, truncated } = await snapshot(roots);
  const issues = audit(snap, options);
  const context: Record<string, SnapNode> = {};
  for (const i of issues) context[i.nodeId] = snap.nodes.find((n) => n.id === i.nodeId)!;
  figma.ui.postMessage({
    type: "results",
    issues,
    context,
    styles: { colors: snap.colorStyles.map((c) => `${c.name} ${c.hex}`), texts: snap.textStyles.map((t) => `${t.name} ${t.fontSize}px`) },
    stats: { layers: snap.nodes.length, roots: roots.length, truncated, scope },
  });
}

figma.ui.onmessage = async (msg: FromUi) => {
  try {
    switch (msg.type) {
      case "scan":
        await runScan(msg.scope, { ...DEFAULT_OPTIONS, ...msg.options });
        break;
      case "select": {
        const node = await figma.getNodeByIdAsync(msg.nodeId);
        if (node && node.type !== "DOCUMENT" && node.type !== "PAGE") {
          figma.currentPage.selection = [node as SceneNode];
          figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
        }
        break;
      }
      case "fix":
        if (!msg.issue.fix) return;
        await applyFix(msg.issue.nodeId, msg.issue.fix);
        figma.notify(`${msg.issue.fix.label}. Undo with ⌘Z / Ctrl+Z.`);
        await runScan(lastScope, lastOptions);
        break;
      case "load-settings": {
        const apiKey = ((await figma.clientStorage.getAsync("apiKey")) as string | undefined) ?? "";
        const grid = ((await figma.clientStorage.getAsync("grid")) as number | undefined) ?? 4;
        figma.ui.postMessage({ type: "settings", apiKey, grid, selection: figma.currentPage.selection.length });
        break;
      }
      case "save-settings":
        await figma.clientStorage.setAsync("apiKey", msg.apiKey);
        await figma.clientStorage.setAsync("grid", msg.grid);
        figma.notify("Settings saved on this device.");
        break;
    }
  } catch (err) {
    figma.ui.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};

figma.on("selectionchange", () => {
  figma.ui.postMessage({ type: "selection", count: figma.currentPage.selection.length });
});
