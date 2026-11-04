import { useEffect, useId, useMemo, useRef, useState } from "react";
import { professionalKey } from "./model.ts";
import { matchesAll } from "./search.ts";

export type ComboOption = { value: string; hint?: string };

/**
 * Campo con autocompletado: al escribir muestra las coincidencias (por cualquier parte del
 * nombre) y se elige con clic o con ↑ ↓ Enter. Acepta texto libre; `onPick` avisa cuando se
 * elige una opción de la lista.
 */
export function Combo({
  value,
  onChange,
  onPick,
  options,
  placeholder,
  required,
  maxLength,
  label,
  limit = 8,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick?: (o: ComboOption) => void;
  options: ComboOption[];
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  label?: string;
  limit?: number;
  disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const q = value.trim();
    const list = q
      ? options.filter((o) => matchesAll(o.value + " " + (o.hint || ""), q))
      : options;
    return list.slice(0, limit);
  }, [options, value, limit]);
  useEffect(() => setActive(0), [value]);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);
  const pick = (o: ComboOption) => {
    onChange(o.value);
    onPick?.(o);
    setOpen(false);
  };
  const exact = shown.length === 1 && professionalKey(shown[0].value) === professionalKey(value);
  return (
    <div className="combo" ref={box}>
      <input
        value={value}
        required={required}
        maxLength={maxLength}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-expanded={open && shown.length > 0 && !exact}
        aria-controls={id}
        aria-autocomplete="list"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && shown[active] && !exact) {
            e.preventDefault();
            pick(shown[active]);
          } else if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && shown.length > 0 && !exact && (
        <ul id={id} role="listbox" className="combo-list">
          {shown.map((o, i) => (
            <li
              key={o.value + i}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <strong>{o.value}</strong>
              {o.hint && <small>{o.hint}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
