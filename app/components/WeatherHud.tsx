"use client";

import { useState, type ReactNode } from "react";
import { ACTIVE_PACING_MODE } from "../game/config";
import type { StormStage, WeatherSnapshot } from "../game/types";
import RadarPanel from "./RadarPanel";
import type { CameraMode } from "./StormScene";

interface WeatherHudProps {
  snapshot: WeatherSnapshot;
  paused: boolean;
  simulationSpeed: number;
  cameraMode: CameraMode;
  cameraSpeed: number;
  pointerLocked: boolean;
  onTogglePaused: () => void;
  onSimulationSpeed: (speed: number) => void;
  onCameraMode: (mode: CameraMode) => void;
  onCameraSpeed: (speed: number) => void;
  onTeleport: () => void;
  onReset: () => void;
}

interface PanelProps {
  id: string;
  title: string;
  eyebrow?: string;
  className?: string;
  children: ReactNode;
  defaultCollapsed?: boolean;
}

const STAGE_ORDER: StormStage[] = [
  "calma",
  "cumulogenesis",
  "desarrollo",
  "supercelula",
  "tornado",
  "disipacion",
];

const STAGE_SHORT: Record<StormStage, string> = {
  calma: "Calma",
  cumulogenesis: "Cúmulos",
  desarrollo: "Organización",
  supercelula: "Supercélula",
  tornado: "Tornado",
  disipacion: "Disipación",
};

function InstrumentPanel({
  id,
  title,
  eyebrow,
  className = "",
  children,
  defaultCollapsed = false,
}: PanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <section
      className={`instrument-panel ${collapsed ? "is-collapsed" : ""} ${className}`}
      aria-labelledby={`${id}-title`}
    >
      <header className="instrument-header">
        <div>
          {eyebrow ? <p>{eyebrow}</p> : null}
          <h2 id={`${id}-title`}>{title}</h2>
        </div>
        <button
          className="panel-toggle"
          type="button"
          aria-label={collapsed ? `Abrir ${title}` : `Minimizar ${title}`}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? "+" : "−"}
        </button>
      </header>
      {!collapsed ? <div className="instrument-body">{children}</div> : null}
    </section>
  );
}

const round = (value: number) => Math.round(value);

const formatTime = (seconds: number) => {
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))} s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.ceil(seconds % 60);
  return `${minutes} min ${remainder.toString().padStart(2, "0")} s`;
};

const potentialLabel = (potential: number) => {
  if (potential < 0.28) return "Bajo";
  if (potential < 0.52) return "Moderado";
  if (potential < 0.74) return "Alto";
  return "Muy alto";
};

