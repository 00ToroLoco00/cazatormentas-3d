"use client";

import { useCallback, useRef, useState } from "react";
import {
  initialWeatherSnapshot,
} from "../game/simulation";
import type { WeatherSnapshot } from "../game/types";
import StormScene, { type CameraMode } from "./StormScene";
import WeatherHud from "./WeatherHud";

export default function WeatherExperience() {
  const [snapshot, setSnapshot] = useState<WeatherSnapshot>(
    initialWeatherSnapshot,
  );
  const snapshotRef = useRef<WeatherSnapshot>(snapshot);
  const [paused, setPaused] = useState(false);
  const [simulationSpeed, setSimulationSpeed] = useState(1);
  const [cameraMode, setCameraMode] = useState<CameraMode>("libre");
  const [cameraSpeed, setCameraSpeed] = useState(76);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const [teleportToken, setTeleportToken] = useState(0);

  const updateSnapshot = useCallback((nextSnapshot: WeatherSnapshot) => {
    setSnapshot(nextSnapshot);
  }, []);

  const resetSimulation = () => {
    setResetToken((value) => value + 1);
    setPaused(false);
    setSimulationSpeed(1);
  };

  return (
    <main className="weather-experience">
      <StormScene
        paused={paused}
        simulationSpeed={simulationSpeed}
        cameraMode={cameraMode}
        cameraSpeed={cameraSpeed}
        resetToken={resetToken}
        teleportToken={teleportToken}
        snapshotRef={snapshotRef}
        onSnapshot={updateSnapshot}
        onPointerLockChange={setPointerLocked}
      />
      <WeatherHud
        snapshot={snapshot}
        paused={paused}
        simulationSpeed={simulationSpeed}
        cameraMode={cameraMode}
        cameraSpeed={cameraSpeed}
        pointerLocked={pointerLocked}
        onTogglePaused={() => setPaused((value) => !value)}
        onSimulationSpeed={setSimulationSpeed}
        onCameraMode={setCameraMode}
        onCameraSpeed={setCameraSpeed}
        onTeleport={() => setTeleportToken((value) => value + 1)}
        onReset={resetSimulation}
      />
      <noscript>
        Esta simulación necesita JavaScript para representar el mundo 3D.
      </noscript>
    </main>
  );
}
