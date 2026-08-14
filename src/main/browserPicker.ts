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

  const labelFor = (el) => {
    const id = el.id ? "#" + el.id : "";
    const cls = (el.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean).slice(0, 2).map((c) => "." + c).join("");
    const text = (el.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 40);
    return "<" + el.tagName.toLowerCase() + id + cls + ">" + (text ? " " + text : "");
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
      finish(JSON.stringify({
        selector: selectorFor(el),
        outerHTML: (el.outerHTML || "").slice(0, ${MAX_OUTER_HTML * 2}),
        label: labelFor(el),
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
    return {
      selector: p.selector,
      outerHTML: trimOuterHtml(p.outerHTML),
      label: typeof p.label === "string" && p.label ? p.label.slice(0, 120) : p.selector,
    };
  } catch {
    return null;
  }
}
