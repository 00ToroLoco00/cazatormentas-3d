"use client";

import { useEffect, useRef } from "react";
import { WORLD_CONFIG } from "../game/config";
import type { WeatherSnapshot } from "../game/types";

interface RadarPanelProps {
  snapshot: WeatherSnapshot;
}

export default function RadarPanel({ snapshot }: RadarPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const size = 300;
    const ratio = Math.min(window.devicePixelRatio, 2);
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    context.clearRect(0, 0, size, size);
    context.fillStyle = "#071511";
    context.fillRect(0, 0, size, size);

    context.strokeStyle = "rgba(111, 176, 144, 0.14)";
    context.lineWidth = 1;
    for (let index = 1; index < 6; index += 1) {
      context.beginPath();
      context.arc(size / 2, size / 2, index * 25, 0, Math.PI * 2);
      context.stroke();
    }
    context.beginPath();
    context.moveTo(size / 2, 0);
    context.lineTo(size / 2, size);
    context.moveTo(0, size / 2);
    context.lineTo(size, size / 2);
    context.stroke();

    const mapScale = 118 / WORLD_CONFIG.playableRadius;
    const mapX = size / 2 + snapshot.stormPosition.x * mapScale;
    const mapY = size / 2 + snapshot.stormPosition.z * mapScale;
    const tornadoMapX =
      size / 2 + snapshot.tornadoPosition.x * mapScale;
    const tornadoMapY =
      size / 2 + snapshot.tornadoPosition.z * mapScale;
    const stormSize = 24 + snapshot.cloudCover * 54;

    if (snapshot.stormVisible) {
      context.save();
      context.translate(mapX, mapY);
      context.rotate(-0.33);

      const outer = context.createRadialGradient(
        0,
        0,
        4,
        0,
        0,
        stormSize * 1.2,
      );
      outer.addColorStop(0, "rgba(231, 71, 51, 0.94)");
      outer.addColorStop(0.24, "rgba(242, 184, 54, 0.9)");
      outer.addColorStop(0.53, "rgba(91, 201, 83, 0.82)");
      outer.addColorStop(0.82, "rgba(48, 160, 188, 0.58)");
      outer.addColorStop(1, "rgba(48, 160, 188, 0)");
      context.fillStyle = outer;
      context.beginPath();
      context.ellipse(
        0,
        0,
        stormSize * (0.75 + snapshot.rainIntensity * 0.45),
        stormSize,
        0,
        0,
        Math.PI * 2,
      );
      context.fill();

      if (snapshot.tornadicPotential > 0.54) {
        context.strokeStyle = `rgba(247, 68, 55, ${Math.min(
          0.95,
          snapshot.tornadicPotential,
        )})`;
        context.lineWidth = 7;
        context.beginPath();
        context.arc(
          -stormSize * 0.36,
          stormSize * 0.34,
          stormSize * 0.28,
          -0.25,
          Math.PI * 1.25,
        );
        context.stroke();
      }
      context.restore();
    }

    context.fillStyle = "rgba(238, 240, 229, 0.75)";
    context.fillRect(191, 175, 4, 4);
    context.fillRect(204, 182, 3, 3);
    context.fillRect(215, 173, 3, 3);
    context.fillStyle = "rgba(202, 191, 157, 0.48)";
    context.fillRect(58, 79, 12, 4);
    context.fillRect(67, 87, 8, 3);

    context.strokeStyle = "rgba(231, 219, 158, 0.32)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(158, 26);
    context.lineTo(152, 276);
    context.moveTo(31, 172);
    context.lineTo(273, 166);
    context.stroke();

    context.fillStyle = "#e5f2e9";
    context.beginPath();
    context.arc(size / 2, size / 2, 3.2, 0, Math.PI * 2);
    context.fill();

    if (snapshot.tornadoActive) {
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(tornadoMapX, tornadoMapY, 7, 0, Math.PI * 2);
      context.stroke();
    }
  }, [snapshot]);

  return (
    <div className="radar-shell">
      <canvas
        ref={canvasRef}
        className="radar-canvas"
        aria-label="Radar meteorológico de la tormenta activa"
      />
      <div className="radar-sweep" aria-hidden="true" />
      <span className="radar-north">N</span>
      <div className="radar-legend" aria-hidden="true">
        <span className="radar-low" />
        <span className="radar-mid" />
        <span className="radar-high" />
        <span className="radar-extreme" />
      </div>
    </div>
  );
}
