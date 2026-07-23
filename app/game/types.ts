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
  stormVisible: boolean;
  tornadoActive: boolean;
  tornadoLifeProgress: number;
  funnelOpacity: number;
  tornadoWindKmh: number;
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

