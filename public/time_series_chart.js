/* time_series_chart.js — single reusable line chart for MacroTilt.
 *
 * Joe directive 2026-05-11: "Every composite, sub-composite, and indicator
 * should have a detailed chart - selectable timeframe, crosshairs, etc.
 * Just like every stock chart."
 *
 * Mounts a chart into any container element:
 *
 *   MacroTilt.TimeSeriesChart.mount(container, {
 *     points: [["2010-01-01", 48.04], ...],
 *     unit: "score",          // tooltip suffix ("$", "%", "bps", "score", "")
 *     decimals: 1,            // value decimals in tooltip
 *     domain: "auto",         // [min, max] or "auto" or "score"  (score = 0..100)
 *     bands: [                // optional horizontal shaded zones
 *       {y0: 0,  y1: 25,  color: "rgba(46,125,50,0.06)"},  // risk-on
 *       {y0: 75, y1: 100, color: "rgba(176,48,48,0.06)"},  // risk-off
 *     ],
 *     timeframes: ["1M","3M","6M","1Y","3Y","5Y","10Y","MAX"],
 *     defaultTimeframe: "5Y",
 *     theme: "auto",          // "light" | "dark" | "auto" (auto reads data-theme)
 *     accent: "var(--ink-2, #0e5560)",
 *   });
 *
 * Public API:
 *   - mount(container, opts) -> instance with .destroy()
 *
 * No external dependencies. SVG-rendered. Works in iframes.
 */
