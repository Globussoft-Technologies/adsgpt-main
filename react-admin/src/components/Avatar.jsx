function hashHue(str = "") {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function initials(name = "", fallback = "?") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-base",
  xl: "h-20 w-20 text-xl",
};

export default function Avatar({ name, seed, size = "md", className = "" }) {
  const hue = hashHue(seed || name || "");
  const bg = `linear-gradient(135deg, hsl(${hue} 75% 60%), hsl(${(hue + 50) % 360} 75% 50%))`;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold text-white shadow-sm ring-1 ring-black/5 ${SIZES[size]} ${className}`}
      style={{ background: bg }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
