import { type BandPoint as Pt, sampleCurves, ptsToPolygon, findCross } from "@/components/charts/monotoneBand";

export const REVENUE_COLOR = "var(--pl-green)";
export const EXPENSE_COLOR = "var(--pl-red)";

export type RevenueExpensePoint = {
  label: string;
  revenue: number;
  expense: number;
  tooltipLabel?: string;
};

/* The curve maths that keeps this chart's fill under its lines now lives in
   charts/monotoneBand.ts, with the test it never had. Same functions, moved
   verbatim — nothing about the rendering changed. */

export function ProfitLossDefsLayer(props: any) {
  const { xAxisMap, yAxisMap, chartData, graphId } = props;
  const data = chartData as RevenueExpensePoint[];
  if (!xAxisMap || !yAxisMap || !data?.length) return null;

  const xAxis = Object.values(xAxisMap as Record<string, any>)[0] as any;
  const yAxis = Object.values(yAxisMap as Record<string, any>)[0] as any;
  if (!xAxis?.scale || !yAxis?.scale) return null;

  const xScale = xAxis.scale;
  const yScale = yAxis.scale;
  const bandwidth = typeof xScale.bandwidth === "function" ? xScale.bandwidth() / 2 : 0;

  const xs = data.map((point) => (xScale(point.label) ?? 0) + bandwidth);
  const revenueYs = data.map((point) => yScale(point.revenue));
  const expenseYs = data.map((point) => yScale(point.expense));
  // Dense samples ALONG THE DRAWN CURVE, not the raw points — see the block
  // comment above sampleCurves for why the distinction is visible.
  const points: Pt[] = sampleCurves(xs, revenueYs, expenseYs);

  const profitSegments: string[] = [];
  const lossSegments: string[] = [];
  let profitMinY = Infinity;
  let profitMaxY = -Infinity;
  let lossMinY = Infinity;
  let lossMaxY = -Infinity;

  const flushSegment = (segment: Pt[], isProfit: boolean) => {
    if (segment.length < 2) return;
    const polygon = ptsToPolygon(segment, isProfit);
    if (!polygon) return;
    if (isProfit) {
      profitSegments.push(polygon);
      segment.forEach((point) => {
        profitMinY = Math.min(profitMinY, point.ry);
        profitMaxY = Math.max(profitMaxY, point.ey);
      });
    } else {
      lossSegments.push(polygon);
      segment.forEach((point) => {
        lossMinY = Math.min(lossMinY, point.ey);
        lossMaxY = Math.max(lossMaxY, point.ry);
      });
    }
  };

  let segment: Pt[] = [points[0]];
  let segmentIsProfit = points[0].ry <= points[0].ey;

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const prevIsProfit = prev.ry <= prev.ey;
    const currIsProfit = curr.ry <= curr.ey;
    if (prevIsProfit !== currIsProfit) {
      const cross = findCross(prev, curr);
      if (cross) {
        segment.push(cross);
        flushSegment(segment, segmentIsProfit);
        segment = [cross];
        segmentIsProfit = currIsProfit;
      }
    }
    segment.push(curr);
  }
  flushSegment(segment, segmentIsProfit);

  if (!Number.isFinite(profitMinY)) {
    profitMinY = 0;
    profitMaxY = 200;
  }
  if (!Number.isFinite(lossMinY)) {
    lossMinY = 0;
    lossMaxY = 200;
  }

  return (
    <defs>
      <linearGradient id={`profitGrad-${graphId}`} x1="0" y1={profitMinY} x2="0" y2={profitMaxY} gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor={REVENUE_COLOR} stopOpacity="0.30" />
        <stop offset="45%" stopColor={REVENUE_COLOR} stopOpacity="0.12" />
        <stop offset="100%" stopColor={REVENUE_COLOR} stopOpacity="0.02" />
      </linearGradient>
      <linearGradient id={`lossGrad-${graphId}`} x1="0" y1={lossMinY} x2="0" y2={lossMaxY} gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor={EXPENSE_COLOR} stopOpacity="0.30" />
        <stop offset="45%" stopColor={EXPENSE_COLOR} stopOpacity="0.12" />
        <stop offset="100%" stopColor={EXPENSE_COLOR} stopOpacity="0.02" />
      </linearGradient>
      <clipPath id={`profitClip-${graphId}`}>
        {profitSegments.map((polygon, index) => <polygon key={index} points={polygon} />)}
      </clipPath>
      <clipPath id={`lossClip-${graphId}`}>
        {lossSegments.map((polygon, index) => <polygon key={index} points={polygon} />)}
      </clipPath>
    </defs>
  );
}
