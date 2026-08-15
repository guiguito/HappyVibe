/**
 * §28 — the element picker, injected rather than preloaded.
 *
 * The guest gets NO preload (the locked sandbox rule), so the picker is
 * `executeJavaScript` from main: an IIFE that installs mouseover/click
 * listeners, resolves with the element the user chose, and removes itself. It
 * runs in the page's own world, which is fine because it reads geometry and DOM
 * — it is given no privilege the page did not already have.
 *
 * The payload is PAGE-CONTROLLED text. It enters the composer as a chip the
 * USER then sends, so it needs no untrusted-input banner: the human is the
 * author of that turn, which is exactly the distinction §28 draws for tool
 * results (those DO get the banner).
 */

/** Long enough to identify a component, short enough not to blow up a prompt. */
export const MAX_OUTER_HTML = 2000;

export interface PickedElement {
  selector: string;
  outerHTML: string;
  /** A short human label for the chip — tag + id/class, never the whole node. */
  label: string;
  /**
   * The element's viewport rect in CSS pixels, so the comment popup can pin
   * itself to the thing being commented on. Optional: a page that moves the
   * element between click and read still yields a usable comment, just centred.
   */
  rect?: { x: number; y: number; width: number; height: number };
}

/**
 * Trim page HTML for the composer.
 *
 * Keeps the OPENING tag whole: that is where the identity lives (tag, id,
 * classes, data attributes), and a cut that lands mid-attribute produces
 * something that reads like markup but is not.
 */
export function trimOuterHtml(html: string, max = MAX_OUTER_HTML): string {
  if (html.length <= max) return html;
  return `${html.slice(0, max)}\n…[trimmed ${html.length - max} chars]`;
}

/**
 * The injected picker. Resolves to a JSON string (or "null" when cancelled) —
 * executeJavaScript can only ferry structured-cloneable values, and a string
 * keeps the contract obvious at both ends.
 */
export const PICKER_SCRIPT = `(() => {
  if (window.__hvPickerActive) return window.__hvPickerPromise;
  window.__hvPickerActive = true;
  const HL = document.createElement("div");
  HL.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #ff7a45;background:rgba(255,122,69,0.12);border-radius:3px;transition:all 40ms linear";
  document.documentElement.appendChild(HL);

  const selectorFor = (el) => {
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      const cls = (node.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) part += "." + cls.map((c) => CSS.escape(c)).join(".");
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sibs.length > 1) part += ":nth-of-type(" + (sibs.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      if (node.id) { parts[0] = "#" + CSS.escape(node.id); break; }
      node = node.parentElement;
    }
    return parts.join(" > ");
  };

  // What the user CALLS the thing, never what it is made of. This used to read
  // "<a.nav-play> PLAY" — a tag and a class name are the developer's handle on
  // an element, and the person pointing at a button on screen means "PLAY".
  // The selector still travels in the payload; it just stops being the label.
  const KINDS = { a: "link", button: "button", img: "image", svg: "icon", input: "field",
    select: "dropdown", textarea: "text box", video: "video", audio: "audio", form: "form",
    ul: "list", ol: "list", li: "list item", table: "table", tr: "row", td: "cell",
    nav: "navigation", header: "header", footer: "footer", aside: "sidebar", section: "section",
    h1: "heading", h2: "heading", h3: "heading", h4: "heading", h5: "heading", h6: "heading",
    p: "paragraph", canvas: "canvas", iframe: "embedded frame" };
  const labelFor = (el) => {
    const text = (el.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 40);
    if (text) return text;
    // No visible words: whatever the page tells assistive tech is the next best
    // human name, and it is what a screen reader would say out loud.
    const attr = ["aria-label", "alt", "placeholder", "title", "value", "name"]
      .map((a) => (el.getAttribute(a) || "").trim())
      .find(Boolean);
    if (attr) return attr.slice(0, 40);
    return KINDS[el.tagName.toLowerCase()] || "element";
  };

  window.__hvPickerPromise = new Promise((resolve) => {
    let current = null;
    const move = (e) => {
      const el = e.target;
      if (!el || el.nodeType !== 1) return;
      current = el;
      const r = el.getBoundingClientRect();
      HL.style.top = r.top + "px";
      HL.style.left = r.left + "px";
      HL.style.width = r.width + "px";
      HL.style.height = r.height + "px";
    };
    const finish = (value) => {
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      HL.remove();
      window.__hvPickerActive = false;
      window.__hvPickerCancel = undefined;
      resolve(value);
    };
    const click = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = current || e.target;
      const box = el.getBoundingClientRect();
      finish(JSON.stringify({
        selector: selectorFor(el),
        outerHTML: (el.outerHTML || "").slice(0, ${MAX_OUTER_HTML * 2}),
        label: labelFor(el),
        rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      }));
    };
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); finish("null"); } };
    // Cancelling from OUR chrome (the Cancel button) needs a handle in here.
    window.__hvPickerCancel = () => finish("null");
    document.addEventListener("mousemove", move, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
  });
  return window.__hvPickerPromise;
})()`;

/** Cancel a picker installed by PICKER_SCRIPT. Safe to run when none is active. */
export const PICKER_CANCEL_SCRIPT = `(() => { if (window.__hvPickerCancel) window.__hvPickerCancel(); return "null"; })()`;

/** Parse what the injected script resolved with. Never throws on page garbage. */
export function parsePicked(raw: unknown): PickedElement | null {
  if (typeof raw !== "string" || !raw || raw === "null") return null;
  try {
    const p = JSON.parse(raw) as Partial<PickedElement>;
    if (!p || typeof p.selector !== "string" || typeof p.outerHTML !== "string") return null;
    // The rect is page-controlled like everything else here, so it is accepted
    // only when every field is a finite number — a NaN would place the popup
    // somewhere unreachable rather than fall back to centred.
    const r = p.rect as Record<string, unknown> | undefined;
    const rect =
      r && ["x", "y", "width", "height"].every((k) => typeof r[k] === "number" && Number.isFinite(r[k] as number))
        ? { x: r.x as number, y: r.y as number, width: r.width as number, height: r.height as number }
        : undefined;
    return {
      selector: p.selector,
      outerHTML: trimOuterHtml(p.outerHTML),
      // Falling back to the selector would reintroduce exactly what the label is
      // for avoiding — a path means nothing to the person who clicked a button.
      label: typeof p.label === "string" && p.label ? p.label.slice(0, 120) : "element",
      ...(rect ? { rect } : {}),
    };
  } catch {
    return null;
  }
}
