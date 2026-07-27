export type StormStage =
  | "calma"
  | "cumulogenesis"
  | "desarrollo"
  | "supercelula"
  | "tornado"
  | "disipacion";

export type EfRating = "EF1" | "EF2" | "EF3" | "EF4" | "EF5";

export interface AtmosphericConditions {
  temperatureC: number;
  humidityPct: number;
  pressureHpa: number;
  windShearKt: number;
  capeJkg: number;
  surfaceWindKmh: number;
}

export interface WorldPosition {
  x: number;
  z: number;
}

export type RotationDirection = "clockwise" | "counterclockwise";

export interface StormMotion {
  directionRadians: number;
  speedKmh: number;
  xKmh: number;
  zKmh: number;
}

export interface SupercellStructure {
  updraftPosition: WorldPosition;
  mesocyclonePosition: WorldPosition;
  mesocycloneStrength: number;
  rotationDirection: RotationDirection;
  wallCloudStrength: number;
  inflowStrength: number;
  inflowDirectionRadians: number;
  ffdIntensity: number;
  ffdPosition: WorldPosition;
  rfdIntensity: number;
  rfdPosition: WorldPosition;
  rfdCutStrength: number;
  tailCloudStrength: number;
  tailCloudDirectionRadians: number;
  hookStrength: number;
}

export interface StormProfile {
  id: number;
  durationSeconds: number;
  tornadic: boolean;
  targetEf: EfRating;
  targetWindKmh: number;
  peakPotential: number;
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  motionDirectionRadians: number;
  motionSpeedKmh: number;
  rotationDirection: RotationDirection;
  ffdEfficiency: number;
  rfdEfficiency: number;
  tailCloudEfficiency: number;
  temperatureBase: number;
  temperaturePeak: number;
  humidityBase: number;
  humidityPeak: number;
  pressureBase: number;
  pressureMinimum: number;
  shearBase: number;
  shearPeak: number;
  capeBase: number;
  capePeak: number;
  coreRadiusMeters: number;
  peakWindRadiusMeters: number;
  condensationEfficiency: number;
  debrisAvailability: number;
  vortexWobble: number;
}

export interface WeatherSnapshot {
  cycleId: number;
  simulatedSeconds: number;
  cycleProgress: number;
  stage: StormStage;
  stageLabel: string;
  stageProgress: number;
  secondsToNextStage: number;
  conditions: AtmosphericConditions;
  cloudCover: number;
  rainIntensity: number;
  tornadicPotential: number;
  stormPosition: WorldPosition;
  stormMotion: StormMotion;
  supercell: SupercellStructure;
  stormVisible: boolean;
  tornadoActive: boolean;
  tornadoLifeProgress: number;
  funnelReach: number;
  tornadoIntensity: number;
  tornadoPosition: WorldPosition;
  tornadoRadiusMeters: number;
  tornadoPeakWindRadiusMeters: number;
  condensationOpacity: number;
  groundCirculation: number;
  debrisIntensity: number;
  funnelOpacity: number;
  tornadoWindKmh: number;
  estimatedWindRangeKmh: readonly [number, number] | null;
  provisionalEf: EfRating | null;
  targetEf: EfRating;
  tornadicCycle: boolean;
}

export interface PacingMode {
  id: "rapido" | "equilibrado" | "inmersivo" | "variable";
  label: string;
  minCycleSeconds: number;
  maxCycleSeconds: number;
}
