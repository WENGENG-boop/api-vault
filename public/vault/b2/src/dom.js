// dom.js — tiny hyperscript + helpers. No dependencies, no build.

const SVG_NS = "http://www.w3.org/2000/svg";
const SVG_TAGS = new Set(["svg", "path", "g", "circle", "rect", "line", "polyline", "polygon", "ellipse", "text", "defs", "linearGradient", "stop"]);

/**
 * h("div.card#id", {props}, ...children)
 * - selector: tag + .classes + #id  (tag defaults to div)
 * - props: class/className, style(obj|str), on{Event}, dataset(obj), html, attrs(obj), else attribute
 * - children: nodes | strings | numbers | arrays | falsy(skip)
 */
export function h(selector, props, ...children) {
  const { tag, classes, id } = parseSelector(selector);
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (id) el.id = id;
  const classList = [...classes];

  if (props && (typeof props !== "object" || props.nodeType || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }

  if (props) {
    for (const [key, val] of Object.entries(props)) {
      if (val == null || val === false) continue;
      if (key === "class" || key === "className") classList.push(val);
      else if (key === "style") setStyle(el, val);
      else if (key === "dataset") for (const [k, v] of Object.entries(val)) el.dataset[k] = v;
      else if (key === "attrs") for (const [k, v] of Object.entries(val)) v != null && el.setAttribute(k, v);
      else if (key === "html") el.innerHTML = val;
      else if (key.startsWith("on") && typeof val === "function") el.addEventListener(key.slice(2).toLowerCase(), val);
      else if (key === "ref" && typeof val === "function") val(el);
      else if (key in el && !SVG_TAGS.has(tag)) { try { el[key] = val; } catch { el.setAttribute(key, val); } }
      else el.setAttribute(key, val === true ? "" : val);
    }
  }
  if (classList.length) el.setAttribute("class", classList.join(" "));
  append(el, children);
  return el;
}

function parseSelector(sel) {
  if (typeof sel !== "string") return { tag: "div", classes: [], id: null };
  const classes = [];
  let id = null, tag = "div", buf = "", mode = "tag";
  for (const ch of sel) {
    if (ch === "." || ch === "#") {
      if (mode === "tag" && buf) tag = buf;
      else if (mode === "class" && buf) classes.push(buf);
      else if (mode === "id" && buf) id = buf;
      buf = ""; mode = ch === "." ? "class" : "id";
    } else buf += ch;
  }
  if (mode === "tag" && buf) tag = buf;
  else if (mode === "class" && buf) classes.push(buf);
  else if (mode === "id" && buf) id = buf;
  return { tag: tag || "div", classes, id };
}

function setStyle(el, val) {
  if (typeof val === "string") el.style.cssText = val;
  else for (const [k, v] of Object.entries(val)) el.style.setProperty(k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()), v);
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

/** Replace all children of a container with new nodes. */
export function mount(container, ...nodes) {
  container.replaceChildren(...nodes.flat(Infinity).filter((n) => n != null && n !== false));
}

export function clear(el) { el.replaceChildren(); }
export const frag = (...children) => { const f = document.createDocumentFragment(); append(f, children); return f; };

/* ---------------- Icons (feather-style, 1.9 stroke) ---------------- */
const ICONS = {
  dashboard: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  providers: "M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z",
  status: "M22 12h-4l-3 9L9 3l-3 9H2",
  models: "M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  pools: "M21 5c0 1.66-4 3-9 3S3 6.66 3 5s4-3 9-3 9 1.34 9 3zM3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5M3 12c0 1.66 4 3 9 3s9-1.34 9-3",
  tokens: "M12.65 10A6 6 0 1 0 7 16h2v3h3v-3l1.35-2zM18 8l3 3-3 3M21 11h-5",
  local: "M5 12V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5M3 12h18v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM7 16h.01M11 16h2",
  usage: "M18 20V10M12 20V4M6 20v-6",
  billing: "M1 4h22v16H1zM1 10h22",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  unlock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.9-1",
  search: "M21 21l-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z",
  chevron: "M9 18l6-6-6-6",
  chevronDown: "M6 9l6 6 6-6",
  plus: "M12 5v14M5 12h14",
  x: "M18 6L6 18M6 6l12 12",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  check: "M20 6L9 17l-5-5",
  refresh: "M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.8-3.4L23 10M1 14l4.7 4.4A9 9 0 0 0 20.5 15",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  edit: "M11 4H4v16h16v-7M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z",
  external: "M18 13v6H5V6h6M15 3h6v6M10 14L21 3",
  zap: "M13 2L3 14h9l-1 8 10-12h-9z",
  bolt: "M13 2L3 14h9l-1 8 10-12h-9z",
  globe: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20",
  key: "M21 2l-2 2m-3.5 3.5a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zM15.5 7.5L19 4l3 3-3 3",
  server: "M2 5h20v6H2zM2 13h20v6H2zM6 8h.01M6 16h.01",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 11v5M12 8h.01",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  filter: "M22 3H2l8 9.5V19l4 2v-8.5z",
  link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  play: "M5 3l14 9-14 9z",
  stop: "M5 5h14v14H5z",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  wifi: "M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 20h.01",
  flame: "M12 2s4 4 4 8a4 4 0 0 1-8 0c0-1 .5-2 1-2.5C9 9 12 6 12 2z",
  cpu: "M5 5h14v14H5zM9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3",
  layers: "M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  pie: "M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z",
  coins: "M9 16a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM15 8a7 7 0 1 1-6 11",
};

export function icon(name, size = 16, opts = {}) {
  const path = ICONS[name];
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", size); svg.setAttribute("height", size);
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", opts.w || 1.9);
  svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  if (opts.class) svg.setAttribute("class", opts.class);
  if (path) for (const d of path.split("M").filter(Boolean)) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", "M" + d); svg.appendChild(p);
  }
  return svg;
}
