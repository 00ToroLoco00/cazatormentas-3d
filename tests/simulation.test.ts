import assert from "node:assert/strict";
import test from "node:test";
import { WeatherSimulation } from "../app/game/simulation";
import { sampleTornadoWind } from "../app/game/tornadoWind";
import type { WeatherSnapshot } from "../app/game/types";

const snapshotsForCycle = (seed: number) => {
  const simulation = new WeatherSimulation(seed);
  const cycleId = simulation.snapshot().cycleId;
  const snapshots: WeatherSnapshot[] = [];

  while (simulation.snapshot().cycleId === cycleId) {
    const snapshot = simulation.step(0.5);
    if (snapshot.cycleId !== cycleId) break;
    snapshots.push(snapshot);
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
  const distanceFromMesocyclone = Math.hypot(
    peak.tornadoPosition.x - peak.supercell.mesocyclonePosition.x,
    peak.tornadoPosition.z - peak.supercell.mesocyclonePosition.z,
  );
  assert.ok(distanceFromStorm < 40);
  assert.ok(distanceFromMesocyclone < 22);

  const motionLength = Math.hypot(
    peak.stormMotion.xKmh,
    peak.stormMotion.zKmh,
  );
  const rightX = peak.stormMotion.zKmh / motionLength;
  const rightZ = -peak.stormMotion.xKmh / motionLength;
  const radius = peak.tornadoPeakWindRadiusMeters;
  const right = sampleTornadoWind(peak, {
    x: peak.tornadoPosition.x + rightX * radius,
    z: peak.tornadoPosition.z + rightZ * radius,
  });
  const left = sampleTornadoWind(peak, {
    x: peak.tornadoPosition.x - rightX * radius,
    z: peak.tornadoPosition.z - rightZ * radius,
  });
  const eye = sampleTornadoWind(peak, peak.tornadoPosition);
  const far = sampleTornadoWind(peak, {
    x: peak.tornadoPosition.x + rightX * radius * 5,
    z: peak.tornadoPosition.z + rightZ * radius * 5,
  });

  if (peak.supercell.rotationDirection === "counterclockwise") {
    assert.ok(right.windKmh > left.windKmh);
  } else {
    assert.ok(left.windKmh > right.windKmh);
  }
  assert.ok(eye.windKmh < Math.max(left.windKmh, right.windKmh));
  assert.ok(far.windKmh < Math.max(left.windKmh, right.windKmh));
});

test("storm tracks and supercell structure follow motion-relative geometry", () => {
  const rotationDirections = new Set<string>();

  for (let seed = 1; seed <= 40; seed += 1) {
    const snapshots = snapshotsForCycle(seed);
    const initial = snapshots[0];
    const mature = snapshots.reduce((strongest, snapshot) =>
      snapshot.supercell.mesocycloneStrength >
      strongest.supercell.mesocycloneStrength
        ? snapshot
        : strongest,
    );
    const final = snapshots.at(-1)!;
    const motionLength = Math.hypot(
      initial.stormMotion.xKmh,
      initial.stormMotion.zKmh,
    );
    const motionX = initial.stormMotion.xKmh / motionLength;
    const motionZ = initial.stormMotion.zKmh / motionLength;
    const initialAlongTrack =
      initial.stormPosition.x * motionX +
      initial.stormPosition.z * motionZ;
    const finalAlongTrack =
      final.stormPosition.x * motionX +
      final.stormPosition.z * motionZ;
    const ffdAlongTrack =
      (mature.supercell.ffdPosition.x - mature.stormPosition.x) * motionX +
      (mature.supercell.ffdPosition.z - mature.stormPosition.z) * motionZ;
    const rfdAlongTrack =
      (mature.supercell.rfdPosition.x - mature.stormPosition.x) * motionX +
      (mature.supercell.rfdPosition.z - mature.stormPosition.z) * motionZ;

    assert.ok(initial.stormMotion.speedKmh >= 32);
    assert.ok(initial.stormMotion.speedKmh <= 78);
    assert.ok(Math.abs(motionLength - initial.stormMotion.speedKmh) < 0.0001);
    assert.ok(initialAlongTrack < 0);
    assert.ok(finalAlongTrack > 0);
    assert.ok(ffdAlongTrack > 40);
    assert.ok(rfdAlongTrack < -20);
    rotationDirections.add(initial.supercell.rotationDirection);

    for (const value of [
      mature.supercell.mesocycloneStrength,
      mature.supercell.wallCloudStrength,
      mature.supercell.inflowStrength,
      mature.supercell.ffdIntensity,
      mature.supercell.rfdIntensity,
      mature.supercell.rfdCutStrength,
      mature.supercell.tailCloudStrength,
      mature.supercell.hookStrength,
    ]) {
      assert.ok(value >= 0 && value <= 1);
    }
  }

  assert.deepEqual(
    [...rotationDirections].sort(),
    ["clockwise", "counterclockwise"],
  );
});

test("supercell structure organizes and later dissipates", () => {
  const snapshots = snapshotsForCycle(73);
  const early = snapshots[0];
  const mature = snapshots.reduce((strongest, snapshot) =>
    snapshot.supercell.mesocycloneStrength >
    strongest.supercell.mesocycloneStrength
      ? snapshot
      : strongest,
  );
  const late = snapshots.at(-1)!;

  assert.equal(early.supercell.mesocycloneStrength, 0);
  assert.ok(mature.supercell.mesocycloneStrength > 0.65);
  assert.ok(mature.supercell.ffdIntensity > 0.4);
  assert.ok(mature.supercell.inflowStrength > 0.4);
  assert.ok(
    late.supercell.mesocycloneStrength <
      mature.supercell.mesocycloneStrength,
  );
  assert.ok(late.supercell.ffdIntensity < mature.supercell.ffdIntensity);
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
