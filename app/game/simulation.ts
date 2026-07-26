import {
  ACTIVE_PACING_MODE,
  STORM_CONFIG,
  WORLD_CONFIG,
} from "./config";
import type {
  AtmosphericConditions,
  EfRating,
  StormProfile,
  StormStage,
  WeatherSnapshot,
} from "./types";

const EF_ORDER: EfRating[] = ["EF1", "EF2", "EF3", "EF4", "EF5"];

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value));

const lerp = (from: number, to: number, amount: number) =>
  from + (to - from) * amount;

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const amount = clamp((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
};

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
};

const randomBetween = (random: () => number, minimum: number, maximum: number) =>
  lerp(minimum, maximum, random());

const offsetFromStorm = (
  position: { x: number; z: number },
  directionRadians: number,
  forwardMeters: number,
  flankMeters: number,
) => {
  const forwardX = Math.cos(directionRadians);
  const forwardZ = Math.sin(directionRadians);
  const flankX = -forwardZ;
  const flankZ = forwardX;
  return {
    x: position.x + forwardX * forwardMeters + flankX * flankMeters,
    z: position.z + forwardZ * forwardMeters + flankZ * flankMeters,
  };
};

const stageForProgress = (progress: number): StormStage => {
  const points = STORM_CONFIG.stageBreakpoints;
  if (progress < points.cumulogenesis) return "calma";
  if (progress < points.desarrollo) return "cumulogenesis";
  if (progress < points.supercelula) return "desarrollo";
  if (progress < points.tornado) return "supercelula";
  if (progress < points.disipacion) return "tornado";
  return "disipacion";
};

const stageBounds = (stage: StormStage): readonly [number, number] => {
  const points = STORM_CONFIG.stageBreakpoints;
  switch (stage) {
    case "calma":
      return [points.calma, points.cumulogenesis];
    case "cumulogenesis":
      return [points.cumulogenesis, points.desarrollo];
    case "desarrollo":
      return [points.desarrollo, points.supercelula];
    case "supercelula":
      return [points.supercelula, points.tornado];
    case "tornado":
      return [points.tornado, points.disipacion];
    case "disipacion":
      return [points.disipacion, points.end];
  }
};

const stageLabel = (stage: StormStage, tornadic: boolean) => {
  switch (stage) {
    case "calma":
      return "Atmósfera estable";
    case "cumulogenesis":
      return "Cúmulos en desarrollo";
    case "desarrollo":
      return "Tormenta en organización";
    case "supercelula":
      return "Supercélula madura";
    case "tornado":
      return tornadic ? "Tornado en curso" : "Tormenta severa";
    case "disipacion":
      return "Disipación";
  }
};

const efFromWind = (windKmh: number): EfRating | null => {
  if (windKmh < STORM_CONFIG.efWindRanges.EF1[0]) return null;
  if (windKmh <= STORM_CONFIG.efWindRanges.EF1[1]) return "EF1";
  if (windKmh <= STORM_CONFIG.efWindRanges.EF2[1]) return "EF2";
  if (windKmh <= STORM_CONFIG.efWindRanges.EF3[1]) return "EF3";
  if (windKmh <= STORM_CONFIG.efWindRanges.EF4[1]) return "EF4";
  return "EF5";
};

const pickTargetEf = (
  random: () => number,
  atmosphericPotential: number,
): EfRating => {
  const weights = { ...STORM_CONFIG.efWeights };
  const strongShift = clamp((atmosphericPotential - 0.7) / 0.28);
  const weakShift = clamp((0.74 - atmosphericPotential) / 0.22);

  weights.EF1 += weakShift * 0.12 - strongShift * 0.09;
  weights.EF2 += weakShift * 0.06 - strongShift * 0.03;
  weights.EF3 += strongShift * 0.035;
  weights.EF4 += strongShift * 0.05 - weakShift * 0.04;
  weights.EF5 += strongShift * 0.035 - weakShift * 0.02;

  const normalized = EF_ORDER.map((rating) => Math.max(0.01, weights[rating]));
  const total = normalized.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;

  for (let index = 0; index < EF_ORDER.length; index += 1) {
    roll -= normalized[index];
    if (roll <= 0) return EF_ORDER[index];
  }
  return "EF3";
};

