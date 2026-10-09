import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

type Tip = { anchor: HTMLElement; text: string };
const selector = "[data-tooltip], [data-tooltip-overflow], button, summary";
const overflows = (element: HTMLElement) =>
  element.scrollWidth > element.clientWidth + 1 ||
  element.scrollHeight > element.clientHeight + 1;

function resolveTip(target: EventTarget | null): Tip | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest<HTMLElement>(selector);
  if (!anchor) return null;
  if (anchor.hasAttribute("data-tooltip-collapsed") &&
      anchor.closest("details")?.open) return null;
  if (anchor.hasAttribute("data-tooltip-overflow")) {
    return overflows(anchor)
      ? { anchor, text: anchor.dataset.tooltipOverflow || anchor.innerText.trim() }
      : null;
  }
  const text = anchor.dataset.tooltip ||
    (anchor.tagName === "BUTTON" && !anchor.innerText.trim()
      ? anchor.getAttribute("aria-label")
      : null);
  if (text) return { anchor, text };
  // A resource row can receive keyboard focus on behalf of clipped text.
  const clipped = Array.from(
    anchor.querySelectorAll<HTMLElement>("[data-tooltip-overflow]"),
  ).find(overflows);
  return clipped
    ? { anchor: clipped, text: clipped.dataset.tooltipOverflow || clipped.innerText.trim() }
    : null;
}

export function TooltipLayer() {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0, above: false, arrow: 16 });

  useEffect(() => {
    let pending: Tip | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hide = () => {
      clearTimeout(timer);
      pending = null;
      setTip(null);
    };
    const show = (next: Tip | null) => {
      if (pending?.anchor === next?.anchor && pending?.text === next?.text) return;
      hide();
      if (!next?.text) return;
      pending = next;
      timer = setTimeout(() => {
        if (next.anchor.isConnected &&
            !(next.anchor.hasAttribute("data-tooltip-collapsed") &&
              next.anchor.closest("details")?.open)) setTip(next);
      }, 250);
    };
    const pointerOver = (event: PointerEvent) => {
      if (event.pointerType !== "touch") show(resolveTip(event.target));
    };
    const pointerOut = (event: PointerEvent) => {
      if (pending?.anchor.contains(event.relatedTarget as Node | null)) return;
      hide();
    };
    const focusIn = (event: FocusEvent) => show(resolveTip(event.target));
    const focusOut = () => {
      if (!pending?.anchor.matches(":hover")) hide();
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element &&
          event.target.closest("button:not(:disabled), summary, a, input, select, textarea")) hide();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("pointerover", pointerOver, true);
    document.addEventListener("pointerout", pointerOut, true);
    document.addEventListener("focusin", focusIn, true);
    document.addEventListener("focusout", focusOut, true);
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("keydown", keyDown, true);
    document.addEventListener("toggle", hide, true);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerover", pointerOver, true);
      document.removeEventListener("pointerout", pointerOut, true);
      document.removeEventListener("focusin", focusIn, true);
      document.removeEventListener("focusout", focusOut, true);
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("keydown", keyDown, true);
      document.removeEventListener("toggle", hide, true);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tip || !box.current) return;
    const anchor = tip.anchor.getBoundingClientRect();
    const { width, height } = box.current.getBoundingClientRect();
    const center = anchor.x + anchor.width / 2;
    const x = Math.max(12, Math.min(center - width / 2, window.innerWidth - width - 12));
    const above = anchor.bottom + height + 8 > window.innerHeight - 12;
    const y = Math.max(12, Math.min(
      above ? anchor.top - height - 8 : anchor.bottom + 8,
      window.innerHeight - height - 12,
    ));
    setPosition({ x, y, above, arrow: Math.max(12, Math.min(width - 12, center - x)) });
    const describedBy = tip.anchor.getAttribute("aria-describedby");
    tip.anchor.setAttribute("aria-describedby", [describedBy, id].filter(Boolean).join(" "));
    return () => {
      const remaining = (tip.anchor.getAttribute("aria-describedby") || "")
        .split(/\s+/).filter((value) => value && value !== id).join(" ");
      if (remaining) tip.anchor.setAttribute("aria-describedby", remaining);
      else tip.anchor.removeAttribute("aria-describedby");
    };
  }, [tip, id]);

  return tip && createPortal(
    <div
      ref={box}
      id={id}
      role="tooltip"
      className="workbench-tooltip"
      data-above={position.above}
      style={{ left: position.x, top: position.y, "--tooltip-arrow": `${position.arrow}px` } as CSSProperties}
    >{tip.text}</div>,
    document.body,
  );
}
