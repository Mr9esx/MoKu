import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import "./select.css";

export type SelectOption = { value: string; label: string; disabled?: boolean };
type Props = Omit<ComponentProps<"button">, "value" | "onChange" | "children"> & {
  value: string; options: SelectOption[]; onChange: (value: string) => void;
};

export function Select({ value, options, onChange, className, disabled, onKeyDown, ...props }: Props) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const search = useRef({ text: "", time: 0 });
  const selected = options.findIndex(option => option.value === value);
  const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
  const show = () => { setActive(enabled.includes(selected) ? selected : enabled[0] ?? -1); setOpen(true); };
  const choose = (index: number) => {
    if (!options[index] || options[index].disabled) return;
    setOpen(false); trigger.current?.focus(); onChange(options[index].value);
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current;
      if (!anchor?.isConnected) { setOpen(false); return; }
      const box = anchor.getBoundingClientRect(), edge = 8, gap = 4;
      if (box.bottom <= 0 || box.top >= innerHeight) { setOpen(false); return; }
      for (let parent = anchor.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (!/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowY)) continue;
        const clip = parent.getBoundingClientRect();
        if (box.bottom <= clip.top || box.top >= clip.bottom) { setOpen(false); return; }
      }
      const below = innerHeight - box.bottom - gap - edge, above = box.top - gap - edge;
      const flip = below < Math.min(280, options.length * 36 + 10) && above > below;
      const width = Math.min(Math.max(box.width, 168), innerWidth - edge * 2);
      setPosition({ position: "fixed", left: Math.max(edge, Math.min(box.left, innerWidth - width - edge)), width,
        maxHeight: Math.max(36, Math.min(320, flip ? above : below)),
        ...(flip ? { bottom: innerHeight - box.top + gap } : { top: box.bottom + gap }) });
    };
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    place();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open, options.length]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => { if (open) menu.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [open, active]);
  return <span className={`ui-select${className ? ` ${className}` : ""}`}>
    <button {...props} ref={trigger} type="button" className="ui-select-trigger" disabled={disabled} role="combobox"
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      onClick={() => open ? setOpen(false) : show()}
      onBlur={event => { props.onBlur?.(event); if (!menu.current?.contains(event.relatedTarget as Node)) setOpen(false); }}
      onKeyDown={event => {
        onKeyDown?.(event); if (event.defaultPrevented) return;
        const key = event.key;
        if (key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
        if (key === "Tab") { setOpen(false); return; }
        if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(key)) {
          event.preventDefault(); event.stopPropagation();
          if (!open) { show(); if (key === "Home") setActive(enabled[0] ?? -1); if (key === "End") setActive(enabled.at(-1) ?? -1); return; }
          if (key === "Enter" || key === " ") { choose(active); return; }
          const index = enabled.indexOf(active), step = key === "ArrowUp" ? -1 : 1;
          setActive(key === "Home" ? enabled[0] ?? -1 : key === "End" ? enabled.at(-1) ?? -1 : enabled[(index + step + enabled.length) % enabled.length] ?? -1);
        } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault(); event.stopPropagation();
          const now = Date.now(); search.current = { text: now - search.current.time < 600 ? search.current.text + key : key, time: now };
          const match = enabled.find(index => options[index].label.toLowerCase().startsWith(search.current.text.toLowerCase()));
          if (!open) show(); if (match !== undefined) setActive(match);
        }
      }}><span data-tooltip-overflow={options[selected]?.label}>{options[selected]?.label ?? "请选择"}</span><ChevronDown size={16} aria-hidden="true" /></button>
    {open && createPortal(<div ref={menu} id={listId} className="ui-select-menu" role="listbox" aria-label={props["aria-label"]} style={position}>
      {options.map((option, index) => <button key={option.value} id={`${listId}-${index}`} data-index={index} type="button" role="option" tabIndex={-1}
        aria-selected={index === selected} aria-disabled={option.disabled || undefined} disabled={option.disabled}
        className={`ui-select-option${index === active ? " is-active" : ""}`} onPointerDown={event => event.preventDefault()}
        onPointerMove={() => !option.disabled && setActive(index)} onClick={() => choose(index)}>
        <span>{option.label}</span>{index === selected && <Check size={14} aria-hidden="true" />}
      </button>)}
    </div>, document.body)}
  </span>;
}
