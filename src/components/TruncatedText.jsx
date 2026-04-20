// Reusable truncation-with-instant-tooltip primitive.
//
// Why not native `title=`?  The browser enforces a ~1.5s delay before showing
// the built-in tooltip, and the delay makes tables feel broken — you scan
// rows faster than the tooltip can appear, so you never see full names.
//
// This component renders a tiny portal-less tooltip via `position: fixed`
// that appears instantly on hover/focus. Works in any table cell or inline
// text — swap `element` to "td" / "span" / whatever.
import { useState, useRef, useEffect } from "react";

export default function TruncatedText({
  text,
  limit = 20,
  element: Element = "span",
  style,
  className,
  tooltipMaxWidth = 400,
  ...rest
}) {
  const [hovered, setHovered] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const wrapRef = useRef(null);

  const raw = text == null ? "" : String(text);
  const needsTruncation = raw.length > limit;
  const display = needsTruncation ? raw.slice(0, limit) + "…" : (raw || "—");

  useEffect(() => {
    if (hovered && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      setCoords({ top: rect.top - 6, left: rect.left });
    }
  }, [hovered]);

  return (
    <Element
      ref={wrapRef}
      className={className}
      style={{ position: "relative", ...style }}
      onMouseEnter={() => needsTruncation && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => needsTruncation && setHovered(true)}
      onBlur={() => setHovered(false)}
      {...rest}
    >
      {display}
      {hovered && needsTruncation && (
        <span
          role="tooltip"
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            transform: "translateY(-100%)",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            boxShadow: "var(--shadow-sm)",
            padding: "6px 10px",
            fontSize: 12,
            color: "var(--text)",
            whiteSpace: "nowrap",
            maxWidth: tooltipMaxWidth,
            zIndex: 1000,
            pointerEvents: "none",
            fontFamily: "var(--font-mono)",
          }}
        >
          {raw}
        </span>
      )}
    </Element>
  );
}
