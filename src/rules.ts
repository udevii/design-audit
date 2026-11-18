// all the audit rules. they run on plain data (not figma nodes)
// so they can be tested in node without figma

export type RuleId = "contrast" | "color" | "text-style" | "spacing" | "radius" | "naming" | "detached" | "hidden" | "tap-target";
export type Severity = "error" | "warning" | "info";

export interface SnapPaint {
  hex: string;
  opacity: number;
  /** Bound to a paint style or a color variable. */
  styled: boolean;
}

export interface SnapText {
  styled: boolean;
  fontSize: number | null; // null = mixed
  fontWeight: number | null;
  family: string | null;
  sample: string;
}

export interface SnapNode {
  id: string;
  name: string;
  type: string;
  path: string;
  visible: boolean;
  width: number;
  height: number;
  layoutMode: "NONE" | "HORIZONTAL" | "VERTICAL" | "GRID";
  itemSpacing: number | null;
  padding: [number, number, number, number] | null; // top, right, bottom, left
  radius: number | null; // null = none or mixed
  fills: SnapPaint[];
  text: SnapText | null;
  /** Hex of the nearest opaque solid fill behind this node. */
  backgroundHex: string | null;
  detached: boolean;
}

export interface ColorStyle { id: string; name: string; hex: string }
export interface TextStyle { id: string; name: string; fontSize: number; fontWeight: number; family: string }

export interface Snapshot {
  nodes: SnapNode[];
  colorStyles: ColorStyle[];
  textStyles: TextStyle[];
}

export interface AuditOptions {
  /** Spacing grid, in px. */
  grid: number;
  /** Allowed corner radii. */
  radiusScale: number[];
  /** Minimum touch target, in px. */
  minTarget: number;
}

export const DEFAULT_OPTIONS: AuditOptions = {
  grid: 4,
  radiusScale: [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 999],
  minTarget: 44,
};

export type Fix =
  | { kind: "spacing"; itemSpacing?: number; padding?: [number, number, number, number]; label: string }
  | { kind: "radius"; value: number; label: string }
  | { kind: "color-style"; styleId: string; label: string }
  | { kind: "text-style"; styleId: string; label: string }
  | { kind: "rename"; name: string; label: string };

export interface Issue {
  key: string;
  rule: RuleId;
  severity: Severity;
  nodeId: string;
  nodeName: string;
  path: string;
  message: string;
  // explanation shown without AI
  why: string;
  fix?: Fix;
}

export const RULE_LABELS: Record<RuleId, string> = {
  contrast: "Text contrast",
  color: "Raw colors",
  "text-style": "Text styles",
  spacing: "Spacing grid",
  radius: "Corner radius",
  naming: "Layer names",
  detached: "Detached components",
  hidden: "Hidden layers",
  "tap-target": "Tap targets",
};

// --- color helpers ---

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// deltaE (CIE76). under ~2.3 you basically can't tell them apart
export function deltaE(a: string, b: string): number {
  const lab = (hex: string) => {
    const [r, g, bl] = hexToRgb(hex).map((v) => {
      const c = v / 255;
      return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
    });
    const x = (r * 0.4124 + g * 0.3576 + bl * 0.1805) / 0.95047;
    const y = r * 0.2126 + g * 0.7152 + bl * 0.0722;
    const z = (r * 0.0193 + g * 0.1192 + bl * 0.9505) / 1.08883;
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

// --- rules ---

const DEFAULT_NAME = /^(Frame|Rectangle|Group|Ellipse|Vector|Line|Polygon|Star|Text|Union|Subtract|Intersect|Exclude|Image|Section|Slice)( \d+)?$/;
const INTERACTIVE_NAME = /\b(button|btn|link|tab|chip|toggle|checkbox|radio|icon[- ]?button|cta)\b/i;
const CONTAINER_TYPES = new Set(["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"]);

const snap = (v: number, grid: number) => Math.round(v / grid) * grid;
const nearest = (v: number, scale: number[]) => scale.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), scale[0]);

