import { useEffect, useId, useRef, useState } from "react";
import type { SensorPoint } from "@/lib/mock-data";

// ApexCharts touches window on import; load client-side only.
export interface Series {
  name: string;
  data: SensorPoint[];
  dashed?: boolean;
}

interface Props {
  series: Series[];
  height?: number;
  yLabel?: string;
  thresholds?: { value: number; label: string }[];
  areaBetween?: boolean;
  type?: "line" | "area";
}

export function TimeSeriesChart({
  series,
  height = 220,
  yLabel,
  thresholds,
  areaBetween,
  type = "line",
}: Props) {
  const [ready, setReady] = useState(false);
  const [Chart, setChart] = useState<any>(null);
  const [isBrowser, setIsBrowser] = useState(false);
  const chartId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  // Only render on client side — prevents SSR hydration errors
  useEffect(() => {
    setIsBrowser(true);
  }, []);

  useEffect(() => {
    if (!isBrowser) return;
    let mounted = true;
    import("react-apexcharts").then((m) => {
      if (mounted) {
        setChart(() => m.default);
        setReady(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, [isBrowser]);

  if (!isBrowser || !ready || !Chart) {
    return <div style={{ height }} className="w-full animate-pulse bg-muted/40 rounded-sm" />;
  }

  // ─── Distinct color palette for each series ───
  // Curated to be easily distinguishable and accessible
  const PALETTE = [
    "#0d9488", // teal-600  — primary (inlet)
    "#8b5cf6", // violet-500 — secondary (outlet)
    "#f97316", // orange-500
    "#6366f1", // indigo-500
    "#ec4899", // pink-500
    "#f59e0b", // amber-500
    "#3b82f6", // blue-500
  ];

  // Threshold annotation colors
  const THRESHOLD_COLORS = ["#f59e0b", "#ef4444", "#a855f7", "#6366f1"]; // amber, red, purple, indigo

  // Consistently assign colors based on series name (Inlet vs Outlet)
  const seriesColors = series.map((s, i) => {
    const name = s.name.toLowerCase();
    if (name.includes("inlet") || name.includes("n1")) {
      return "#0d9488"; // Teal for Inlet
    }
    if (name.includes("outlet") || name.includes("n2")) {
      return "#8b5cf6"; // Violet for Outlet
    }
    return PALETTE[i % PALETTE.length];
  });

  const safeId = `chart-${chartId.replace(/:/g, "")}`;

  const options: any = {
    chart: {
      id: safeId,
      type,
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { enabled: false },
      fontFamily: "Inter, system-ui, sans-serif",
      foreColor: "#525252",
    },
    stroke: {
      curve: "smooth",
      width: series.map((s) => 2.5),
      dashArray: series.map((s) => (s.dashed ? 6 : 0)),
    },
    colors: seriesColors,
    fill: {
      type: type === "area" ? "gradient" : "solid",
      opacity: type === "area" ? 0.15 : 1,
      gradient: { shade: "light", type: "vertical", opacityFrom: 0.25, opacityTo: 0.02 },
    },
    dataLabels: { enabled: false },
    grid: { borderColor: "#e5e5e5", strokeDashArray: 3 },
    xaxis: {
      type: "datetime",
      labels: { style: { colors: "#737373", fontSize: "11px" } },
      axisBorder: { color: "#e5e5e5" },
      axisTicks: { color: "#e5e5e5" },
    },
    yaxis: {
      title: yLabel
        ? { text: yLabel, style: { color: "#737373", fontWeight: 400, fontSize: "11px" } }
        : undefined,
      labels: { style: { colors: "#737373", fontSize: "11px" } },
    },
    legend: {
      show: true,
      position: "top",
      horizontalAlign: "right",
      fontSize: "12px",
      fontWeight: 500,
      labels: { colors: "#374151" },
      markers: {
        size: 5,
        shape: "circle",
        strokeWidth: 0,
      },
      itemMargin: { horizontal: 12, vertical: 4 },
    },
    tooltip: {
      theme: "light",
      x: { format: "HH:mm:ss" },
      marker: { show: true },
      y: {
        formatter: (val: number) => {
          if (val == null) return "—";
          return `${val.toFixed(1)}${yLabel ? ` ${yLabel}` : ""}`;
        },
      },
    },
    annotations: thresholds
      ? {
          yaxis: thresholds.map((th, i) => ({
            y: th.value,
            borderColor: THRESHOLD_COLORS[i % THRESHOLD_COLORS.length],
            strokeDashArray: 4,
            label: {
              text: th.label,
              position: "left",
              style: {
                color: "#ffffff",
                background: THRESHOLD_COLORS[i % THRESHOLD_COLORS.length],
                fontSize: "10px",
                fontWeight: 600,
                padding: { left: 6, right: 6, top: 2, bottom: 2 },
              },
            },
          })),
        }
      : undefined,
  };

  const apexSeries = series.map((s) => ({
    name: s.name,
    data: s.data.map((p) => [p.t, Number(p.v.toFixed(2))]),
  }));

  return <Chart options={options} series={apexSeries} type={type} height={height} />;
}