(function (root) {
  "use strict";

  const FALLBACK_TIMEFRAMES = ["1M", "3M", "6M", "1Y", "3Y", "5Y", "10Y", "MAX"];

  // Approximate days-per-timeframe — used to filter the input series.
  const TF_DAYS = {
    "1M":  31,
    "3M":  92,
    "6M":  183,
    "1Y":  366,
    "3Y":  1097,
    "5Y":  1828,
    "10Y": 3653,
    "MAX": Infinity,
  };

  function parseDate(s) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function filterByTimeframe(points, tf) {
    if (!points || !points.length) return [];
    if (tf === "MAX" || !TF_DAYS[tf]) return points.slice();
    const last = parseDate(points[points.length - 1][0]);
    if (!last) return points.slice();
    const cutoff = new Date(last.getTime() - TF_DAYS[tf] * 86400000);
    return points.filter(p => parseDate(p[0]) >= cutoff);
  }

  function niceTick(span, n) {
    if (span <= 0) return 1;
    const raw = span / n;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / pow;
    let nice;
    if (norm < 1.5) nice = 1;
    else if (norm < 3) nice = 2;
    else if (norm < 7) nice = 5;
    else nice = 10;
    return nice * pow;
  }

  function fmtNum(v, decimals) {
    if (v === null || v === undefined || isNaN(v)) return "—";
    const dec = decimals == null ? 1 : decimals;
    return Number(v).toLocaleString(undefined, {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    });
  }

  function fmtDate(d) {
    if (!d) return "";
    const yr = d.getFullYear();
    const mo = d.toLocaleString(undefined, { month: "short" });
    const dy = d.getDate();
    return `${mo} ${dy}, ${yr}`;
  }

  function mount(container, opts) {
    if (!container || typeof container.appendChild !== "function") {
      throw new Error("TimeSeriesChart.mount: container must be a DOM element");
    }
    opts = opts || {};
    const rawPoints = (opts.points || []).filter(p =>
      Array.isArray(p) && p.length >= 2 && p[1] != null && !isNaN(Number(p[1]))
    );
    const timeframes = opts.timeframes || FALLBACK_TIMEFRAMES;
    const defaultTf = opts.defaultTimeframe || (timeframes.includes("5Y") ? "5Y" : timeframes[timeframes.length - 1]);
    const unit = opts.unit || "";
    const decimals = opts.decimals == null ? 1 : opts.decimals;
    const accent = opts.accent || "var(--ink-2, #0e5560)";
    const bands = opts.bands || null;
    const domainOpt = opts.domain || "auto";

    // ── DOM scaffold ────────────────────────────────────────────────
    container.innerHTML = "";
    const root = document.createElement("div");
    root.className = "mt-tsc";
    root.style.cssText = "font-family:var(--ui,sans-serif); color:var(--ink,#1a1a1a);";

    const toolbar = document.createElement("div");
    toolbar.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:8px; flex-wrap:wrap;";
    const tfWrap = document.createElement("div");
    tfWrap.style.cssText = "display:flex; gap:4px; flex-wrap:wrap;";
    const readout = document.createElement("div");
    readout.style.cssText = "font-family:var(--mono,monospace); font-size:11px; color:var(--muted,#666); letter-spacing:0.04em; min-height:16px; text-align:right; min-width:180px;";
    toolbar.appendChild(tfWrap);
    toolbar.appendChild(readout);

    const svgNS = "http://www.w3.org/2000/svg";
    const W = 760, H = 280;
    const PAD_L = 44, PAD_R = 12, PAD_T = 10, PAD_B = 26;
    const innerW = W - PAD_L - PAD_R;
    const innerH = H - PAD_T - PAD_B;

    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.cssText = "width:100%; height:auto; display:block; cursor:crosshair;";
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Time series chart");

    root.appendChild(toolbar);
    root.appendChild(svg);
    container.appendChild(root);

    // ── timeframe pills ────────────────────────────────────────────
    let currentTf = defaultTf;
    const pillButtons = [];
    timeframes.forEach(tf => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = tf;
      btn.dataset.tf = tf;
      btn.style.cssText = "background:transparent; border:0.5px solid var(--border,rgba(0,0,0,0.15)); color:var(--ink,#1a1a1a); padding:4px 10px; font-family:var(--mono,monospace); font-size:10.5px; font-weight:600; letter-spacing:0.06em; border-radius:3px; cursor:pointer; transition:all 0.1s;";
      btn.addEventListener("click", () => setTimeframe(tf));
      btn.addEventListener("mouseenter", () => { if (btn.dataset.tf !== currentTf) btn.style.background = "rgba(14,85,96,0.06)"; });
      btn.addEventListener("mouseleave", () => { if (btn.dataset.tf !== currentTf) btn.style.background = "transparent"; });
      tfWrap.appendChild(btn);
      pillButtons.push(btn);
    });

    function refreshPills() {
      pillButtons.forEach(b => {
        if (b.dataset.tf === currentTf) {
          b.style.background = accent;
          b.style.color = "#fff";
          b.style.borderColor = accent;
        } else {
          b.style.background = "transparent";
          b.style.color = "var(--ink,#1a1a1a)";
          b.style.borderColor = "var(--border,rgba(0,0,0,0.15))";
        }
      });
    }

    // ── render ──────────────────────────────────────────────────────
    let scaledX = [], scaledY = [], windowedPoints = [];

    function render() {
      windowedPoints = filterByTimeframe(rawPoints, currentTf);
      svg.innerHTML = "";
      if (!windowedPoints.length) {
        const t = document.createElementNS(svgNS, "text");
        t.setAttribute("x", W / 2);
        t.setAttribute("y", H / 2);
        t.setAttribute("text-anchor", "middle");
        t.setAttribute("font-family", "var(--mono,monospace)");
        t.setAttribute("font-size", "12");
        t.setAttribute("fill", "var(--muted,#666)");
        t.textContent = "no data in this window";
        svg.appendChild(t);
        readout.textContent = "";
        return;
      }

      const xs = windowedPoints.map(p => parseDate(p[0]).getTime());
      const ys = windowedPoints.map(p => Number(p[1]));
      const xMin = xs[0], xMax = xs[xs.length - 1];

      let yMin, yMax;
      if (domainOpt === "score") {
        yMin = 0; yMax = 100;
      } else if (Array.isArray(domainOpt)) {
        yMin = domainOpt[0]; yMax = domainOpt[1];
      } else {
        const dataMin = Math.min(...ys), dataMax = Math.max(...ys);
        const pad = (dataMax - dataMin) * 0.08 || Math.abs(dataMin) * 0.05 || 1;
        yMin = dataMin - pad;
        yMax = dataMax + pad;
      }

      const X = t => PAD_L + ((t - xMin) / Math.max(1, xMax - xMin)) * innerW;
      const Y = v => PAD_T + (1 - (v - yMin) / Math.max(0.0001, yMax - yMin)) * innerH;

      scaledX = xs.map(X);
      scaledY = ys.map(Y);

      // bands
      if (bands && (domainOpt === "score" || Array.isArray(domainOpt))) {
        bands.forEach(b => {
          const y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
          const yA = Y(y1), yB = Y(y0);
          const r = document.createElementNS(svgNS, "rect");
          r.setAttribute("x", PAD_L);
          r.setAttribute("y", yA);
          r.setAttribute("width", innerW);
          r.setAttribute("height", Math.max(1, yB - yA));
          r.setAttribute("fill", b.color || "rgba(0,0,0,0.04)");
          svg.appendChild(r);
        });
      }

      // y gridlines + labels
      const yTick = niceTick(yMax - yMin, 5);
      const yStart = Math.ceil(yMin / yTick) * yTick;
      for (let v = yStart; v <= yMax + 0.0001; v += yTick) {
        const y = Y(v);
        const line = document.createElementNS(svgNS, "line");
        line.setAttribute("x1", PAD_L);
        line.setAttribute("x2", W - PAD_R);
        line.setAttribute("y1", y);
        line.setAttribute("y2", y);
        line.setAttribute("stroke", "var(--border,rgba(0,0,0,0.08))");
        line.setAttribute("stroke-width", "0.5");
        line.setAttribute("stroke-dasharray", "2 3");
        svg.appendChild(line);

        const lbl = document.createElementNS(svgNS, "text");
        lbl.setAttribute("x", PAD_L - 6);
        lbl.setAttribute("y", y + 3);
        lbl.setAttribute("text-anchor", "end");
        lbl.setAttribute("font-family", "var(--mono,monospace)");
        lbl.setAttribute("font-size", "10");
        lbl.setAttribute("fill", "var(--muted,#666)");
        lbl.textContent = fmtNum(v, Math.max(0, decimals - 1));
        svg.appendChild(lbl);
      }

      // x labels — ~5 evenly spaced
      const xLabels = 5;
      for (let i = 0; i <= xLabels; i++) {
        const t = xMin + (xMax - xMin) * (i / xLabels);
        const d = new Date(t);
        const x = X(t);
        const lbl = document.createElementNS(svgNS, "text");
        lbl.setAttribute("x", x);
        lbl.setAttribute("y", H - 8);
        lbl.setAttribute("text-anchor", "middle");
        lbl.setAttribute("font-family", "var(--mono,monospace)");
        lbl.setAttribute("font-size", "10");
        lbl.setAttribute("fill", "var(--muted,#666)");
        const span = xMax - xMin;
        if (span > 366 * 86400000 * 3) {
          lbl.textContent = String(d.getFullYear());
        } else if (span > 86400000 * 60) {
          lbl.textContent = d.toLocaleString(undefined, { month: "short", year: "2-digit" });
        } else {
          lbl.textContent = d.toLocaleString(undefined, { month: "short", day: "numeric" });
        }
        svg.appendChild(lbl);
      }

      // line
      const pathD = ys.map((v, i) => `${i === 0 ? "M" : "L"}${scaledX[i].toFixed(2)},${scaledY[i].toFixed(2)}`).join(" ");
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", pathD);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", accent);
      path.setAttribute("stroke-width", "1.5");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("stroke-linecap", "round");
      svg.appendChild(path);

      // crosshair group (hidden until mouseover)
      const cross = document.createElementNS(svgNS, "g");
      cross.setAttribute("id", "mt-tsc-cross");
      cross.style.display = "none";
      const vline = document.createElementNS(svgNS, "line");
      vline.setAttribute("y1", PAD_T);
      vline.setAttribute("y2", PAD_T + innerH);
      vline.setAttribute("stroke", "var(--ink,#1a1a1a)");
      vline.setAttribute("stroke-width", "0.5");
      vline.setAttribute("stroke-dasharray", "3 3");
      const dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("r", "4");
      dot.setAttribute("fill", "#fff");
      dot.setAttribute("stroke", accent);
      dot.setAttribute("stroke-width", "1.5");
      cross.appendChild(vline);
      cross.appendChild(dot);
      svg.appendChild(cross);

      readout.textContent = `Range  ${fmtDate(new Date(xMin))} — ${fmtDate(new Date(xMax))}`;

      // hover
      svg.onmousemove = (e) => {
        const r = svg.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * W;
        if (px < PAD_L || px > W - PAD_R) {
          cross.style.display = "none";
          readout.textContent = `Range  ${fmtDate(new Date(xMin))} — ${fmtDate(new Date(xMax))}`;
          return;
        }
        // find nearest point by x
        let nearest = 0, bestDist = Infinity;
        for (let i = 0; i < scaledX.length; i++) {
          const d = Math.abs(scaledX[i] - px);
          if (d < bestDist) { bestDist = d; nearest = i; }
        }
        const x = scaledX[nearest], y = scaledY[nearest];
        vline.setAttribute("x1", x);
        vline.setAttribute("x2", x);
        dot.setAttribute("cx", x);
        dot.setAttribute("cy", y);
        cross.style.display = "";
        const dStr = fmtDate(new Date(xs[nearest]));
        const vStr = fmtNum(ys[nearest], decimals);
        readout.textContent = `${dStr}  ·  ${vStr}${unit ? " " + unit : ""}`;
      };
      svg.onmouseleave = () => {
        cross.style.display = "none";
        readout.textContent = `Range  ${fmtDate(new Date(xMin))} — ${fmtDate(new Date(xMax))}`;
      };
    }

    function setTimeframe(tf) {
      if (currentTf === tf) return;
      currentTf = tf;
      refreshPills();
      render();
    }

    refreshPills();
    render();

    return {
      destroy() { container.innerHTML = ""; },
      setTimeframe,
      setData(newPoints) {
        rawPoints.length = 0;
        (newPoints || []).forEach(p => {
          if (Array.isArray(p) && p.length >= 2 && p[1] != null && !isNaN(Number(p[1]))) {
            rawPoints.push(p);
          }
        });
        render();
      },
    };
  }

  root.MacroTilt = root.MacroTilt || {};
  root.MacroTilt.TimeSeriesChart = { mount };
}(typeof window !== "undefined" ? window : globalThis));
