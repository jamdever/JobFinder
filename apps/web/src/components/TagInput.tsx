"use client";

import { useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

export function TagInput({
  label,
  hint,
  tags,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");
  const inputId = useId();
  const skipBlurAddRef = useRef(false);

  function addTag(raw: string) {
    const value = raw.trim();
    if (!value) return;
    const exists = tags.some((t) => t.toLowerCase() === value.toLowerCase());
    if (!exists) onChange([...tags, value]);
    setInput("");
  }

  function removeTag(index: number, e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    skipBlurAddRef.current = true;
    onChange(tags.filter((_, i) => i !== index));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && !input && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  function onInputBlur() {
    if (skipBlurAddRef.current) {
      skipBlurAddRef.current = false;
      return;
    }
    if (input.trim()) addTag(input);
  }

  return (
    <div className="block">
      <label htmlFor={inputId} className="text-sm font-medium text-gray-300">
        {label}
      </label>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
      <div className="mt-2 flex min-h-[44px] flex-wrap gap-2 rounded-lg border border-ink-800 bg-ink-950 px-2 py-2 focus-within:border-accent">
        {tags.map((tag, index) => (
          <span
            key={`${index}-${tag}`}
            className="inline-flex items-center gap-1 rounded-md bg-ink-800 px-2 py-1 text-sm text-gray-200"
          >
            {tag}
            <button
              type="button"
              className="text-gray-500 hover:text-white"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => removeTag(index, e)}
              aria-label={`Remove ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={inputId}
          className="min-w-[120px] flex-1 bg-transparent px-1 py-1 text-sm text-white outline-none placeholder:text-gray-600"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onInputBlur}
          placeholder={tags.length === 0 ? placeholder : "Add more..."}
        />
      </div>
    </div>
  );
}