const createProfile = (cycleId: number, seed: number): StormProfile => {
  const random = mulberry32(seed ^ (cycleId * 0x9e3779b1));
  const durationSeconds = randomBetween(
    random,
    ACTIVE_PACING_MODE.minCycleSeconds,
    ACTIVE_PACING_MODE.maxCycleSeconds,
  );
  const humidityPeak = randomBetween(random, 73, 93);
  const shearPeak = randomBetween(random, 35, 64);
  const capePeak = randomBetween(random, 1900, 4300);
  const pressureMinimum = randomBetween(random, 992, 1004);

  const peakPotential = clamp(
    ((humidityPeak - 60) / 35) * 0.25 +
      ((shearPeak - 20) / 48) * 0.32 +
      ((capePeak - 900) / 3500) * 0.33 +
      ((1014 - pressureMinimum) / 24) * 0.1,
  );
  const tornadoChance = clamp(
    STORM_CONFIG.tornadoFrequency + (peakPotential - 0.75) * 0.32,
    0.68,
    0.94,
  );
  const tornadic = random() < tornadoChance;
  const targetEf = pickTargetEf(random, peakPotential);
  const targetEfIndex = EF_ORDER.indexOf(targetEf);
  const [windMinimum, windMaximum] = STORM_CONFIG.efWindRanges[targetEf];

  const motionRoll = random();
  const motionRange =
    motionRoll < STORM_CONFIG.motion.commonDirectionChance
      ? STORM_CONFIG.motion.commonDirectionRadians
      : motionRoll <
          STORM_CONFIG.motion.commonDirectionChance +
            STORM_CONFIG.motion.northwardDirectionChance
        ? STORM_CONFIG.motion.northwardDirectionRadians
        : STORM_CONFIG.motion.eastwardDirectionRadians;
  const motionDirectionRadians = randomBetween(
    random,
    motionRange[0],
    motionRange[1],
  );
  const motionX = Math.cos(motionDirectionRadians);
  const motionZ = Math.sin(motionDirectionRadians);
  const perpendicularX = -motionZ;
  const perpendicularZ = motionX;
  const trackRadius =
    WORLD_CONFIG.playableRadius * STORM_CONFIG.motion.trackRadiusFraction;
  const trackOffset = randomBetween(
    random,
    -WORLD_CONFIG.playableRadius * 0.18,
    WORLD_CONFIG.playableRadius * 0.18,
  );
  const motionSpeedKmh = clamp(
    randomBetween(random, 34, 52) + (shearPeak - 35) * 0.72,
    STORM_CONFIG.motion.minimumSpeedKmh,
    STORM_CONFIG.motion.maximumSpeedKmh,
  );

  return {
    id: cycleId,
    durationSeconds,
    tornadic,
    targetEf,
    targetWindKmh: Math.round(
      randomBetween(random, windMinimum + 4, windMaximum),
    ),
    peakPotential,
    startX: -motionX * trackRadius + perpendicularX * trackOffset,
    startZ: -motionZ * trackRadius + perpendicularZ * trackOffset,
    endX: motionX * trackRadius + perpendicularX * trackOffset,
    endZ: motionZ * trackRadius + perpendicularZ * trackOffset,
    motionDirectionRadians,
    motionSpeedKmh,
    rotationDirection: random() < 0.78 ? "clockwise" : "counterclockwise",
    ffdEfficiency: randomBetween(random, 0.78, 1.08),
    rfdEfficiency: randomBetween(random, 0.72, 1.12),
    tailCloudEfficiency: randomBetween(random, 0.68, 1.08),
    temperatureBase: randomBetween(random, 20, 25),
    temperaturePeak: randomBetween(random, 29, 35),
    humidityBase: randomBetween(random, 48, 63),
    humidityPeak,
    pressureBase: randomBetween(random, 1011, 1018),
    pressureMinimum,
    shearBase: randomBetween(random, 8, 18),
    shearPeak,
    capeBase: randomBetween(random, 250, 800),
    capePeak,
    // Width and visible condensation overlap substantially between ratings.
    // EF ratings describe damage, not a tornado's dimensions or appearance.
    coreRadiusMeters: randomBetween(
      random,
      3.8 + targetEfIndex * 1.3,
      9.5 + targetEfIndex * 3,
    ),
    peakWindRadiusMeters: randomBetween(random, 11, 42),
    condensationEfficiency: randomBetween(random, 0.72, 1),
    debrisAvailability: randomBetween(random, 0.48, 1),
    vortexWobble: randomBetween(random, 0.72, 1.25),
  };
};