export default function WeatherHud({
  snapshot,
  paused,
  simulationSpeed,
  cameraMode,
  cameraSpeed,
  pointerLocked,
  onTogglePaused,
  onSimulationSpeed,
  onCameraMode,
  onCameraSpeed,
  onTeleport,
  onReset,
}: WeatherHudProps) {
  const activeStage = STAGE_ORDER.indexOf(snapshot.stage);
  const efDisplay = snapshot.provisionalEf ?? "—";

  return (
    <div className="hud-layer">
      <header className="game-identity">
        <div className="identity-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <p>SIMULACIÓN ATMOSFÉRICA</p>
          <h1>Cazatormentas 3D</h1>
        </div>
      </header>

      <div className="live-status">
        <span
          className={`status-light ${
            snapshot.tornadicPotential > 0.68 ? "is-favorable" : ""
          }`}
        />
        <div>
          <small>CICLO {snapshot.cycleId.toString().padStart(2, "0")}</small>
          <strong>{snapshot.stageLabel}</strong>
        </div>
      </div>

      <div className="hud-column hud-left">
        <InstrumentPanel
          id="condiciones"
          eyebrow="DATOS EN VIVO"
          title="Condiciones atmosféricas"
        >
          <dl className="conditions-grid">
            <div>
              <dt>Temperatura</dt>
              <dd>{snapshot.conditions.temperatureC.toFixed(1)} °C</dd>
            </div>
            <div>
              <dt>Humedad</dt>
              <dd>{round(snapshot.conditions.humidityPct)} %</dd>
            </div>
            <div>
              <dt>Presión</dt>
              <dd>{round(snapshot.conditions.pressureHpa)} hPa</dd>
            </div>
            <div>
              <dt>Cizalladura</dt>
              <dd>{round(snapshot.conditions.windShearKt)} kt</dd>
            </div>
            <div>
              <dt>Inestabilidad</dt>
              <dd>{round(snapshot.conditions.capeJkg)} J/kg</dd>
            </div>
            <div>
              <dt>Viento sup.</dt>
              <dd>{round(snapshot.conditions.surfaceWindKmh)} km/h</dd>
            </div>
          </dl>
          <div className="potential-block">
            <div className="potential-label">
              <span>Potencial tornádico</span>
              <strong>{potentialLabel(snapshot.tornadicPotential)}</strong>
            </div>
            <div className="potential-track">
              <span
                style={{
                  width: `${Math.round(snapshot.tornadicPotential * 100)}%`,
                }}
              />
            </div>
            <small>
              Las condiciones cambian automáticamente. No son controles del
              jugador.
            </small>
          </div>
        </InstrumentPanel>

        <InstrumentPanel
          id="intensidad"
          eyebrow="ESTIMACIÓN ACTUAL"
          title="Intensidad del vórtice"
        >
          <div className="ef-readout">
            <strong className={`ef-badge ef-${efDisplay.toLowerCase()}`}>
              {efDisplay}
            </strong>
            <div>
              <span>Rango de viento estimado</span>
              <b>
                {snapshot.estimatedWindRangeKmh
                  ? `${snapshot.estimatedWindRangeKmh[0]}–${snapshot.estimatedWindRangeKmh[1]} km/h`
                  : "Sin vórtice en superficie"}
              </b>
            </div>
          </div>
          <p className="science-note">
            La escala EF real se asigna después de analizar daños. El ancho,
            color o grado de condensación no determinan la categoría.
          </p>
        </InstrumentPanel>
      </div>

      <div className="hud-column hud-right">
        <InstrumentPanel
          id="evolucion"
          eyebrow="TORMENTA ACTIVA"
          title="Evolución"
        >
          <ol className="stage-list">
            {STAGE_ORDER.map((stage, index) => (
              <li
                key={stage}
                className={
                  index === activeStage
                    ? "is-current"
                    : index < activeStage
                      ? "is-complete"
                      : ""
                }
              >
                <span>{index + 1}</span>
                <div>
                  <strong>
                    {stage === "tornado" && !snapshot.tornadicCycle
                      ? "Tormenta severa"
                      : STAGE_SHORT[stage]}
                  </strong>
                  {index === activeStage ? (
                    <small>
                      Próximo cambio en{" "}
                      {formatTime(snapshot.secondsToNextStage / simulationSpeed)}
                    </small>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </InstrumentPanel>

        <InstrumentPanel
          id="radar"
          eyebrow="REFLECTIVIDAD"
          title="Radar"
          className="radar-panel"
        >
          <RadarPanel snapshot={snapshot} />
          <div className="radar-caption">
            <span>
              <i className="caption-dot cell" /> Celda activa
            </span>
            <span>
              <i className="caption-dot vortex" /> Rotación
            </span>
          </div>
        </InstrumentPanel>
      </div>

      <div className="camera-hint">
        <span className={pointerLocked ? "is-active" : ""}>
          {cameraMode === "seguir"
            ? "Cámara siguiendo la tormenta"
            : pointerLocked
              ? "Cámara libre activa · ESC para liberar"
              : "Haz clic en el paisaje para controlar la cámara"}
        </span>
        <small>WASD mover · ratón mirar · espacio subir · C bajar</small>
      </div>

      <footer className="control-dock">
        <div className="dock-section transport-controls">
          <button
            type="button"
            className="primary-control"
            onClick={onTogglePaused}
            aria-label={paused ? "Reanudar simulación" : "Pausar simulación"}
          >
            <span aria-hidden="true">{paused ? "▶" : "Ⅱ"}</span>
            {paused ? "Reanudar" : "Pausar"}
          </button>
          <div className="speed-picker" aria-label="Velocidad de simulación">
            {[1, 2, 4, 8].map((speed) => (
              <button
                type="button"
                key={speed}
                className={simulationSpeed === speed ? "is-selected" : ""}
                onClick={() => onSimulationSpeed(speed)}
              >
                {speed}×
              </button>
            ))}
          </div>
        </div>

        <div className="dock-divider" />

        <div className="dock-section camera-controls">
          <button
            type="button"
            className={cameraMode === "libre" ? "is-selected" : ""}
            onClick={() => onCameraMode("libre")}
          >
            Cámara libre
          </button>
          <button
            type="button"
            className={cameraMode === "seguir" ? "is-selected" : ""}
            onClick={() => onCameraMode("seguir")}
          >
            Seguir tormenta
          </button>
          <button type="button" onClick={onTeleport}>
            Ir a la celda
          </button>
          <label className="camera-speed">
            <span>Vuelo</span>
            <input
              type="range"
              min="28"
              max="180"
              step="4"
              value={cameraSpeed}
              onChange={(event) => onCameraSpeed(Number(event.target.value))}
            />
          </label>
        </div>

        <div className="dock-divider" />

        <div className="dock-section">
          <button type="button" className="reset-control" onClick={onReset}>
            Nuevo ciclo
          </button>
          <span className="mode-chip">{ACTIVE_PACING_MODE.label}</span>
        </div>
      </footer>
    </div>
  );
}
