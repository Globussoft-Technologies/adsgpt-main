import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

// Search box with the icon inside. Calls onSearch with the trimmed text a
// moment after typing stops (or right away on Enter / clear), so there is no
// separate Search button.
export default function SearchInput({ value = "", onSearch, placeholder = "Search", delay = 400, className = "" }) {
  const [text, setText] = useState(value);
  const last = useRef(value);

  // Follow outside resets (e.g. a "Clear filters" button).
  useEffect(() => {
    setText(value);
    last.current = value;
  }, [value]);

  const fire = (next) => {
    const t = next.trim();
    if (t === last.current) return;
    last.current = t;
    onSearch(t);
  };

  useEffect(() => {
    const id = setTimeout(() => fire(text), delay);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && fire(text)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-8 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
      />
      {text ? (
        <button
          type="button"
          onClick={() => { setText(""); fire(""); }}
          title="Clear"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
