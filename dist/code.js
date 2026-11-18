"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };

  // src/rules.ts
  var DEFAULT_OPTIONS = {
    grid: 4,
    radiusScale: [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 999],
    minTarget: 44
  };
  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrastRatio(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }
  function deltaE(a, b) {
    const lab = (hex) => {
      const [r, g, bl] = hexToRgb(hex).map((v) => {
        const c = v / 255;
        return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
      });
      const x = (r * 0.4124 + g * 0.3576 + bl * 0.1805) / 0.95047;
      const y = r * 0.2126 + g * 0.7152 + bl * 0.0722;
      const z = (r * 0.0193 + g * 0.1192 + bl * 0.9505) / 1.08883;
      const f = (t) => t > 8856e-6 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
      return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
    };
    const [l1, a1, b1] = lab(a);
    const [l2, a2, b2] = lab(b);
    return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
  }
  var DEFAULT_NAME = /^(Frame|Rectangle|Group|Ellipse|Vector|Line|Polygon|Star|Text|Union|Subtract|Intersect|Exclude|Image|Section|Slice)( \d+)?$/;
  var INTERACTIVE_NAME = /\b(button|btn|link|tab|chip|toggle|checkbox|radio|icon[- ]?button|cta)\b/i;
  var CONTAINER_TYPES = /* @__PURE__ */ new Set(["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"]);
  var snap = (v, grid) => Math.round(v / grid) * grid;
  var nearest = (v, scale) => scale.reduce((best, s) => Math.abs(s - v) < Math.abs(best - v) ? s : best, scale[0]);
  function audit(s, opts = DEFAULT_OPTIONS) {
    var _a, _b, _c, _d, _e, _f;
    const issues = [];
    const push = (n, rule, severity, message, why, fix) => issues.push({ key: `${rule}:${n.id}:${issues.length}`, rule, severity, nodeId: n.id, nodeName: n.name, path: n.path, message, why, fix });
    for (const n of s.nodes) {
      if (!n.visible) {
        push(n, "hidden", "info", `\u201C${n.name}\u201D is hidden`, "Hidden layers ship with the file and confuse whoever picks it up next. Delete it if it's no longer needed, or move explorations to a separate page.");
        continue;
      }
      if (n.text && n.backgroundHex) {
        const fill = n.fills.find((f) => f.opacity >= 0.99);
        if (fill) {
          const ratio = contrastRatio(fill.hex, n.backgroundHex);
          const large = ((_a = n.text.fontSize) != null ? _a : 0) >= 24 || ((_b = n.text.fontSize) != null ? _b : 0) >= 18.66 && ((_c = n.text.fontWeight) != null ? _c : 400) >= 700;
          const need = large ? 3 : 4.5;
          if (ratio < need) {
            push(
              n,
              "contrast",
              "error",
              `Contrast ${ratio.toFixed(2)}:1 is below ${need}:1 (${fill.hex} on ${n.backgroundHex})`,
              `WCAG 1.4.3 asks for at least ${need}:1 for ${large ? "large" : "body-size"} text so people with low vision, or anyone on a dim TV across the room, can read it.`
            );
          }
        }
      }
      for (const f of n.fills) {
        if (f.styled) continue;
        const closest = s.colorStyles.map((cs) => ({ cs, d: deltaE(cs.hex, f.hex) })).sort((a, b) => a.d - b.d)[0];
        const fix = closest && closest.d < 6 ? { kind: "color-style", styleId: closest.cs.id, label: `Use ${closest.cs.name}` } : void 0;
        const extra = closest ? ` Closest style: ${closest.cs.name} ${closest.cs.hex} (\u0394E ${closest.d.toFixed(1)}).` : "";
        push(
          n,
          "color",
          "warning",
          `Hard-coded fill ${f.hex}`,
          `Colors that aren't tied to a style or variable drift over time and don't update when the palette changes.${extra}`,
          fix
        );
      }
      if (n.text && !n.text.styled) {
        const t = n.text;
        const closest = s.textStyles.map((ts) => {
          var _a2, _b2;
          return { ts, d: Math.abs(ts.fontSize - ((_a2 = t.fontSize) != null ? _a2 : 0)) * 2 + Math.abs(ts.fontWeight - ((_b2 = t.fontWeight) != null ? _b2 : 400)) / 100 + (ts.family === t.family ? 0 : 1) };
        }).sort((a, b) => a.d - b.d)[0];
        const fix = closest && closest.d <= 4 ? { kind: "text-style", styleId: closest.ts.id, label: `Use ${closest.ts.name}` } : void 0;
        push(
          n,
          "text-style",
          "warning",
          `Text \u201C${t.sample}\u201D has no text style (${(_d = t.fontSize) != null ? _d : "mixed"}px ${(_e = t.family) != null ? _e : ""})`.trim(),
          `Unstyled text is how type scales fall apart: a 15px here and a 15.5px there. Linking it to a style keeps it in sync with the system.${closest ? ` Closest style: ${closest.ts.name} (${closest.ts.fontSize}px).` : ""}`,
          fix
        );
      }
      if (n.layoutMode !== "NONE" && (n.itemSpacing !== null || n.padding)) {
        const off = [];
        if (n.itemSpacing !== null && n.itemSpacing % opts.grid !== 0) off.push(`gap ${n.itemSpacing}`);
        const pad = n.padding;
        if (pad && pad.some((p) => p % opts.grid !== 0)) off.push(`padding ${pad.join("/")}`);
        if (off.length) {
          const snappedPad = pad ? pad.map((p) => snap(p, opts.grid)) : void 0;
          const snappedGap = n.itemSpacing !== null ? snap(n.itemSpacing, opts.grid) : void 0;
          push(
            n,
            "spacing",
            "warning",
            `Off the ${opts.grid}px grid: ${off.join(", ")}`,
            `Spacing that sits on a shared ${opts.grid}px grid lines up across screens and maps cleanly to spacing tokens in code.`,
            { kind: "spacing", itemSpacing: snappedGap, padding: snappedPad, label: `Snap to ${opts.grid}px grid` }
          );
        }
      }
      if (n.radius !== null && n.radius > 0 && !opts.radiusScale.includes(n.radius)) {
        const to = nearest(n.radius, opts.radiusScale);
        push(
          n,
          "radius",
          "warning",
          `Corner radius ${n.radius}px isn't on the scale`,
          `A small set of radii (${opts.radiusScale.filter((r) => r < 999).join(", ")}) keeps components feeling like one family.`,
          { kind: "radius", value: to, label: `Set to ${to}px` }
        );
      }
      if (DEFAULT_NAME.test(n.name)) {
        const suggestion = ((_f = n.text) == null ? void 0 : _f.sample) ? n.text.sample.slice(0, 32) : null;
        push(
          n,
          "naming",
          "info",
          `Default layer name \u201C${n.name}\u201D`,
          "Descriptive names make files searchable, make handoff specs readable, and let Code Connect and dev mode map layers to code.",
          suggestion ? { kind: "rename", name: suggestion, label: `Rename to \u201C${suggestion}\u201D` } : void 0
        );
      }
      if (n.detached) {
        push(
          n,
          "detached",
          "warning",
          `\u201C${n.name}\u201D was detached from its component`,
          "Detached copies stop receiving updates from the library, so fixes to the main component never reach them."
        );
      }
      if (CONTAINER_TYPES.has(n.type) && INTERACTIVE_NAME.test(n.name) && (n.height < opts.minTarget || n.width < opts.minTarget)) {
        push(
          n,
          "tap-target",
          "info",
          `\u201C${n.name}\u201D is ${Math.round(n.width)}\xD7${Math.round(n.height)}, under ${opts.minTarget}px`,
          `Touch targets under ${opts.minTarget}px are easy to miss on phones (WCAG 2.5.8 sets 24px as the floor; ${opts.minTarget}px is the comfortable size most platforms recommend).`
        );
      }
    }
    const raw = Array.from(new Set(s.nodes.flatMap((n) => n.fills.filter((f) => !f.styled).map((f) => f.hex))));
    for (let i = 0; i < raw.length; i++) {
      for (let j = i + 1; j < raw.length; j++) {
        const d = deltaE(raw[i], raw[j]);
        if (d > 0 && d < 2.3) {
          const node = s.nodes.find((n) => n.fills.some((f) => f.hex === raw[j]));
          push(
            node,
            "color",
            "info",
            `${raw[i]} and ${raw[j]} are nearly identical (\u0394E ${d.toFixed(1)})`,
            "Two colors no one can tell apart usually mean one of them was eyedropped by accident. Pick one and turn it into a style."
          );
        }
      }
    }
    const order = { error: 0, warning: 1, info: 2 };
    return issues.sort((a, b) => order[a.severity] - order[b.severity]);
  }

  // src/code.ts
  var MAX_NODES = 4e3;
  figma.showUI(__html__, { width: 400, height: 640, themeColors: true });
  function isMixed(v) {
    return typeof v === "symbol";
  }
  function solidFills(node) {
    if (!("fills" in node) || isMixed(node.fills)) return [];
    const styled = "fillStyleId" in node && typeof node.fillStyleId === "string" && node.fillStyleId !== "";
    return node.fills.filter((p) => p.type === "SOLID" && p.visible !== false).map((p) => {
      var _a, _b;
      return {
        hex: rgbToHex(p.color.r, p.color.g, p.color.b),
        opacity: (_a = p.opacity) != null ? _a : 1,
        styled: styled || !!((_b = p.boundVariables) == null ? void 0 : _b.color)
      };
    });
  }
  function opaqueFill(node) {
    if (!("opacity" in node) || node.opacity < 0.99) return null;
    const top = solidFills(node).filter((f) => f.opacity >= 0.99).pop();
    return top ? top.hex : null;
  }
  function contains(outer, inner) {
    if (!outer || !inner) return false;
    return outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;
  }
  function weightFromStyle(style) {
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
  async function snapshot(roots) {
    const nodes = [];
    let truncated = false;
    const visit = (node, path, bg, siblings) => {
      var _a;
      if (nodes.length >= MAX_NODES) {
        truncated = true;
        return;
      }
      let background = bg;
      const idx = siblings.indexOf(node);
      for (let i = idx - 1; i >= 0; i--) {
        const sib = siblings[i];
        if (sib.visible && contains(sib.absoluteBoundingBox, node.absoluteBoundingBox)) {
          const hex = opaqueFill(sib);
          if (hex) {
            background = hex;
            break;
          }
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
        text: text ? {
          styled: typeof text.textStyleId === "string" && text.textStyleId !== "",
          fontSize: isMixed(text.fontSize) ? null : text.fontSize,
          fontWeight: isMixed(text.fontWeight) ? null : text.fontWeight,
          family: isMixed(text.fontName) ? null : text.fontName.family,
          sample: text.characters.replace(/\s+/g, " ").trim().slice(0, 40)
        } : null,
        backgroundHex: background,
        detached: "detachedInfo" in node && !!node.detachedInfo
      });
      if (!node.visible || node.type === "INSTANCE" || !("children" in node)) return;
      const own = (_a = opaqueFill(node)) != null ? _a : background;
      for (const child of node.children) visit(child, [...path, node.name], own, node.children);
    };
    for (const root of roots) {
      const parentBg = root.parent && "type" in root.parent && root.parent.type !== "PAGE" && root.parent.type !== "DOCUMENT" ? opaqueFill(root.parent) : null;
      visit(root, [], parentBg, [root]);
    }
    const paintStyles = await figma.getLocalPaintStylesAsync();
    const textStyles = await figma.getLocalTextStylesAsync();
    return {
      truncated,
      snap: {
        nodes,
        colorStyles: paintStyles.map((s) => ({ s, p: s.paints.find((p) => p.type === "SOLID") })).filter((x) => !!x.p).map(({ s, p }) => ({ id: s.id, name: s.name, hex: rgbToHex(p.color.r, p.color.g, p.color.b) })),
        textStyles: textStyles.map((s) => ({
          id: s.id,
          name: s.name,
          fontSize: s.fontSize,
          fontWeight: weightFromStyle(s.fontName.style),
          family: s.fontName.family
        }))
      }
    };
  }
  async function applyFix(nodeId, fix) {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node || node.type === "DOCUMENT" || node.type === "PAGE") throw new Error("That layer no longer exists. Run the audit again.");
    const n = node;
    switch (fix.kind) {
      case "spacing": {
        if (!("layoutMode" in n)) throw new Error("This layer has no auto layout.");
        if (fix.itemSpacing !== void 0) n.itemSpacing = fix.itemSpacing;
        if (fix.padding) [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft] = fix.padding;
        break;
      }
      case "radius":
        if (!("cornerRadius" in n)) throw new Error("This layer has no corner radius.");
        n.cornerRadius = fix.value;
        break;
      case "color-style":
        if (!("setFillStyleIdAsync" in n)) throw new Error("This layer can't take a fill style.");
        await n.setFillStyleIdAsync(fix.styleId);
        break;
      case "text-style": {
        if (n.type !== "TEXT") throw new Error("Only text layers take text styles.");
        const style = await figma.getStyleByIdAsync(fix.styleId);
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
  var lastOptions = DEFAULT_OPTIONS;
  var lastScope = "selection";
  async function runScan(scope, options) {
    lastOptions = options;
    lastScope = scope;
    const roots = scope === "page" ? figma.currentPage.children : figma.currentPage.selection;
    if (!roots.length) {
      figma.ui.postMessage({ type: "error", message: "Select at least one frame or component, or switch to scanning the whole page." });
      return;
    }
    const { snap: snap2, truncated } = await snapshot(roots);
    const issues = audit(snap2, options);
    const context = {};
    for (const i of issues) context[i.nodeId] = snap2.nodes.find((n) => n.id === i.nodeId);
    figma.ui.postMessage({
      type: "results",
      issues,
      context,
      styles: { colors: snap2.colorStyles.map((c) => `${c.name} ${c.hex}`), texts: snap2.textStyles.map((t) => `${t.name} ${t.fontSize}px`) },
      stats: { layers: snap2.nodes.length, roots: roots.length, truncated, scope }
    });
  }
  figma.ui.onmessage = async (msg) => {
    var _a, _b;
    try {
      switch (msg.type) {
        case "scan":
          await runScan(msg.scope, __spreadValues(__spreadValues({}, DEFAULT_OPTIONS), msg.options));
          break;
        case "select": {
          const node = await figma.getNodeByIdAsync(msg.nodeId);
          if (node && node.type !== "DOCUMENT" && node.type !== "PAGE") {
            figma.currentPage.selection = [node];
            figma.viewport.scrollAndZoomIntoView([node]);
          }
          break;
        }
        case "fix":
          if (!msg.issue.fix) return;
          await applyFix(msg.issue.nodeId, msg.issue.fix);
          figma.notify(`${msg.issue.fix.label}. Undo with \u2318Z / Ctrl+Z.`);
          await runScan(lastScope, lastOptions);
          break;
        case "load-settings": {
          const apiKey = (_a = await figma.clientStorage.getAsync("apiKey")) != null ? _a : "";
          const grid = (_b = await figma.clientStorage.getAsync("grid")) != null ? _b : 4;
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
})();
