import type { WeatherSnapshot, WorldPosition } from "./types";

export interface TornadoWindSample {
  windKmh: number;
  xKmh: number;
  zKmh: number;
  inEye: boolean;
}

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const amount = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
};

export const sampleTornadoWind = (
  snapshot: WeatherSnapshot,
  position: WorldPosition,
): TornadoWindSample => {
  if (!snapshot.tornadoActive || snapshot.tornadoWindKmh <= 0) {
    return { windKmh: 0, xKmh: 0, zKmh: 0, inEye: false };
  }

  const offsetX = position.x - snapshot.tornadoPosition.x;
  const offsetZ = position.z - snapshot.tornadoPosition.z;
  const distance = Math.hypot(offsetX, offsetZ);
  const peakRadius = Math.max(5, snapshot.tornadoPeakWindRadiusMeters);
  const eyeRadius = peakRadius > 15 ? peakRadius * 0.24 : 0;
  const radialX = distance > 0.001 ? offsetX / distance : 0;
  const radialZ = distance > 0.001 ? offsetZ / distance : 0;
  const ringWidth = peakRadius * 0.46 + 4;
  const ring = Math.exp(-0.5 * ((distance - peakRadius) / ringWidth) ** 2);
  const outerFalloff = 1 - smoothstep(peakRadius * 1.85, peakRadius * 3.8, distance);
  const eyeLull = eyeRadius > 0 ? smoothstep(eyeRadius * 0.35, eyeRadius, distance) : 1;
  const rotationalKmh =
    snapshot.tornadoWindKmh * 0.86 * ring * outerFalloff * eyeLull;
  const radialInflowKmh = rotationalKmh * 0.13;
  const rotationSign =
    snapshot.supercell.rotationDirection === "clockwise" ? -1 : 1;
  const tangentialX = -radialZ * rotationSign;
  const tangentialZ = radialX * rotationSign;

  let xKmh =
    tangentialX * rotationalKmh - radialX * radialInflowKmh + snapshot.stormMotion.xKmh;
  let zKmh =
    tangentialZ * rotationalKmh - radialZ * radialInflowKmh + snapshot.stormMotion.zKmh;

  const rfdOffsetX = position.x - snapshot.supercell.rfdPosition.x;
  const rfdOffsetZ = position.z - snapshot.supercell.rfdPosition.z;
  const rfdDistance = Math.hypot(rfdOffsetX, rfdOffsetZ);
  const rfdInfluence =
    snapshot.supercell.rfdIntensity *
    (1 - smoothstep(38, 150, rfdDistance));
  const rfdToTornadoX = snapshot.tornadoPosition.x - snapshot.supercell.rfdPosition.x;
  const rfdToTornadoZ = snapshot.tornadoPosition.z - snapshot.supercell.rfdPosition.z;
  const rfdToTornadoLength = Math.max(
    1,
    Math.hypot(rfdToTornadoX, rfdToTornadoZ),
  );
  xKmh += (rfdToTornadoX / rfdToTornadoLength) * 38 * rfdInfluence;
  zKmh += (rfdToTornadoZ / rfdToTornadoLength) * 38 * rfdInfluence;

  return {
    windKmh: Math.hypot(xKmh, zKmh),
    xKmh,
    zKmh,
    inEye: eyeRadius > 0 && distance < eyeRadius,
  };
};
