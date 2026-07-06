import { useEffect, useState } from "react";
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

  useEffect(() => {
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
  }, []);

  if (!ready || !Chart) {
    return <div style={{ height }} className="w-full animate-pulse bg-muted/40 rounded-sm" />;
  }

  const options: any = {
    chart: {
      type,
      toolbar: { show: false },
      zoom: { enabled: false },
      animations: { enabled: false },
      fontFamily: "Inter, system-ui, sans-serif",
      foreColor: "#525252",
    },
    stroke: {
      curve: "smooth",
      width: series.map((s) => (s.dashed ? 2 : 2)),
      dashArray: series.map((s) => (s.dashed ? 5 : 0)),
    },
    colors: series.map(() => "#111111"),
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
      position: "top",
      horizontalAlign: "right",
      fontSize: "11px",
      labels: { colors: "#525252" },
      markers: { width: 12, height: 2, radius: 0 },
    },
    tooltip: { theme: "light", x: { format: "HH:mm:ss" } },
    annotations: thresholds
      ? {
          yaxis: thresholds.map((th) => ({
            y: th.value,
            borderColor: "#a3a3a3",
            strokeDashArray: 4,
            label: {
              text: th.label,
              style: { color: "#525252", background: "#fafafa", fontSize: "10px" },
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
