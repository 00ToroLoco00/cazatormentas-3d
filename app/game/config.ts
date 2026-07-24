import type { EfRating, PacingMode } from "./types";

export const PACING_MODES: Record<PacingMode["id"], PacingMode> = {
  rapido: {
    id: "rapido",
    label: "Prueba rápida",
    minCycleSeconds: 180,
    maxCycleSeconds: 360,
  },
  equilibrado: {
    id: "equilibrado",
    label: "Equilibrado",
    minCycleSeconds: 480,
    maxCycleSeconds: 900,
  },
  inmersivo: {
    id: "inmersivo",
    label: "Inmersivo",
    minCycleSeconds: 900,
    maxCycleSeconds: 1800,
  },
  variable: {
    id: "variable",
    label: "Actividad variable",
    minCycleSeconds: 240,
    maxCycleSeconds: 1500,
  },
};

export const ACTIVE_PACING_MODE = PACING_MODES.rapido;

export const WORLD_CONFIG = {
  playableRadius: 520,
  visualRadius: 2200,
  stormBaseHeight: 145,
  stormTopHeight: 300,
} as const;

export const STORM_CONFIG = {
  tornadoFrequency: 0.82,
  stageBreakpoints: {
    calma: 0,
    cumulogenesis: 0.08,
    desarrollo: 0.24,
    supercelula: 0.45,
    tornado: 0.6,
    disipacion: 0.89,
    end: 1,
  },
  efWindRanges: {
    EF1: [138, 177],
    EF2: [178, 217],
    EF3: [218, 266],
    EF4: [267, 322],
    EF5: [323, 370],
  } satisfies Record<EfRating, readonly [number, number]>,
  // Game-friendly fast-mode distribution. The simulation shifts these weights
  // toward weaker or stronger ratings according to the atmospheric potential.
  efWeights: {
    EF1: 0.25,
    EF2: 0.32,
    EF3: 0.27,
    EF4: 0.12,
    EF5: 0.04,
  } satisfies Record<EfRating, number>,
} as const;

export const FUTURE_SYSTEM_SLOTS = {
  vehicles: false,
  probes: false,
  photography: false,
  damageIndicators: false,
  additionalTornadoMorphologies: false,
  multiplayerTransport: false,
} as const;