export class WeatherSimulation {
  private cycleId = 1;
  private simulatedSeconds = 0;
  private cycleSeconds = 0;
  private seed: number;
  private profile: StormProfile;

  constructor(seed = Math.floor(Math.random() * 0x7fffffff)) {
    this.seed = seed;
    this.profile = createProfile(this.cycleId, this.seed);
    // Start shortly before the first visible cumulus so a fresh session does
    // not open on an empty horizon for too long.
    this.cycleSeconds = this.profile.durationSeconds * 0.055;
  }

  reset(seed = Math.floor(Math.random() * 0x7fffffff)) {
    this.seed = seed;
    this.cycleId = 1;
    this.simulatedSeconds = 0;
    this.profile = createProfile(this.cycleId, this.seed);
    this.cycleSeconds = this.profile.durationSeconds * 0.055;
  }

  step(deltaSeconds: number) {
    const boundedDelta = clamp(deltaSeconds, 0, 0.5);
    this.simulatedSeconds += boundedDelta;
    this.cycleSeconds += boundedDelta;

    if (this.cycleSeconds >= this.profile.durationSeconds) {
      this.cycleSeconds %= this.profile.durationSeconds;
      this.cycleId += 1;
      this.profile = createProfile(this.cycleId, this.seed);
    }
    return this.snapshot();
  }

