import test from "node:test";
import assert from "node:assert/strict";
import { sparkGeometry } from "./sparkGeometry";

const BOX = { width: 100, height: 40, inset: 2 };

test("fewer than two points is not a trend", () => {
  assert.equal(sparkGeometry([], BOX), null);
  assert.equal(sparkGeometry([5], BOX), null);
});

test("a series with an unreadable value draws nothing rather than a broken path", () => {
  assert.equal(sparkGeometry([1, Number.NaN, 3], BOX), null);
  assert.equal(sparkGeometry([1, Infinity], BOX), null);
});

test("a flat series draws flat down the middle, not stretched to fill the box", () => {
  const g = sparkGeometry([7, 7, 7], BOX);
  assert.ok(g);
  // Every y is the vertical centre: (2 + 38) / 2.
  const ys = [...g.line.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));
  assert.ok(ys.length > 0);
  for (const y of ys) assert.equal(y, 20);
});

test("the highest value sits at the top inset and the lowest at the bottom", () => {
  const g = sparkGeometry([0, 10], BOX);
  assert.ok(g);
  assert.ok(g.line.startsWith("M 2 38"), g.line);
  assert.deepEqual(g.end, { x: 98, y: 2 });
});

test("the end point is the last value, whichever direction the line ran", () => {
  const rising = sparkGeometry([1, 2, 9], BOX);
  const falling = sparkGeometry([9, 2, 1], BOX);
  assert.equal(rising?.end.y, 2);
  assert.equal(falling?.end.y, 38);
  assert.equal(rising?.end.x, 98);
  assert.equal(falling?.end.x, 98);
});

test("a zero rule appears only when the series really crosses zero", () => {
  assert.equal(sparkGeometry([1, 5, 9], BOX)?.zeroY, null);
  assert.equal(sparkGeometry([-9, -5, -1], BOX)?.zeroY, null);
  // -10 → 10 over a 36px band puts zero exactly halfway.
  assert.equal(sparkGeometry([-10, 10], BOX)?.zeroY, 20);
});

test("the fill hangs to the zero rule when there is one, so a loss is never shaded as a gain", () => {
  const crossing = sparkGeometry([-10, 10], BOX);
  assert.ok(crossing);
  assert.ok(crossing.area.includes("L 98 20 L 2 20 Z"), crossing.area);

  const allPositive = sparkGeometry([1, 9], BOX);
  assert.ok(allPositive);
  assert.ok(allPositive.area.includes("L 98 38 L 2 38 Z"), allPositive.area);
});

test("a box with no room inside its inset draws nothing", () => {
  assert.equal(sparkGeometry([1, 2], { width: 4, height: 40, inset: 2 }), null);
  assert.equal(sparkGeometry([1, 2], { width: 100, height: 4, inset: 2 }), null);
});
