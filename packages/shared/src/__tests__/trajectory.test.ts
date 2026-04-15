import { describe, it, expect } from "vitest";
import { simulateTrajectory } from "../trajectory.js";

describe("trajectory (spin → shoot)", () => {
  it("identical seed → identical resting point", () => {
    const seed = "deadbeef".repeat(8);
    const a = simulateTrajectory(seed);
    const b = simulateTrajectory(seed);
    expect(a.resting.x).toEqual(b.resting.x);
    expect(a.resting.y).toEqual(b.resting.y);
    expect(a.steps.length).toEqual(b.steps.length);
  });

  it("resting point lies within the arena bounds", () => {
    const seed = "ab".repeat(32);
    const r = simulateTrajectory(seed);
    expect(Math.abs(r.resting.x)).toBeLessThanOrEqual(1.001);
    expect(Math.abs(r.resting.y)).toBeLessThanOrEqual(1.001);
  });

  it("trajectory has distinct spin and shoot phases", () => {
    const seed = "11" + "ff".repeat(31);
    const r = simulateTrajectory(seed);
    const spinSteps = r.steps.filter((s) => s.phase === "spin").length;
    const shootSteps = r.steps.filter((s) => s.phase === "shoot").length;
    expect(spinSteps).toBeGreaterThan(0);
    expect(shootSteps).toBeGreaterThan(0);
  });

  it("simulation terminates within max time", () => {
    const seed = "11" + "ff".repeat(31);
    const r = simulateTrajectory(seed);
    expect(r.durationMs).toBeLessThanOrEqual(9001);
    expect(r.steps.length).toBeGreaterThan(10);
  });
});
