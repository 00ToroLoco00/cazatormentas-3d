"use client";

import { useEffect, useRef, useState } from "react";
import { WORLD_CONFIG } from "../game/config";
import type { WeatherSnapshot } from "../game/types";

interface RadarPanelProps {
  snapshot: WeatherSnapshot;
}

export default function RadarPanel({ snapshot }: RadarPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [product, setProduct] = useState<"reflectivity" | "velocity">(
    "reflectivity",
  );

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
    const tornadoMapX =
      size / 2 + snapshot.tornadoPosition.x * mapScale;
    const tornadoMapY =
      size / 2 + snapshot.tornadoPosition.z * mapScale;
    const updraftMapX =
      size / 2 + snapshot.supercell.updraftPosition.x * mapScale;
    const updraftMapY =
      size / 2 + snapshot.supercell.updraftPosition.z * mapScale;
    const mesocycloneMapX =
      size / 2 + snapshot.supercell.mesocyclonePosition.x * mapScale;
    const mesocycloneMapY =
      size / 2 + snapshot.supercell.mesocyclonePosition.z * mapScale;
    const ffdMapX =
      size / 2 + snapshot.supercell.ffdPosition.x * mapScale;
    const ffdMapY =
      size / 2 + snapshot.supercell.ffdPosition.z * mapScale;
    const rfdMapX =
      size / 2 + snapshot.supercell.rfdPosition.x * mapScale;
    const rfdMapY =
      size / 2 + snapshot.supercell.rfdPosition.z * mapScale;
    const stormSize = 16 + snapshot.cloudCover * 36;
    const motionAngle = snapshot.stormMotion.directionRadians;
    const ffdSize =
      stormSize * (0.72 + snapshot.supercell.ffdIntensity * 0.4);

    if (product === "reflectivity" && snapshot.stormVisible) {
      const developingAlpha =
        (0.24 + snapshot.cloudCover * 0.4) *
        (1 - snapshot.supercell.ffdIntensity * 0.68);
      context.save();
      context.translate(updraftMapX, updraftMapY);
      context.rotate(motionAngle);
      const developingEcho = context.createRadialGradient(
        0,
        0,
        2,
        0,
        0,
        stormSize * 0.7,
      );
      developingEcho.addColorStop(
        0,
        `rgba(94, 205, 84, ${developingAlpha})`,
      );
      developingEcho.addColorStop(
        0.55,
        `rgba(48, 160, 188, ${developingAlpha * 0.72})`,
      );
      developingEcho.addColorStop(1, "rgba(48, 160, 188, 0)");
      context.fillStyle = developingEcho;
      context.beginPath();
      context.ellipse(
        0,
        0,
        stormSize * 0.52,
        stormSize * 0.7,
        0,
        0,
        Math.PI * 2,
      );
      context.fill();
      context.restore();

      if (snapshot.supercell.ffdIntensity > 0.02) {
        context.save();
        context.translate(ffdMapX, ffdMapY);
        context.rotate(motionAngle);
        const ffdEcho = context.createRadialGradient(
          0,
          0,
          3,
          0,
          0,
          ffdSize,
        );
        ffdEcho.addColorStop(
          0,
          `rgba(231, 71, 51, ${0.35 + snapshot.supercell.ffdIntensity * 0.58})`,
        );
        ffdEcho.addColorStop(0.24, "rgba(242, 184, 54, 0.88)");
        ffdEcho.addColorStop(0.52, "rgba(91, 201, 83, 0.8)");
        ffdEcho.addColorStop(0.82, "rgba(48, 160, 188, 0.56)");
        ffdEcho.addColorStop(1, "rgba(48, 160, 188, 0)");
        context.fillStyle = ffdEcho;
        context.beginPath();
        context.ellipse(
          0,
          0,
          ffdSize * 0.94,
          ffdSize,
          0,
          0,
          Math.PI * 2,
        );
        context.fill();
        context.restore();
      }

      const notchDistance = stormSize * 0.24;
      const notchX =
        mesocycloneMapX +
        Math.cos(snapshot.supercell.inflowDirectionRadians) * notchDistance;
      const notchY =
        mesocycloneMapY +
        Math.sin(snapshot.supercell.inflowDirectionRadians) * notchDistance;
      context.save();
      context.translate(notchX, notchY);
      context.rotate(snapshot.supercell.inflowDirectionRadians);
      context.fillStyle = `rgba(7, 21, 17, ${
        0.2 + snapshot.supercell.inflowStrength * 0.3
      })`;
      context.beginPath();
      context.ellipse(
        0,
        0,
        stormSize * 0.3,
        stormSize * 0.075,
        0,
        0,
        Math.PI * 2,
      );
      context.fill();
      context.restore();

      if (snapshot.supercell.hookStrength > 0.03) {
        const rotationSign =
          snapshot.supercell.rotationDirection === "clockwise" ? -1 : 1;
        const hookAlpha = Math.min(
          0.94,
          0.38 + snapshot.supercell.hookStrength * 0.7,
        );
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(
          ffdMapX - Math.cos(motionAngle) * ffdSize * 0.42,
          ffdMapY - Math.sin(motionAngle) * ffdSize * 0.42,
        );
        context.bezierCurveTo(
          rfdMapX,
          rfdMapY,
          rfdMapX,
          rfdMapY,
          mesocycloneMapX -
            Math.cos(motionAngle) * stormSize * 0.28 +
            Math.cos(motionAngle + rotationSign * Math.PI * 0.5) *
              stormSize *
              0.24,
          mesocycloneMapY -
            Math.sin(motionAngle) * stormSize * 0.28 +
            Math.sin(motionAngle + rotationSign * Math.PI * 0.5) *
              stormSize *
              0.24,
        );
        context.strokeStyle = `rgba(48, 160, 188, ${hookAlpha * 0.72})`;
        context.lineWidth =
          8 + snapshot.supercell.rfdIntensity * stormSize * 0.1;
        context.stroke();
        context.strokeStyle = `rgba(242, 184, 54, ${hookAlpha})`;
        context.lineWidth =
          3 + snapshot.supercell.rfdIntensity * stormSize * 0.055;
        context.stroke();
      }
    }

    if (product === "velocity" && snapshot.stormVisible) {
      const radarDistance = Math.max(
        1,
        Math.hypot(
          snapshot.supercell.mesocyclonePosition.x,
          snapshot.supercell.mesocyclonePosition.z,
        ),
      );
      const radialX = snapshot.supercell.mesocyclonePosition.x / radarDistance;
      const radialZ = snapshot.supercell.mesocyclonePosition.z / radarDistance;
      const rotationSign =
        snapshot.supercell.rotationDirection === "clockwise" ? -1 : 1;
      const coupletOffset = 8 + snapshot.supercell.mesocycloneStrength * 9;
      const perpendicularX = -radialZ;
      const perpendicularZ = radialX;
      const rfdVelocity =
        Math.cos(motionAngle) * radialX + Math.sin(motionAngle) * radialZ;
      const rfdColor =
        rfdVelocity >= 0 ? "rgba(220, 72, 66, 0.32)" : "rgba(65, 190, 100, 0.32)";

      context.save();
      context.translate(rfdMapX, rfdMapY);
      context.rotate(motionAngle);
      context.fillStyle = rfdColor;
      context.beginPath();
      context.ellipse(
        0,
        0,
        13 + snapshot.supercell.rfdIntensity * 13,
        7 + snapshot.supercell.rfdIntensity * 7,
        0,
        0,
        Math.PI * 2,
      );
      context.fill();
      context.restore();

      for (const side of [-1, 1]) {
        const offsetX = perpendicularX * coupletOffset * side;
        const offsetZ = perpendicularZ * coupletOffset * side;
        const tangentX = -offsetZ * rotationSign;
        const tangentZ = offsetX * rotationSign;
        const radialVelocity = tangentX * radialX + tangentZ * radialZ;
        const color =
          radialVelocity >= 0
            ? "rgba(235, 72, 64, 0.9)"
            : "rgba(62, 202, 99, 0.9)";
        const lobe = context.createRadialGradient(
          mesocycloneMapX + offsetX,
          mesocycloneMapY + offsetZ,
          1,
          mesocycloneMapX + offsetX,
          mesocycloneMapY + offsetZ,
          11 + snapshot.supercell.mesocycloneStrength * 8,
        );
        lobe.addColorStop(0, color);
        lobe.addColorStop(0.66, color.replace("0.9", "0.52"));
        lobe.addColorStop(1, color.replace("0.9", "0"));
        context.fillStyle = lobe;
        context.beginPath();
        context.ellipse(
          mesocycloneMapX + offsetX,
          mesocycloneMapY + offsetZ,
          9 + snapshot.supercell.mesocycloneStrength * 6,
          7 + snapshot.supercell.mesocycloneStrength * 5,
          motionAngle,
          0,
          Math.PI * 2,
        );
        context.fill();
      }
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
  }, [product, snapshot]);

  return (
    <div className="radar-shell">
      <canvas
        ref={canvasRef}
        className="radar-canvas"
        aria-label={`Radar ${
          product === "reflectivity" ? "de reflectividad" : "de velocidad"
        } de la tormenta activa`}
      />
      <div className="radar-sweep" aria-hidden="true" />
      <span className="radar-north">N</span>
      <div className="radar-products">
        <button
          type="button"
          className={product === "reflectivity" ? "is-active" : undefined}
          onClick={() => setProduct("reflectivity")}
          aria-pressed={product === "reflectivity"}
        >
          REF
        </button>
        <button
          type="button"
          className={product === "velocity" ? "is-active" : undefined}
          onClick={() => setProduct("velocity")}
          aria-pressed={product === "velocity"}
        >
          VEL
        </button>
      </div>
      <div className="radar-legend" aria-hidden="true">
        {product === "reflectivity" ? (
          <>
            <span className="radar-low" />
            <span className="radar-mid" />
            <span className="radar-high" />
            <span className="radar-extreme" />
          </>
        ) : (
          <>
            <span className="radar-inbound" />
            <span className="radar-outbound" />
          </>
        )}
      </div>
    </div>
  );
}