export function audit(s: Snapshot, opts: AuditOptions = DEFAULT_OPTIONS): Issue[] {
  const issues: Issue[] = [];
  const push = (n: SnapNode, rule: RuleId, severity: Severity, message: string, why: string, fix?: Fix) =>
    issues.push({ key: `${rule}:${n.id}:${issues.length}`, rule, severity, nodeId: n.id, nodeName: n.name, path: n.path, message, why, fix });

  for (const n of s.nodes) {
    if (!n.visible) {
      push(n, "hidden", "info", `“${n.name}” is hidden`, "Hidden layers ship with the file and confuse whoever picks it up next. Delete it if it's no longer needed, or move explorations to a separate page.");
      continue;
    }

    // Text contrast (WCAG 2.2, 1.4.3)
    if (n.text && n.backgroundHex) {
      const fill = n.fills.find((f) => f.opacity >= 0.99);
      if (fill) {
        const ratio = contrastRatio(fill.hex, n.backgroundHex);
        const large = (n.text.fontSize ?? 0) >= 24 || ((n.text.fontSize ?? 0) >= 18.66 && (n.text.fontWeight ?? 400) >= 700);
        const need = large ? 3 : 4.5;
        if (ratio < need) {
          push(n, "contrast", "error", `Contrast ${ratio.toFixed(2)}:1 is below ${need}:1 (${fill.hex} on ${n.backgroundHex})`,
            `WCAG 1.4.3 asks for at least ${need}:1 for ${large ? "large" : "body-size"} text so people with low vision, or anyone on a dim TV across the room, can read it.`);
        }
      }
    }

    // Raw colors: suggest the closest existing style
    for (const f of n.fills) {
      if (f.styled) continue;
      const closest = s.colorStyles
        .map((cs) => ({ cs, d: deltaE(cs.hex, f.hex) }))
        .sort((a, b) => a.d - b.d)[0];
      const fix: Fix | undefined = closest && closest.d < 6
        ? { kind: "color-style", styleId: closest.cs.id, label: `Use ${closest.cs.name}` }
        : undefined;
      const extra = closest ? ` Closest style: ${closest.cs.name} ${closest.cs.hex} (ΔE ${closest.d.toFixed(1)}).` : "";
      push(n, "color", "warning", `Hard-coded fill ${f.hex}`,
        `Colors that aren't tied to a style or variable drift over time and don't update when the palette changes.${extra}`, fix);
    }

    // Text styles
    if (n.text && !n.text.styled) {
      const t = n.text;
      const closest = s.textStyles
        .map((ts) => ({ ts, d: Math.abs(ts.fontSize - (t.fontSize ?? 0)) * 2 + Math.abs(ts.fontWeight - (t.fontWeight ?? 400)) / 100 + (ts.family === t.family ? 0 : 1) }))
        .sort((a, b) => a.d - b.d)[0];
      const fix: Fix | undefined = closest && closest.d <= 4 ? { kind: "text-style", styleId: closest.ts.id, label: `Use ${closest.ts.name}` } : undefined;
      push(n, "text-style", "warning", `Text “${t.sample}” has no text style (${t.fontSize ?? "mixed"}px ${t.family ?? ""})`.trim(),
        `Unstyled text is how type scales fall apart: a 15px here and a 15.5px there. Linking it to a style keeps it in sync with the system.${closest ? ` Closest style: ${closest.ts.name} (${closest.ts.fontSize}px).` : ""}`, fix);
    }

    // Spacing on the grid
    if (n.layoutMode !== "NONE" && (n.itemSpacing !== null || n.padding)) {
      const off: string[] = [];
      if (n.itemSpacing !== null && n.itemSpacing % opts.grid !== 0) off.push(`gap ${n.itemSpacing}`);
      const pad = n.padding;
      if (pad && pad.some((p) => p % opts.grid !== 0)) off.push(`padding ${pad.join("/")}`);
      if (off.length) {
        const snappedPad = pad ? (pad.map((p) => snap(p, opts.grid)) as [number, number, number, number]) : undefined;
        const snappedGap = n.itemSpacing !== null ? snap(n.itemSpacing, opts.grid) : undefined;
        push(n, "spacing", "warning", `Off the ${opts.grid}px grid: ${off.join(", ")}`,
          `Spacing that sits on a shared ${opts.grid}px grid lines up across screens and maps cleanly to spacing tokens in code.`,
          { kind: "spacing", itemSpacing: snappedGap, padding: snappedPad, label: `Snap to ${opts.grid}px grid` });
      }
    }

    // Radius on the scale
    if (n.radius !== null && n.radius > 0 && !opts.radiusScale.includes(n.radius)) {
      const to = nearest(n.radius, opts.radiusScale);
      push(n, "radius", "warning", `Corner radius ${n.radius}px isn't on the scale`,
        `A small set of radii (${opts.radiusScale.filter((r) => r < 999).join(", ")}) keeps components feeling like one family.`,
        { kind: "radius", value: to, label: `Set to ${to}px` });
    }

    // Default layer names
    if (DEFAULT_NAME.test(n.name)) {
      const suggestion = n.text?.sample ? n.text.sample.slice(0, 32) : null;
      push(n, "naming", "info", `Default layer name “${n.name}”`,
        "Descriptive names make files searchable, make handoff specs readable, and let Code Connect and dev mode map layers to code.",
        suggestion ? { kind: "rename", name: suggestion, label: `Rename to “${suggestion}”` } : undefined);
    }

    if (n.detached) {
      push(n, "detached", "warning", `“${n.name}” was detached from its component`,
        "Detached copies stop receiving updates from the library, so fixes to the main component never reach them.");
    }

    if (CONTAINER_TYPES.has(n.type) && INTERACTIVE_NAME.test(n.name) && (n.height < opts.minTarget || n.width < opts.minTarget)) {
      push(n, "tap-target", "info", `“${n.name}” is ${Math.round(n.width)}×${Math.round(n.height)}, under ${opts.minTarget}px`,
        `Touch targets under ${opts.minTarget}px are easy to miss on phones (WCAG 2.5.8 sets 24px as the floor; ${opts.minTarget}px is the comfortable size most platforms recommend).`);
    }
  }

  // Near-duplicate raw colors across the selection
  const raw = Array.from(new Set(s.nodes.flatMap((n) => n.fills.filter((f) => !f.styled).map((f) => f.hex))));
  for (let i = 0; i < raw.length; i++) {
    for (let j = i + 1; j < raw.length; j++) {
      const d = deltaE(raw[i], raw[j]);
      if (d > 0 && d < 2.3) {
        const node = s.nodes.find((n) => n.fills.some((f) => f.hex === raw[j]))!;
        push(node, "color", "info", `${raw[i]} and ${raw[j]} are nearly identical (ΔE ${d.toFixed(1)})`,
          "Two colors no one can tell apart usually mean one of them was eyedropped by accident. Pick one and turn it into a style.");
      }
    }
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
