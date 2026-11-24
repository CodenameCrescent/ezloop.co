import test from "node:test";
import assert from "node:assert/strict";
import {
  CURVE_SAMPLES,
  findCross,
  monotoneTangents,
  ptsToPolygon,
  sampleCurves,
  type BandPoint,
} from "./monotoneBand";

/*
 * This maths shipped correct and untested. The properties below are the ones the
 * chart's honesty rests on: the curve must pass through the real data points,
 * must never overshoot them (that is what "monotone" buys), and must find the
 * profit/loss crossing where the CURVES cross rather than where the straight
 * chords do.
 */

const xs = [0, 100, 200, 300, 400];

test("monotoneTangents: a flat series has zero slope everywhere", () => {
  const m = monotoneTangents(xs, [50, 50, 50, 50, 50]);
  assert.deepEqual(m, [0, 0, 0, 0, 0]);
});

test("monotoneTangents: a local extremum gets a zero tangent — this is what stops overshoot", () => {
  // Up then down. At the peak the two neighbouring slopes have opposite signs,
  // so Fritsch-Carlson flattens the tangent and the curve cannot bulge past it.
  const m = monotoneTangents(xs, [0, 10, 100, 10, 0]);
  assert.equal(m[2], 0);
});

test("monotoneTangents: fewer than three points is a straight line", () => {
  assert.deepEqual(monotoneTangents([0, 100], [0, 50]), [0.5, 0.5]);
  assert.deepEqual(monotoneTangents([0], [7]), [0]);
});

test("sampleCurves: passes exactly through every data point", () => {
  const rev = [10, 90, 40, 70, 20];
  const exp = [5, 30, 60, 20, 50];
  const pts = sampleCurves(xs, rev, exp);

  // One sample lands on each control point; the last segment closes the run.
  assert.equal(pts.length, (xs.length - 1) * CURVE_SAMPLES + 1);
  xs.forEach((x, i) => {
    const hit = pts.find((p) => Math.abs(p.x - x) < 1e-6);
    assert.ok(hit, `no sample at x=${x}`);
    assert.ok(Math.abs(hit!.ry - rev[i]) < 1e-6, `revenue off at x=${x}`);
    assert.ok(Math.abs(hit!.ey - exp[i]) < 1e-6, `expense off at x=${x}`);
  });
});

test("sampleCurves: never overshoots the data — the bug a plain cubic would have", () => {
  const rev = [0, 10, 100, 10, 0];
  const flat = [0, 0, 0, 0, 0];
  const pts = sampleCurves(xs, rev, flat);
  const highest = Math.max(...pts.map((p) => p.ry));
  const lowest = Math.min(...pts.map((p) => p.ry));
  assert.ok(highest <= 100 + 1e-9, `overshot the peak: ${highest}`);
  assert.ok(lowest >= 0 - 1e-9, `undershot the floor: ${lowest}`);
});

test("sampleCurves: both series walk the SAME x parameter", () => {
  // The crossing test downstream compares ry against ey sample by sample, which
  // is only meaningful if the two share their x steps exactly.
  const pts = sampleCurves(xs, [10, 90, 40, 70, 20], [5, 30, 60, 20, 50]);
  const strictlyIncreasing = pts.every((p, i) => i === 0 || p.x >= pts[i - 1].x);
  assert.ok(strictlyIncreasing, "x must advance monotonically");
});

test("sampleCurves: two points is the chord itself", () => {
  const pts = sampleCurves([0, 100], [0, 50], [10, 20]);
  assert.deepEqual(pts, [
    { x: 0, ry: 0, ey: 10 },
    { x: 100, ry: 50, ey: 20 },
  ]);
});

test("findCross: locates the swap, and reports it as a single shared point", () => {
  const a: BandPoint = { x: 0, ry: 10, ey: 0 };
  const b: BandPoint = { x: 100, ry: 0, ey: 10 };
  const cross = findCross(a, b);
  assert.ok(cross);
  assert.equal(cross!.x, 50);
  // At a crossing the two curves are at the same height, by definition.
  assert.equal(cross!.ry, cross!.ey);
  assert.equal(cross!.ry, 5);
});

test("findCross: no crossing when both points sit the same way up", () => {
  assert.equal(findCross({ x: 0, ry: 10, ey: 0 }, { x: 1, ry: 20, ey: 5 }), null);
  assert.equal(findCross({ x: 0, ry: 0, ey: 10 }, { x: 1, ry: 5, ey: 20 }), null);
});

test("ptsToPolygon: closes the ring — out along one curve, back along the other", () => {
  const pts: BandPoint[] = [
    { x: 0, ry: 10, ey: 20 },
    { x: 10, ry: 12, ey: 22 },
  ];
  assert.equal(ptsToPolygon(pts, true), "0.0,10.0 10.0,12.0 10.0,22.0 0.0,20.0");
  // Flipping which series is on top swaps the two edges, nothing else.
  assert.equal(ptsToPolygon(pts, false), "0.0,20.0 10.0,22.0 10.0,12.0 0.0,10.0");
});

test("ptsToPolygon: a single point is not a polygon", () => {
  assert.equal(ptsToPolygon([{ x: 0, ry: 1, ey: 2 }], true), "");
});
