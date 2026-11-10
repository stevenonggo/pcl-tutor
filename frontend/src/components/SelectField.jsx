import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon } from './icons';

// A native <select> cannot be themed: the browser paints its own popup, so on a dark
// or branded page it opens as an oversized white list that ignores every design token and
// overflows the viewport on a phone. This renders the same control as a button group
// instead, so the options are ordinary DOM that inherits the app's surface, line and
// accent tokens and can never overflow.
//
// Both variants expose the selection as role="radiogroup"/role="radio" with
// aria-checked, which is the pattern the visual design implies: one of a set is active.
// The caller only has to hand over the same value it used to put in <option value>.

// Chips suit a short, scannable set. A dropdown suits a long one, where a wrapping grid
// would push the rest of the form off screen.
//
// A field with nothing selected yet is never chips: chips can only show what is chosen,
// so an empty value would render as a row of unselected buttons and silently drop the
// placeholder that tells the user they still have to pick something. The panel can show
// the placeholder, so anything unselected uses it.
const chipFriendly = (items, value) => (
  items.length <= 4
  && items.every((item) => item.label.length <= 18)
  && items.some((item) => item.value === value)
);

const normalise = (options) => options.map((item) => (
  typeof item === 'string' ? { value: item, label: item } : item
));

export default function SelectField({
  label,
  value,
  onChange,
  options,
  variant = 'auto',
  placeholder = 'Select an option',
  disabled = false,
  className = '',
}) {
  const items = useMemo(() => normalise(options), [options]);
  const baseId = useId();
  const groupId = `${baseId}-group`;
  const labelId = `${baseId}-label`;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const triggerRef = useRef(null);
  const selected = items.find((item) => item.value === value);
  // Forced even when the caller asked for chips: a chip row cannot render a placeholder,
  // so an unselected field would look like a row of nothing-selected buttons.
  const hasChoice = items.some((item) => item.value === value);
  const asChips = hasChoice && (variant === 'chips' || (variant === 'auto' && chipFriendly(items, value)));

  // The panel is the only thing that should react to clicks outside, and a stray Escape
  // must never reach the page underneath and start something else.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  // Opening the panel should land on the current choice, so arrowing from the trigger
  // starts somewhere meaningful rather than at the top of the list.
  useEffect(() => {
    if (!open || asChips) return;
    const target = listRef.current?.querySelector('[aria-checked="true"]') || listRef.current;
    target?.focus();
  }, [open, asChips]);

  const choose = (next) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveFocus = (event, index) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (!items.length) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const start = index < 0 ? (step === 1 ? -1 : 0) : index;
    const next = items[(start + step + items.length) % items.length];
    listRef.current?.querySelector(`#${CSS.escape(`${groupId}-${next.value}`)}`)?.focus();
  };

  const trigger = (item) => (
    <button
      key={item.value}
      id={`${groupId}-${item.value}`}
      type="button"
      role="radio"
      aria-checked={item.value === value}
      className={`select-chip ${item.value === value ? 'selected' : ''}`}
      onClick={() => onChange(item.value)}
      disabled={disabled}
    >
      {item.label}
    </button>
  );

  return (
    <div className={`select-field ${asChips ? 'is-chips' : 'is-dropdown'} ${className}`.trim()} ref={wrapRef}>
      <span className="field-label" id={labelId}>{label}</span>

      {asChips ? (
        <div
          className="select-chip-row"
          role="radiogroup"
          aria-labelledby={labelId}
          aria-label={label}
          aria-disabled={disabled || undefined}
        >
          {items.map(trigger)}
        </div>
      ) : (
        <>
          <button
            type="button"
            ref={triggerRef}
            className={`select-trigger ${open ? 'open' : ''} ${selected ? '' : 'empty'}`}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={groupId}
            aria-labelledby={`${labelId} ${groupId}-value`}
            onClick={() => setOpen((state) => !state)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              event.preventDefault();
              setOpen(true);
            }}
            disabled={disabled}
          >
            <span id={`${groupId}-value`}>{selected ? selected.label : placeholder}</span>
            <Icon name="chevron" size={15} />
          </button>

          {open && (
            <div
              className="select-panel"
              id={groupId}
              role="radiogroup"
              aria-labelledby={labelId}
              aria-label={label}
              ref={listRef}
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === 'Home' || event.key === 'End') {
                  event.preventDefault();
                  if (!items.length) return;
                  const edge = event.key === 'Home' ? items[0] : items[items.length - 1];
                  listRef.current?.querySelector(`#${CSS.escape(`${groupId}-${edge.value}`)}`)?.focus();
                  return;
                }
                if (event.target === event.currentTarget) moveFocus(event, -1);
              }}
            >
              {items.map((item) => (
                <button
                  key={item.value}
                  id={`${groupId}-${item.value}`}
                  type="button"
                  role="radio"
                  aria-checked={item.value === value}
                  className={`select-option ${item.value === value ? 'selected' : ''}`}
                  onClick={() => choose(item.value)}
                  onKeyDown={(event) => moveFocus(event, items.indexOf(item))}
                  disabled={disabled}
                >
                  {item.label}
                  {item.value === value && <Icon name="check" size={14} />}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
