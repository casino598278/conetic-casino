import { describe, it, expect } from "vitest";
import { simulateTrajectory } from "../trajectory.js";

describe("trajectory", () => {
  it("identical seed → identical resting point (determinism)", () => {
    const seed = "deadbeef".repeat(8);
    const a = simulateTrajectory(seed);
    const b = simulateTrajectory(seed);
    expect(a.resting.x).toEqual(b.resting.x);
    expect(a.resting.y).toEqual(b.resting.y);
    expect(a.steps.length).toEqual(b.steps.length);
  });

  it("ball stays within arena bounds", () => {
    const seed = "ab".repeat(32);
    const r = simulateTrajectory(seed);
    for (const s of r.steps) {
      expect(Math.abs(s.x)).toBeLessThanOrEqual(1.0);
      expect(Math.abs(s.y)).toBeLessThanOrEqual(1.0);
    }
  });

  it("simulation terminates within max time", () => {
    const seed = "11" + "ff".repeat(31);
    const r = simulateTrajectory(seed);
    expect(r.durationMs).toBeLessThanOrEqual(6001);
    expect(r.steps.length).toBeGreaterThan(10);
  });
});