  snapshot(): WeatherSnapshot {
    const progress = clamp(this.cycleSeconds / this.profile.durationSeconds);
    const stage = stageForProgress(progress);
    const [stageStart, stageEnd] = stageBounds(stage);
    const stageProgress = clamp((progress - stageStart) / (stageEnd - stageStart));

    const growth = smoothstep(0.08, 0.58, progress);
    const decay = smoothstep(0.84, 1, progress);
    const stormPulse = clamp(growth - decay);
    const rotatingPulse = smoothstep(0.37, 0.58, progress) * (1 - decay);
    const oscillation =
      Math.sin(this.simulatedSeconds * 0.035 + this.profile.id * 1.7) * 0.5 +
      Math.sin(this.simulatedSeconds * 0.011 + 0.8) * 0.5;

    const conditions: AtmosphericConditions = {
      temperatureC:
        lerp(
          this.profile.temperatureBase,
          this.profile.temperaturePeak,
          stormPulse,
        ) +
        oscillation * 0.45,
      humidityPct: clamp(
        lerp(this.profile.humidityBase, this.profile.humidityPeak, stormPulse) +
          oscillation * 1.6,
        35,
        98,
      ),
      pressureHpa:
        lerp(
          this.profile.pressureBase,
          this.profile.pressureMinimum,
          rotatingPulse,
        ) +
        oscillation * 0.35,
      windShearKt:
        lerp(this.profile.shearBase, this.profile.shearPeak, growth) +
        oscillation * 1.2,
      capeJkg: Math.max(
        0,
        lerp(this.profile.capeBase, this.profile.capePeak, stormPulse) +
          oscillation * 70,
      ),
      surfaceWindKmh:
        10 +
        stormPulse * 36 +
        rotatingPulse * 18 +
        Math.max(0, oscillation * 4),
    };

    const tornadicPotential = clamp(
      ((conditions.humidityPct - 58) / 36) * 0.24 +
        ((conditions.windShearKt - 18) / 48) * 0.32 +
        ((conditions.capeJkg - 700) / 3600) * 0.34 +
        ((1015 - conditions.pressureHpa) / 26) * 0.1,
    );

    const pathProgress = smoothstep(0.1, 0.96, progress);
    const stormPosition = {
      x: lerp(this.profile.startX, this.profile.endX, pathProgress),
      z:
        lerp(this.profile.startZ, this.profile.endZ, pathProgress) +
        Math.sin(progress * Math.PI * 2.2 + this.profile.id) * 24,
    };
    const rainIntensity = clamp(
      smoothstep(0.28, 0.55, progress) *
        (1 - smoothstep(0.84, 0.98, progress)) *
        (0.62 + Math.max(0, oscillation) * 0.3),
    );
    const motionX = Math.cos(this.profile.motionDirectionRadians);
    const motionZ = Math.sin(this.profile.motionDirectionRadians);
    const rotationSign =
      this.profile.rotationDirection === "clockwise" ? -1 : 1;
    const organization =
      smoothstep(0.24, 0.5, progress) * (1 - decay);
    const mesocycloneStrength = clamp(
      organization *
        smoothstep(0.34, 0.78, tornadicPotential) *
        (0.65 + this.profile.peakPotential * 0.35),
    );
    const inflowStrength = clamp(
      growth *
        smoothstep(12, 64, conditions.surfaceWindKmh) *
        (1 - decay * 0.82),
    );
    const ffdIntensity = clamp(
      rainIntensity * this.profile.ffdEfficiency,
    );
    const rfdIntensity = clamp(
      smoothstep(0.42, 0.64, progress) *
        mesocycloneStrength *
        this.profile.rfdEfficiency *
        (1 - decay),
    );
    const wallCloudStrength = clamp(
      smoothstep(0.4, 0.6, progress) *
        mesocycloneStrength *
        (this.profile.tornadic ? 1 : 0.58),
    );
    const rfdCutStrength = clamp(
      rfdIntensity * smoothstep(0.48, 0.7, progress),
    );
    const tailCloudStrength = clamp(
      wallCloudStrength *
        inflowStrength *
        this.profile.tailCloudEfficiency,
    );
    const hookStrength = clamp(
      mesocycloneStrength *
        rfdIntensity *
        smoothstep(0.5, 0.7, progress),
    );
    const updraftPosition = offsetFromStorm(
      stormPosition,
      this.profile.motionDirectionRadians,
      -STORM_CONFIG.structure.updraftOffsetMeters,
      0,
    );
    const mesocyclonePosition = offsetFromStorm(
      stormPosition,
      this.profile.motionDirectionRadians,
      -STORM_CONFIG.structure.mesocycloneOffsetMeters,
      rotationSign * 10,
    );
    const ffdPosition = offsetFromStorm(
      stormPosition,
      this.profile.motionDirectionRadians,
      STORM_CONFIG.structure.ffdForwardOffsetMeters,
      -rotationSign * STORM_CONFIG.structure.ffdFlankOffsetMeters,
    );
    const rfdPosition = offsetFromStorm(
      stormPosition,
      this.profile.motionDirectionRadians,
      -STORM_CONFIG.structure.rfdRearOffsetMeters,
      rotationSign * STORM_CONFIG.structure.rfdFlankOffsetMeters,
    );
    const inflowDirectionRadians =
      this.profile.motionDirectionRadians - rotationSign * (Math.PI / 3);

    const tornadoStart = STORM_CONFIG.stageBreakpoints.tornado;
    const tornadoEnd = 0.93;
    const tornadoActive =
      this.profile.tornadic &&
      progress >= tornadoStart &&
      progress <= tornadoEnd;
    const tornadoLifeProgress = tornadoActive
      ? clamp((progress - tornadoStart) / (tornadoEnd - tornadoStart))
      : progress > tornadoEnd
        ? 1
        : 0;
    const intensification = smoothstep(0.02, 0.3, tornadoLifeProgress);
    const weakening = 1 - smoothstep(0.7, 1, tornadoLifeProgress);
    const intensityEnvelope = tornadoActive
      ? Math.pow(intensification * weakening, 0.72)
      : 0;
    const vortexPulse =
      0.96 +
      Math.sin(
        this.simulatedSeconds * 0.19 +
          this.profile.id * 2.17 +
          tornadoLifeProgress * 8,
      ) *
        0.04;
    const tornadoIntensity = clamp(intensityEnvelope * vortexPulse);
    const tornadoWindKmh = tornadoActive
      ? Math.round(68 + (this.profile.targetWindKmh - 68) * tornadoIntensity)
      : 0;
    const groundCirculation = tornadoActive
      ? clamp(
          smoothstep(0.02, 0.16, tornadoLifeProgress) *
            (1 - smoothstep(0.86, 1, tornadoLifeProgress)) *
            Math.pow(tornadoIntensity, 0.62),
        )
      : 0;
    const condensationOpacity = tornadoActive
      ? clamp(
          smoothstep(0.05, 0.22, tornadoLifeProgress) *
            (1 - smoothstep(0.76, 1, tornadoLifeProgress)) *
            (0.48 + tornadoIntensity * 0.52) *
            this.profile.condensationEfficiency *
            clamp((conditions.humidityPct - 58) / 32),
        )
      : 0;
    const funnelOpacity = condensationOpacity;
    const debrisIntensity = clamp(
      groundCirculation *
        this.profile.debrisAvailability *
        smoothstep(0.2, 0.58, tornadoIntensity),
    );
    const widthPulse =
      0.95 +
      Math.sin(
        this.simulatedSeconds * 0.12 +
          this.profile.id * 0.71 +
          tornadoLifeProgress * 5,
      ) *
        0.05 *
        this.profile.vortexWobble;
    const tornadoRadiusMeters = tornadoActive
      ? this.profile.coreRadiusMeters *
        (0.36 + tornadoIntensity * 0.64) *
        widthPulse
      : 0;
    const tornadoPeakWindRadiusMeters = tornadoActive
      ? this.profile.peakWindRadiusMeters * (0.78 + tornadoIntensity * 0.22)
      : 0;
    const meander = (1 - tornadoIntensity * 0.45) * this.profile.vortexWobble;
    const tornadoPosition = {
      x:
        mesocyclonePosition.x +
        Math.sin(progress * Math.PI * 5.4 + this.profile.id * 1.31) *
          13 *
          meander,
      z:
        mesocyclonePosition.z +
        Math.cos(progress * Math.PI * 4.7 + this.profile.id * 0.83) *
          10 *
          meander,
    };
    const estimatedWindRangeKmh = tornadoActive
      ? ([
          Math.max(0, Math.round((tornadoWindKmh * 0.86) / 5) * 5),
          Math.round((tornadoWindKmh * 1.14) / 5) * 5,
        ] as const)
      : null;

    return {
      cycleId: this.profile.id,
      simulatedSeconds: this.simulatedSeconds,
      cycleProgress: progress,
      stage,
      stageLabel: stageLabel(stage, this.profile.tornadic),
      stageProgress,
      secondsToNextStage: Math.max(
        0,
        (stageEnd - progress) * this.profile.durationSeconds,
      ),
      conditions,
      cloudCover: clamp(0.08 + stormPulse * 0.9),
      rainIntensity,
      tornadicPotential,
      stormPosition,
      stormMotion: {
        directionRadians: this.profile.motionDirectionRadians,
        speedKmh: this.profile.motionSpeedKmh,
        xKmh: motionX * this.profile.motionSpeedKmh,
        zKmh: motionZ * this.profile.motionSpeedKmh,
      },
      supercell: {
        updraftPosition,
        mesocyclonePosition,
        mesocycloneStrength,
        rotationDirection: this.profile.rotationDirection,
        wallCloudStrength,
        inflowStrength,
        inflowDirectionRadians,
        ffdIntensity,
        ffdPosition,
        rfdIntensity,
        rfdPosition,
        rfdCutStrength,
        tailCloudStrength,
        tailCloudDirectionRadians: inflowDirectionRadians,
        hookStrength,
      },
      stormVisible: progress >= 0.075 && progress <= 0.98,
      tornadoActive,
      tornadoLifeProgress,
      tornadoIntensity,
      tornadoPosition,
      tornadoRadiusMeters,
      tornadoPeakWindRadiusMeters,
      condensationOpacity,
      groundCirculation,
      debrisIntensity,
      funnelOpacity,
      tornadoWindKmh,
      estimatedWindRangeKmh,
      provisionalEf: efFromWind(tornadoWindKmh),
      targetEf: this.profile.targetEf,
      tornadicCycle: this.profile.tornadic,
    };
  }
}

export const initialWeatherSnapshot = () =>
  new WeatherSimulation(428731).snapshot();
