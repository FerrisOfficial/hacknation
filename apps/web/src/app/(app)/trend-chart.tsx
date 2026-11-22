"use client";

import type { AnalysisModule } from "@app/db";
import { useEffect, useRef, useState } from "react";
import { ANALYSIS_MODULES } from "@/lib/analysis/modules";
import { MODULE_NAME, MODULE_SHORT } from "@/lib/client/format";
import type { TrendPoint } from "@/lib/incidents/contract";

// Linie rozróżnia wzór (ciągła, kreskowana, kropkowana), nie kolor: wykres jest czytelny
// w skali szarości (R6, R12). Etykieta „M1 · 12” na końcu linii zastępuje legendę w kolorze.
const DASH: Record<AnalysisModule, string | undefined> = {
  finfluencer: undefined,
  risk_disclosure: "6 4",
  unauthorized_advisory: "2 3",
};
const STROKE: Record<AnalysisModule, string> = {
  finfluencer: "var(--color-ink-900)",
  risk_disclosure: "var(--color-ink-600)",
  unauthorized_advisory: "var(--color-ink-500)",
};

const HEIGHT = 240;
const PAD = { top: 16, right: 72, bottom: 28, left: 36 };

// „2026-11-22” → „22.11”, „2026-11-22T14:35” (koszyki minutowe) → „14:35”.
function axisLabel(date: string): string {
  return date.length > 10 ? date.slice(11, 16) : `${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

function niceMax(value: number): number {
  if (value <= 5) return 5;
  if (value <= 10) return 10;
  const step = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / step) * step;
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(320, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const max = niceMax(
    Math.max(0, ...points.flatMap((point) => ANALYSIS_MODULES.map((module) => point[module]))),
  );
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) =>
    PAD.left + (points.length <= 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
  const y = (value: number) => PAD.top + innerH - (value / max) * innerH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  const last = points.at(-1);
  // Etykiety końców linii rozsuwamy o co najmniej 13 px, żeby się nie nakładały przy równych wartościach.
  const labelY = new Map<AnalysisModule, number>();
  if (last) {
    const sorted = [...ANALYSIS_MODULES].sort((a, b) => last[a] - last[b]);
    let previous = Number.POSITIVE_INFINITY;
    for (const module of sorted) {
      const value = Math.min(y(last[module]) + 4, previous - 13);
      labelY.set(module, value);
      previous = value;
    }
  }

  return (
    <div ref={ref} className="w-full">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`Oflagowane materiały w czasie: ${ANALYSIS_MODULES.map((module) => `${MODULE_NAME[module]} ostatnio ${last?.[module] ?? 0}`).join(", ")}`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={PAD.left + innerW}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--color-line-200)"
            />
            <text
              x={PAD.left - 10}
              y={y(tick) + 4}
              textAnchor="end"
              className="tnum fill-ink-600 text-[11px]"
            >
              {tick}
            </text>
          </g>
        ))}
        {points.map((point, index) =>
          index % labelEvery === 0 || index === points.length - 1 ? (
            <text
              key={point.date}
              x={x(index)}
              y={HEIGHT - 8}
              textAnchor="middle"
              className="tnum fill-ink-600 text-[11px]"
            >
              {axisLabel(point.date)}
            </text>
          ) : null,
        )}
        {ANALYSIS_MODULES.map((module) => (
          <g key={module}>
            <polyline
              fill="none"
              stroke={STROKE[module]}
              strokeWidth={1.5}
              strokeDasharray={DASH[module]}
              strokeLinejoin="round"
              points={points.map((point, index) => `${x(index)},${y(point[module])}`).join(" ")}
            />
            {last ? (
              <text
                x={x(points.length - 1) + 8}
                y={labelY.get(module) ?? y(last[module]) + 4}
                className="tnum fill-ink-900 text-[11px]"
              >
                {MODULE_SHORT[module]} · {last[module]}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <ul className="mt-2 flex gap-6 text-ink-600 text-xs">
        {ANALYSIS_MODULES.map((module) => (
          <li key={module} className="flex items-center gap-2">
            <svg width="24" height="4" aria-hidden="true">
              <line
                x1="0"
                x2="24"
                y1="2"
                y2="2"
                stroke={STROKE[module]}
                strokeWidth={1.5}
                strokeDasharray={DASH[module]}
              />
            </svg>
            {MODULE_NAME[module]}
          </li>
        ))}
      </ul>
    </div>
  );
}
