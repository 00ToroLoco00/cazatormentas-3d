import assert from "node:assert/strict";
import test from "node:test";
import { WeatherSimulation } from "../app/game/simulation";
import type { WeatherSnapshot } from "../app/game/types";

const snapshotsForCycle = (seed: number) => {
  const simulation = new WeatherSimulation(seed);
  const cycleId = simulation.snapshot().cycleId;
  const snapshots: WeatherSnapshot[] = [];

  while (simulation.snapshot().cycleId === cycleId) {
    snapshots.push(simulation.step(0.5));
  }

  return snapshots;
};

test("a seeded simulation is reproducible", () => {
  const first = new WeatherSimulation(938_117);
  const second = new WeatherSimulation(938_117);

  for (let index = 0; index < 240; index += 1) {
    assert.deepEqual(first.step(0.5), second.step(0.5));
  }
});

test("tornado dynamics intensify and weaken within safe ranges", () => {
  const snapshots = Array.from({ length: 100 }, (_, index) => index + 1)
    .map(snapshotsForCycle)
    .find((cycle) => cycle.some((snapshot) => snapshot.tornadoActive));

  assert.ok(snapshots, "expected a tornadic cycle");
  const tornado = snapshots.filter((snapshot) => snapshot.tornadoActive);
  const peak = tornado.reduce((strongest, snapshot) =>
    snapshot.tornadoIntensity > strongest.tornadoIntensity
      ? snapshot
      : strongest,
  );

  assert.ok(peak.tornadoIntensity > 0.9);
  assert.ok(tornado[0].tornadoIntensity < peak.tornadoIntensity);
  assert.ok(tornado.at(-1)!.tornadoIntensity < peak.tornadoIntensity);
  assert.ok(peak.tornadoRadiusMeters > 0);
  assert.ok(peak.condensationOpacity >= 0 && peak.condensationOpacity <= 1);
  assert.ok(peak.groundCirculation >= 0 && peak.groundCirculation <= 1);
  assert.ok(peak.debrisIntensity >= 0 && peak.debrisIntensity <= 1);
  assert.ok(peak.estimatedWindRangeKmh);
  assert.ok(peak.estimatedWindRangeKmh[0] <= peak.tornadoWindKmh);
  assert.ok(peak.estimatedWindRangeKmh[1] >= peak.tornadoWindKmh);

  const distanceFromStorm = Math.hypot(
    peak.tornadoPosition.x - peak.stormPosition.x,
    peak.tornadoPosition.z - peak.stormPosition.z,
  );
  assert.ok(distanceFromStorm < 30);
});

test("EF1-EF3 remain common while EF4-EF5 are uncommon", () => {
  const counts = {
    EF1: 0,
    EF2: 0,
    EF3: 0,
    EF4: 0,
    EF5: 0,
  };

  for (let seed = 1; seed <= 2_000; seed += 1) {
    counts[new WeatherSimulation(seed).snapshot().targetEf] += 1;
  }

  const common = counts.EF1 + counts.EF2 + counts.EF3;
  const violent = counts.EF4 + counts.EF5;

  assert.ok(common / 2_000 > 0.78);
  assert.ok(violent / 2_000 < 0.22);
  assert.ok(counts.EF5 / 2_000 < 0.08);
});
