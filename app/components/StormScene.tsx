"use client";

import {
  useEffect,
  useRef,
  type MutableRefObject,
} from "react";
import * as THREE from "three";
import { WORLD_CONFIG } from "../game/config";
import {
  WeatherSimulation,
  initialWeatherSnapshot,
} from "../game/simulation";
import type { WeatherSnapshot } from "../game/types";
import { createPampasMap } from "./createPampasMap";

export type CameraMode = "libre" | "seguir";

interface StormSceneProps {
  paused: boolean;
  simulationSpeed: number;
  cameraMode: CameraMode;
  cameraSpeed: number;
  resetToken: number;
  teleportToken: number;
  snapshotRef: MutableRefObject<WeatherSnapshot>;
  onSnapshot: (snapshot: WeatherSnapshot) => void;
  onPointerLockChange: (locked: boolean) => void;
}

const seededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
};

const createTornadoVolumeMaterial = () => {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      cameraLocal: { value: new THREE.Vector3() },
      time: { value: 0 },
      intensity: { value: 0 },
      funnelReach: { value: 0 },
      condensation: { value: 0 },
      baseRadiusRatio: { value: 0.04 },
      cloudBaseRatio: { value: 0.86 },
      storminess: { value: 0 },
      cloudColor: { value: new THREE.Color(0x596263) },
    },
    vertexShader: `
      varying vec3 vPosition;
      void main() {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vPosition;
      uniform mat4 modelViewMatrix;
      uniform mat4 projectionMatrix;
      uniform vec3 cameraLocal;
      uniform float time;
      uniform float intensity;
      uniform float funnelReach;
      uniform float condensation;
      uniform float baseRadiusRatio;
      uniform float cloudBaseRatio;
      uniform float storminess;
      uniform vec3 cloudColor;

      float random3(vec3 point) {
        point = fract(point * 0.1031);
        point += dot(point, point.yzx + 33.33);
        return fract((point.x + point.y) * point.z);
      }

      float noise3(vec3 point) {
        vec3 cell = floor(point);
        vec3 blend = fract(point);
        blend = blend * blend * (3.0 - 2.0 * blend);
        return mix(
          mix(
            mix(random3(cell), random3(cell + vec3(1.0, 0.0, 0.0)), blend.x),
            mix(
              random3(cell + vec3(0.0, 1.0, 0.0)),
              random3(cell + vec3(1.0, 1.0, 0.0)),
              blend.x
            ),
            blend.y
          ),
          mix(
            mix(
              random3(cell + vec3(0.0, 0.0, 1.0)),
              random3(cell + vec3(1.0, 0.0, 1.0)),
              blend.x
            ),
            mix(
              random3(cell + vec3(0.0, 1.0, 1.0)),
              random3(cell + vec3(1.0, 1.0, 1.0)),
              blend.x
            ),
            blend.y
          ),
          blend.z
        );
      }

      float funnelDensity(vec3 point) {
        float height = point.y + 0.5;
        float descendingTip = 1.0 - funnelReach;
        float descentMask = smoothstep(
          descendingTip,
          descendingTip + 0.045,
          height
        );
        float visibleHeight = clamp(
          height / max(cloudBaseRatio, 0.01),
          0.0,
          1.0
        );
        float cloudMerge = smoothstep(cloudBaseRatio, 1.0, height);
        float radius = mix(
          baseRadiusRatio,
          0.385,
          pow(visibleHeight, 1.08)
        );
        radius *= 1.0 + cloudMerge * 0.22;
        float rotation = time * (0.35 + intensity * 0.5);
        vec2 center = vec2(
          sin(rotation + height * 5.4),
          cos(rotation * 0.86 + height * 4.7)
        ) * height * height * (0.012 + intensity * 0.018);
        float angle = atan(point.z - center.y, point.x - center.x);
        float wave =
          sin(angle * 4.0 - time * 1.2 + height * 11.0) * 0.025 +
          sin(angle * 7.0 + time * 0.7 - height * 19.0) * 0.012;
        float radialShape =
          radius * (1.0 + wave * (0.7 + intensity)) -
          length(point.xz - center);
        float broadBillow =
          noise3(vec3(point.xz * 9.0, height * 6.0) + time * 0.018) - 0.5;
        float fineBillow =
          noise3(vec3(point.xz * 19.0, height * 13.0) - time * 0.03) - 0.5;
        float groundConnection = smoothstep(0.0, 0.045, height);
        float cloudDissolve = 1.0 - smoothstep(
          cloudBaseRatio,
          1.0,
          height
        );
        return
          smoothstep(
            -0.018,
            0.045,
            radialShape + broadBillow * 0.032 + fineBillow * 0.012
          ) *
          groundConnection *
          cloudDissolve *
          descentMask;
      }

      vec2 intersectBox(vec3 origin, vec3 direction) {
        vec3 safeDirection = max(abs(direction), vec3(0.0001)) * sign(direction);
        vec3 inverseDirection = 1.0 / safeDirection;
        vec3 nearPlane = (-0.5 - origin) * inverseDirection;
        vec3 farPlane = (0.5 - origin) * inverseDirection;
        vec3 nearest = min(nearPlane, farPlane);
        vec3 farthest = max(nearPlane, farPlane);
        return vec2(
          max(max(nearest.x, nearest.y), nearest.z),
          min(min(farthest.x, farthest.y), farthest.z)
        );
      }

      void main() {
        vec3 rayDirection = normalize(vPosition - cameraLocal);
        vec2 bounds = intersectBox(cameraLocal, rayDirection);
        if (bounds.x > bounds.y) discard;

        float rayStart = max(bounds.x, 0.0);
        float rayLength = bounds.y - rayStart;
        float stepLength = rayLength / 30.0;
        float jitter = random3(vec3(gl_FragCoord.xy, time)) * stepLength;
        vec4 accumulated = vec4(0.0);
        vec3 surfacePoint = vec3(0.0);
        bool foundSurface = false;

        for (int index = 0; index < 30; index += 1) {
          vec3 point =
            cameraLocal +
            rayDirection * (rayStart + jitter + float(index) * stepLength);
          float density = funnelDensity(point);
          if (density > 0.01) {
            vec3 sampleColor = mix(
              cloudColor * 1.18,
              cloudColor * 0.92,
              density * (0.52 + storminess * 0.18)
            );
            float sampleAlpha =
              (1.0 - exp(-density * stepLength * 20.0)) *
              condensation *
              (0.72 + intensity * 0.28);
            accumulated.rgb +=
              (1.0 - accumulated.a) * sampleColor * sampleAlpha;
            accumulated.a += (1.0 - accumulated.a) * sampleAlpha;
            if (!foundSurface && accumulated.a >= 0.08) {
              surfacePoint = point;
              foundSurface = true;
            }
          }
          if (accumulated.a > 0.97) break;
        }

        if (!foundSurface) discard;
        vec4 surfaceClip =
          projectionMatrix * modelViewMatrix * vec4(surfacePoint, 1.0);
        gl_FragDepth = surfaceClip.z / surfaceClip.w * 0.5 + 0.5;
        gl_FragColor = vec4(
          accumulated.rgb / max(accumulated.a, 0.001),
          1.0
        );
      }
    `,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
  });
  material.forceSinglePass = true;
  return material;
};

const particleVertexShader = `
  uniform float pointSize;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = pointSize * (520.0 / max(1.0, -viewPosition.z));
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const createGroundDebrisVolumeMaterial = () => {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      cameraLocal: { value: new THREE.Vector3() },
      time: { value: 0 },
      intensity: { value: 0 },
      debris: { value: 0 },
      circulation: { value: 0 },
      rain: { value: 0 },
      fogAmount: { value: 0 },
      fogColor: { value: new THREE.Color(0xb8c2c7) },
      motionDirection: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: `
      varying vec3 vPosition;
      void main() {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vPosition;
      uniform vec3 cameraLocal;
      uniform float time;
      uniform float intensity;
      uniform float debris;
      uniform float circulation;
      uniform float rain;
      uniform float fogAmount;
      uniform vec3 fogColor;
      uniform vec2 motionDirection;

      float random3(vec3 point) {
        point = fract(point * 0.1031);
        point += dot(point, point.yzx + 33.33);
        return fract((point.x + point.y) * point.z);
      }

      float noise3(vec3 point) {
        vec3 cell = floor(point);
        vec3 blend = fract(point);
        blend = blend * blend * (3.0 - 2.0 * blend);
        return mix(
          mix(
            mix(random3(cell), random3(cell + vec3(1.0, 0.0, 0.0)), blend.x),
            mix(
              random3(cell + vec3(0.0, 1.0, 0.0)),
              random3(cell + vec3(1.0, 1.0, 0.0)),
              blend.x
            ),
            blend.y
          ),
          mix(
            mix(
              random3(cell + vec3(0.0, 0.0, 1.0)),
              random3(cell + vec3(1.0, 0.0, 1.0)),
              blend.x
            ),
            mix(
              random3(cell + vec3(0.0, 1.0, 1.0)),
              random3(cell + vec3(1.0, 1.0, 1.0)),
              blend.x
            ),
            blend.y
          ),
          blend.z
        );
      }

      float debrisDensity(vec3 point) {
        float height = point.y + 0.5;
        float angle = time * (0.32 + circulation * 0.7);
        float cosine = cos(angle);
        float sine = sin(angle);
        vec2 rotated = mat2(cosine, -sine, sine, cosine) * point.xz;
        vec2 drift = motionDirection * (height * 0.08 + time * 0.006);
        float broadNoise =
          noise3(vec3((rotated - drift) * 5.4, height * 4.2)) - 0.5;
        float fineNoise =
          noise3(vec3((rotated + drift) * 12.5, height * 8.0) + 9.4) - 0.5;
        float azimuth = atan(point.z, point.x);
        float spiral =
          sin(azimuth * 4.0 - time * (0.7 + intensity) + length(point.xz) * 18.0) *
          0.035;
        float edge =
          0.46 +
          broadNoise * 0.13 +
          fineNoise * 0.045 +
          spiral * (0.65 + circulation * 0.35) -
          length(point.xz);
        float groundLayer =
          smoothstep(-0.5, -0.42, point.y) *
          (1.0 - smoothstep(-0.08, 0.5, point.y));
        float billows =
          0.72 +
          noise3(vec3(rotated * 7.0, height * 5.6) - time * 0.025) * 0.5;
        float radialBoundary =
          1.0 - smoothstep(0.36, 0.49, length(point.xz));
        float topBoundary =
          1.0 - smoothstep(0.16, 0.46, point.y);
        return
          smoothstep(-0.055, 0.095, edge) *
          groundLayer *
          billows *
          radialBoundary *
          topBoundary;
      }

      vec2 intersectBox(vec3 origin, vec3 direction) {
        vec3 safeDirection = max(abs(direction), vec3(0.0001)) * sign(direction);
        vec3 inverseDirection = 1.0 / safeDirection;
        vec3 nearPlane = (-0.5 - origin) * inverseDirection;
        vec3 farPlane = (0.5 - origin) * inverseDirection;
        vec3 nearest = min(nearPlane, farPlane);
        vec3 farthest = max(nearPlane, farPlane);
        return vec2(
          max(max(nearest.x, nearest.y), nearest.z),
          min(min(farthest.x, farthest.y), farthest.z)
        );
      }

      void main() {
        vec3 rayDirection = normalize(vPosition - cameraLocal);
        vec2 bounds = intersectBox(cameraLocal, rayDirection);
        if (bounds.x > bounds.y) discard;

        float rayStart = max(bounds.x, 0.0);
        float rayLength = bounds.y - rayStart;
        float stepLength = rayLength / 24.0;
        float jitter = random3(vec3(gl_FragCoord.xy, time)) * stepLength;
        vec4 accumulated = vec4(0.0);

        for (int index = 0; index < 24; index += 1) {
          vec3 point =
            cameraLocal +
            rayDirection * (rayStart + jitter + float(index) * stepLength);
          float density = debrisDensity(point);
          if (density > 0.01) {
            float height = point.y + 0.5;
            vec3 dryColor = mix(
              vec3(0.095, 0.085, 0.07),
              vec3(0.19, 0.18, 0.16),
              smoothstep(0.0, 0.8, height)
            );
            vec3 wetColor = mix(
              vec3(0.25, 0.28, 0.29),
              vec3(0.42, 0.46, 0.48),
              smoothstep(0.0, 0.8, height)
            );
            vec3 sampleColor = mix(
              dryColor,
              wetColor,
              clamp(rain * 0.82, 0.0, 1.0)
            );
            sampleColor *= 1.0 - density * 0.22;
            sampleColor = mix(sampleColor, fogColor, fogAmount);
            float sampleAlpha =
              (1.0 - exp(-density * stepLength * 15.0)) *
              debris *
              (0.72 + intensity * 0.28) *
              (1.0 - fogAmount * 0.6);
            accumulated.rgb +=
              (1.0 - accumulated.a) * sampleColor * sampleAlpha;
            accumulated.a += (1.0 - accumulated.a) * sampleAlpha;
          }
          if (accumulated.a > 0.96) break;
        }

        if (accumulated.a < 0.025) discard;
        gl_FragColor = accumulated;
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
  });
  material.forceSinglePass = true;
  return material;
};

const createRainMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(0xa9c8cc) },
      opacity: { value: 0 },
      pointSize: { value: 2.5 },
    },
    vertexShader: particleVertexShader,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      void main() {
        float horizontal = abs(gl_PointCoord.x - 0.5);
        float vertical = abs(gl_PointCoord.y - 0.5);
        float streak = (1.0 - smoothstep(0.08, 0.22, horizontal)) *
          (1.0 - smoothstep(0.42, 0.5, vertical));
        if (streak < 0.02) discard;
        gl_FragColor = vec4(color, opacity * streak);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
  });

const createWorld = (scene: THREE.Scene) => {
  const random = seededRandom(12873);

  const hemisphere = new THREE.HemisphereLight(0xb9d1d4, 0x485438, 2.2);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffe5bc, 2.1);
  sun.position.set(-420, 560, 180);
  sun.castShadow = false;
  scene.add(sun);
  const stormLight = new THREE.PointLight(0xaec8df, 0, 620, 1.4);
  scene.add(stormLight);

  const skyUniforms = {
    storminess: { value: 0.1 },
    lightning: { value: 0 },
    hazeColor: { value: new THREE.Color(0xdfe3e4) },
    hazeStrength: { value: 0 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(WORLD_CONFIG.visualRadius, 40, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: skyUniforms,
      vertexShader: `
        varying vec3 vPosition;
        void main() {
          vPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vPosition;
        uniform float storminess;
        uniform float lightning;
        uniform vec3 hazeColor;
        uniform float hazeStrength;

        void main() {
          vec3 direction = normalize(vPosition);
          float h = direction.y * 0.5 + 0.5;
          vec3 horizon = mix(vec3(0.62, 0.72, 0.70), vec3(0.57, 0.60, 0.61), storminess);
          vec3 zenith = mix(vec3(0.20, 0.40, 0.52), vec3(0.16, 0.20, 0.22), storminess);
          float gradient = smoothstep(0.12, 0.86, h);
          vec3 color = mix(horizon, zenith, gradient);

          color += vec3(0.08, 0.055, 0.025) * pow(1.0 - h, 6.0);
          color += vec3(0.18, 0.22, 0.27) * lightning * (1.0 - gradient * 0.6);
          float horizonHaze =
            (1.0 - smoothstep(0.5, 0.82, h)) * hazeStrength;
          color = mix(color, hazeColor, clamp(horizonHaze, 0.0, 0.94));
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    }),
  );
  scene.add(sky);

  createPampasMap(scene, random);

  const cloudDeckGroup = new THREE.Group();
  const cloudDeckMaterial = new THREE.MeshStandardMaterial({
    color: 0xe4e7e6,
    emissive: 0xe4e7e6,
    emissiveIntensity: 0.5,
    roughness: 1,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const cloudDeckGeometry = new THREE.SphereGeometry(1, 12, 8);
  for (let index = 0; index < 132; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * 1_050;
    const width = 88 + random() * 102;
    const cloud = new THREE.Mesh(cloudDeckGeometry, cloudDeckMaterial);
    const baseScale = new THREE.Vector3(
      width * (1.2 + random() * 0.65),
      width * (0.18 + random() * 0.13),
      width,
    );
    cloud.position.set(
      Math.cos(angle) * distance,
      315 + random() * 82,
      Math.sin(angle) * distance,
    );
    cloud.scale.copy(baseScale).multiplyScalar(0.35);
    cloud.userData.baseScale = baseScale;
    cloud.userData.formationThreshold = random() * 0.62;
    cloudDeckGroup.add(cloud);
  }
  const fillerRowSpacing = 132;
  const fillerColumnSpacing = 148;
  for (let row = -9; row <= 9; row += 1) {
    for (let column = -9; column <= 9; column += 1) {
      const x =
        column * fillerColumnSpacing +
        (Math.abs(row) % 2) * fillerColumnSpacing * 0.5 +
        (random() - 0.5) * 24;
      const z =
        row * fillerRowSpacing +
        (random() - 0.5) * 24;
      if (Math.hypot(x, z) > 1_180) continue;

      const width = 132 + random() * 24;
      const cloud = new THREE.Mesh(cloudDeckGeometry, cloudDeckMaterial);
      const baseScale = new THREE.Vector3(
        width * (1.38 + random() * 0.18),
        width * (0.15 + random() * 0.07),
        width * (0.98 + random() * 0.14),
      );
      cloud.position.set(x, 326 + random() * 42, z);
      cloud.rotation.y = random() * Math.PI;
      cloud.scale.copy(baseScale).multiplyScalar(0.35);
      cloud.userData.baseScale = baseScale;
      cloud.userData.formationThreshold = 0.06 + random() * 0.54;
      cloudDeckGroup.add(cloud);
    }
  }
  cloudDeckGroup.visible = false;
  scene.add(cloudDeckGroup);

  const cloudGroup = new THREE.Group();
  const anvilCloudGroup = new THREE.Group();
  const supercellCloudGroup = new THREE.Group();
  const supercellCloudMaterial = cloudDeckMaterial.clone();
  const addSupercellCloud = (
    x: number,
    y: number,
    z: number,
    width: number,
    heightScale: number,
    formationThreshold: number,
  ) => {
    const cloud = new THREE.Mesh(
      cloudDeckGeometry,
      supercellCloudMaterial,
    );
    const baseScale = new THREE.Vector3(
      width * (1.15 + random() * 0.65),
      width * heightScale,
      width,
    );
    cloud.position.set(x, y, z);
    cloud.scale.copy(baseScale).multiplyScalar(0.35);
    cloud.userData.baseScale = baseScale;
    cloud.userData.formationThreshold = formationThreshold;
    supercellCloudGroup.add(cloud);
  };

  // Elevated precipitation-free base.
  for (let index = 0; index < 30; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * 170;
    const width = 34 + random() * 38;
    addSupercellCloud(
      Math.cos(angle) * distance,
      184 + random() * 24,
      Math.sin(angle) * distance * 0.72,
      width,
      0.34 + random() * 0.1,
      random() * 0.48,
    );
  }

  // Deep updraft tower rising from the base into the anvil.
  for (let index = 0; index < 44; index += 1) {
    const heightProgress = random();
    const angle = random() * Math.PI * 2;
    const distance =
      Math.pow(random(), 0.62) *
      THREE.MathUtils.lerp(82, 138, heightProgress);
    const width = 36 + random() * 42 + heightProgress * 12;
    addSupercellCloud(
      -28 + Math.cos(angle) * distance,
      202 + heightProgress * 132,
      Math.sin(angle) * distance * 0.78,
      width,
      0.52 + random() * 0.2,
      0.08 + random() * 0.48,
    );
  }

  // Broad anvil bridge overlaps the physical cloud deck.
  for (let index = 0; index < 36; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * 270;
    const width = 54 + random() * 54;
    addSupercellCloud(
      34 + Math.cos(angle) * distance,
      306 + random() * 42,
      Math.sin(angle) * distance * 0.68,
      width,
      0.24 + random() * 0.1,
      0.18 + random() * 0.5,
    );
  }

  // Only the rotating wall cloud hangs below the elevated storm base.
  for (let index = 0; index < 14; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = 12 + random() * 46;
    const width = 22 + random() * 28;
    addSupercellCloud(
      Math.cos(angle) * distance,
      150 + random() * 20,
      Math.sin(angle) * distance * 0.68,
      width,
      0.32 + random() * 0.08,
      0.38 + random() * 0.4,
    );
  }
  anvilCloudGroup.add(supercellCloudGroup);

  const cloudVolumeMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
    uniforms: {
      cameraLocal: { value: new THREE.Vector3() },
      time: { value: 0 },
      storminess: { value: 0 },
      opacity: { value: 0 },
      cloudProfileA: {
        value: new THREE.Vector4(-0.32, 0.46, 0.4, 0.31),
      },
      cloudProfileB: {
        value: new THREE.Vector4(0.35, 0.82, 0, 0.15),
      },
      structureA: { value: new THREE.Vector3() },
      wallCenter: { value: new THREE.Vector2() },
      tailDirection: { value: new THREE.Vector2(1, 0) },
      rfdCenter: { value: new THREE.Vector2() },
    },
    vertexShader: `
      varying vec3 vPosition;

      void main() {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vPosition;
      uniform vec3 cameraLocal;
      uniform float time;
      uniform float storminess;
      uniform float opacity;
      uniform vec4 cloudProfileA;
      uniform vec4 cloudProfileB;
      uniform vec3 structureA;
      uniform vec2 wallCenter;
      uniform vec2 tailDirection;
      uniform vec2 rfdCenter;

      float random3(vec3 point) {
        point = fract(point * 0.1031);
        point += dot(point, point.yzx + 33.33);
        return fract((point.x + point.y) * point.z);
      }

      float noise3(vec3 point) {
        vec3 cell = floor(point);
        vec3 blend = fract(point);
        blend = blend * blend * (3.0 - 2.0 * blend);

        return mix(
          mix(
            mix(random3(cell), random3(cell + vec3(1.0, 0.0, 0.0)), blend.x),
            mix(
              random3(cell + vec3(0.0, 1.0, 0.0)),
              random3(cell + vec3(1.0, 1.0, 0.0)),
              blend.x
            ),
            blend.y
          ),
          mix(
            mix(
              random3(cell + vec3(0.0, 0.0, 1.0)),
              random3(cell + vec3(1.0, 0.0, 1.0)),
              blend.x
            ),
            mix(
              random3(cell + vec3(0.0, 1.0, 1.0)),
              random3(cell + vec3(1.0, 1.0, 1.0)),
              blend.x
            ),
            blend.y
          ),
          blend.z
        );
      }

      float cloudNoise(vec3 point) {
        float detail = noise3(point);
        detail += noise3(point * 2.03 + 7.1) * 0.5;
        return detail / 1.5;
      }

      float cloudDensity(vec3 point) {
        float bottom = cloudProfileA.x;
        float top = cloudProfileA.y;
        float height = clamp((point.y - bottom) / (top - bottom), 0.0, 1.0);
        float radius = mix(
          cloudProfileA.z,
          cloudProfileB.x,
          smoothstep(0.08, 0.52, height)
        );
        radius = mix(
          radius,
          cloudProfileA.w,
          smoothstep(0.5, 0.88, height)
        );
        radius *= 1.0 - smoothstep(0.84, 1.0, height) * 0.56;

        float centerX =
          cloudProfileB.z * (height - 0.18) +
          sin(height * 5.2 + 0.7) * 0.018;
        float centerZ = sin(height * 4.1 + 2.3) * 0.014;
        float radialShape = 1.0 - length(
          vec2(
            (point.x - centerX) / radius,
            (point.z - centerZ) / (radius * cloudProfileB.y)
          )
        );

        vec3 drift = vec3(time * 0.008, 0.0, time * -0.005);
        float broadShape = noise3(point * 4.6 + drift) - 0.5;
        float edgeShape = cloudNoise(point * 12.0 - drift * 1.4) - 0.5;
        float lowerCap = smoothstep(bottom, bottom + 0.055, point.y);
        float upperCap = 1.0 - smoothstep(top - 0.11, top, point.y);
        float surface =
          radialShape +
          broadShape * cloudProfileB.w +
          edgeShape * 0.08;

        float baseDensity = smoothstep(-0.035, 0.11, surface) * lowerCap * upperCap;
        float wallBottom = bottom - 0.15 * structureA.x;
        vec2 wallOffset = point.xz - wallCenter;
        float wallShape = 1.0 - length(wallOffset / vec2(0.13, 0.105));
        float wallHeight =
          smoothstep(wallBottom, wallBottom + 0.045, point.y) *
          (1.0 - smoothstep(bottom + 0.08, bottom + 0.22, point.y));
        float wallDensity =
          smoothstep(-0.08, 0.26, wallShape) * wallHeight * structureA.x;

        vec2 tailOffset = point.xz - wallCenter;
        float tailAlong = dot(tailOffset, tailDirection);
        float tailSide = abs(dot(tailOffset, vec2(-tailDirection.y, tailDirection.x)));
        float tailLength =
          smoothstep(-0.015, 0.045, tailAlong) *
          (1.0 - smoothstep(0.1, 0.34, tailAlong));
        float tailWidth = 1.0 - smoothstep(0.045, 0.16, tailSide);
        float tailHeight =
          smoothstep(bottom - 0.035, bottom + 0.025, point.y) *
          (1.0 - smoothstep(bottom + 0.13, bottom + 0.25, point.y));
        float tailDensity = tailLength * tailWidth * tailHeight * structureA.y;

        vec2 rfdOffset = point.xz - rfdCenter;
        float rfdShape = 1.0 - length(rfdOffset / vec2(0.18, 0.13));
        float rfdHeight =
          smoothstep(bottom - 0.015, bottom + 0.045, point.y) *
          (1.0 - smoothstep(bottom + 0.12, bottom + 0.24, point.y));
        float rfdCut = smoothstep(-0.05, 0.3, rfdShape) * rfdHeight * structureA.z;

        return clamp(
          baseDensity * (1.0 - rfdCut) + max(wallDensity, tailDensity),
          0.0,
          1.0
        );
      }

      vec2 intersectBox(vec3 origin, vec3 direction) {
        vec3 safeDirection = max(abs(direction), vec3(0.0001)) * sign(direction);
        vec3 inverseDirection = 1.0 / safeDirection;
        vec3 nearPlane = (-0.5 - origin) * inverseDirection;
        vec3 farPlane = (0.5 - origin) * inverseDirection;
        vec3 nearest = min(nearPlane, farPlane);
        vec3 farthest = max(nearPlane, farPlane);
        return vec2(
          max(max(nearest.x, nearest.y), nearest.z),
          min(min(farthest.x, farthest.y), farthest.z)
        );
      }

      void main() {
        vec3 rayDirection = normalize(vPosition - cameraLocal);
        vec2 bounds = intersectBox(cameraLocal, rayDirection);
        if (bounds.x > bounds.y) {
          discard;
        }

        float rayStart = max(bounds.x, 0.0);
        float rayLength = bounds.y - rayStart;
        float stepLength = rayLength / 30.0;
        float jitter = random3(vec3(gl_FragCoord.xy, time)) * stepLength;
        vec4 accumulated = vec4(0.0);

        for (int index = 0; index < 30; index += 1) {
          vec3 point =
            cameraLocal +
            rayDirection * (rayStart + jitter + float(index) * stepLength);
          float density = cloudDensity(point);

          if (density > 0.01) {
            float heightLight = smoothstep(-0.35, 0.48, point.y);
            float coreShade = smoothstep(0.15, 0.95, density);
            vec3 lowerColor = mix(
              vec3(0.33, 0.38, 0.39),
              vec3(0.2, 0.235, 0.24),
              storminess
            );
            vec3 upperColor = mix(
              vec3(0.76, 0.8, 0.79),
              vec3(0.54, 0.59, 0.59),
              storminess
            );
            vec3 sampleColor = mix(lowerColor, upperColor, heightLight);
            sampleColor *= 1.05 - coreShade * (0.22 + storminess * 0.12);
            float sampleAlpha =
              (1.0 - exp(-density * stepLength * 9.5)) * opacity;
            accumulated.rgb +=
              (1.0 - accumulated.a) * sampleColor * sampleAlpha;
            accumulated.a += (1.0 - accumulated.a) * sampleAlpha;
          }

          if (accumulated.a > 0.97) {
            break;
          }
        }

        if (accumulated.a < 0.015) {
          discard;
        }
        gl_FragColor = accumulated;
      }
    `,
  });
  cloudVolumeMaterial.forceSinglePass = true;
  const cloudVolume = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    cloudVolumeMaterial,
  );
  cloudVolume.position.set(0, 158, 0);
  cloudVolume.scale.set(350, 280, 245);
  cloudVolume.visible = false;
  anvilCloudGroup.add(cloudVolume);
  cloudGroup.add(anvilCloudGroup);
  scene.add(cloudGroup);

  const cloudShadowMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      opacity: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float opacity;
      void main() {
        float radius = length(vUv - vec2(0.5)) * 2.0;
        float edge = 1.0 - smoothstep(0.18, 1.0, radius);
        gl_FragColor = vec4(0.035, 0.055, 0.045, edge * opacity);
      }
    `,
  });
  const cloudShadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    cloudShadowMaterial,
  );
  cloudShadow.rotation.x = -Math.PI / 2;
  cloudShadow.position.y = 1.3;
  scene.add(cloudShadow);

  const rainCount = 2200;
  const rainPositions = new Float32Array(rainCount * 3);
  for (let index = 0; index < rainCount; index += 1) {
    rainPositions[index * 3] = (random() - 0.5) * 360;
    rainPositions[index * 3 + 1] = 8 + random() * 220;
    rainPositions[index * 3 + 2] = (random() - 0.5) * 280;
  }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(rainPositions, 3),
  );
  const rainMaterial = createRainMaterial();
  const rain = new THREE.Points(rainGeometry, rainMaterial);
  scene.add(rain);

  const tornadoVolumeMaterial = createTornadoVolumeMaterial();
  const funnel = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    tornadoVolumeMaterial,
  );
  funnel.visible = false;
  funnel.frustumCulled = false;
  funnel.renderOrder = 2;
  scene.add(funnel);

  const tornadoConnectorGroup = new THREE.Group();
  const connectorCore = new THREE.Mesh(
    cloudDeckGeometry,
    supercellCloudMaterial,
  );
  connectorCore.scale.set(1.3, 0.3, 1.15);
  tornadoConnectorGroup.add(connectorCore);
  for (let index = 0; index < 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    const connectorCloud = new THREE.Mesh(
      cloudDeckGeometry,
      supercellCloudMaterial,
    );
    connectorCloud.position.set(
      Math.cos(angle) * 0.62,
      -0.04 + (index % 3) * 0.035,
      Math.sin(angle) * 0.62,
    );
    connectorCloud.scale.set(
      0.62 + (index % 2) * 0.16,
      0.2 + (index % 3) * 0.025,
      0.54 + ((index + 1) % 3) * 0.08,
    );
    connectorCloud.rotation.y = angle * 0.7;
    tornadoConnectorGroup.add(connectorCloud);
  }
  tornadoConnectorGroup.visible = false;
  tornadoConnectorGroup.renderOrder = 1;
  scene.add(tornadoConnectorGroup);

  const groundDebrisMaterial = createGroundDebrisVolumeMaterial();
  const groundDebris = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    groundDebrisMaterial,
  );
  groundDebris.visible = false;
  groundDebris.frustumCulled = false;
  groundDebris.renderOrder = 3;
  scene.add(groundDebris);

  const debrisParticleCount = 1_600;
  const debrisParticlePositions = new Float32Array(debrisParticleCount * 3);
  const debrisParticlePhases = new Float32Array(debrisParticleCount);
  const debrisParticleRadii = new Float32Array(debrisParticleCount);
  const debrisParticleHeights = new Float32Array(debrisParticleCount);
  const debrisParticleSpeeds = new Float32Array(debrisParticleCount);
  for (let index = 0; index < debrisParticleCount; index += 1) {
    debrisParticlePhases[index] = random() * Math.PI * 2;
    debrisParticleRadii[index] = 0.16 + Math.pow(random(), 0.68) * 0.84;
    debrisParticleHeights[index] = random();
    debrisParticleSpeeds[index] = 0.65 + random() * 1.5;
  }
  const debrisParticleGeometry = new THREE.BufferGeometry();
  debrisParticleGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(debrisParticlePositions, 3),
  );
  const debrisParticleMaterial = new THREE.PointsMaterial({
    color: 0x75694f,
    size: 0.32,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    sizeAttenuation: true,
  });
  const debrisParticles = new THREE.Points(
    debrisParticleGeometry,
    debrisParticleMaterial,
  );
  debrisParticles.visible = false;
  debrisParticles.frustumCulled = false;
  debrisParticles.renderOrder = 4;
  scene.add(debrisParticles);

  return {
    skyUniforms,
    hemisphere,
    sun,
    stormLight,
    cloudDeckGroup,
    cloudDeckMaterial,
    cloudGroup,
    anvilCloudGroup,
    supercellCloudGroup,
    supercellCloudMaterial,
    cloudShadow,
    cloudShadowMaterial,
    cloudVolume,
    cloudVolumeMaterial,
    rain,
    rainGeometry,
    rainMaterial,
    funnel,
    tornadoConnectorGroup,
    tornadoVolumeMaterial,
    groundDebris,
    groundDebrisMaterial,
    debrisParticles,
    debrisParticleGeometry,
    debrisParticleMaterial,
    debrisParticlePhases,
    debrisParticleRadii,
    debrisParticleHeights,
    debrisParticleSpeeds,
  };
};

export default function StormScene({
  paused,
  simulationSpeed,
  cameraMode,
  cameraSpeed,
  resetToken,
  teleportToken,
  snapshotRef,
  onSnapshot,
  onPointerLockChange,
}: StormSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  const speedRef = useRef(simulationSpeed);
  const cameraModeRef = useRef(cameraMode);
  const cameraSpeedRef = useRef(cameraSpeed);
  const resetTokenRef = useRef(resetToken);
  const teleportTokenRef = useRef(teleportToken);
  const onSnapshotRef = useRef(onSnapshot);
  const onPointerLockRef = useRef(onPointerLockChange);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    speedRef.current = simulationSpeed;
  }, [simulationSpeed]);

  useEffect(() => {
    cameraModeRef.current = cameraMode;
  }, [cameraMode]);

  useEffect(() => {
    cameraSpeedRef.current = cameraSpeed;
  }, [cameraSpeed]);

  useEffect(() => {
    onSnapshotRef.current = onSnapshot;
  }, [onSnapshot]);

  useEffect(() => {
    onPointerLockRef.current = onPointerLockChange;
  }, [onPointerLockChange]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x8b9c93, 0.00055);

    const camera = new THREE.PerspectiveCamera(
      63,
      mount.clientWidth / mount.clientHeight,
      0.4,
      WORLD_CONFIG.visualRadius * 2.2,
    );
    camera.position.set(-330, 115, 355);
    camera.lookAt(-260, 135, -140);
    const cameraEuler = new THREE.Euler().setFromQuaternion(
      camera.quaternion,
      "YXZ",
    );

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.domElement.className = "storm-canvas";
    mount.appendChild(renderer.domElement);

    const world = createWorld(scene);
    const simulation = new WeatherSimulation();
    let currentSnapshot = initialWeatherSnapshot();
    snapshotRef.current = currentSnapshot;
    let uiAccumulator = 0;
    let orbitAngle = -0.7;
    const clock = new THREE.Clock();
    const visualRandom = seededRandom(
      Math.floor(Math.random() * 0x7fffffff),
    );
    const keys = new Set<string>();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const move = new THREE.Vector3();
    const stormTarget = new THREE.Vector3();
    const desiredCameraPosition = new THREE.Vector3();
    let cloudShapeCycle = currentSnapshot.cycleId;

    const randomVisualBetween = (minimum: number, maximum: number) =>
      minimum + (maximum - minimum) * visualRandom();

    const randomizeCloudShape = () => {
      world.cloudVolumeMaterial.uniforms.cloudProfileA.value.set(
        randomVisualBetween(-0.35, -0.3),
        randomVisualBetween(0.43, 0.48),
        randomVisualBetween(0.41, 0.46),
        randomVisualBetween(0.35, 0.4),
      );
      world.cloudVolumeMaterial.uniforms.cloudProfileB.value.set(
        randomVisualBetween(0.38, 0.43),
        randomVisualBetween(0.92, 1),
        randomVisualBetween(-0.075, 0.075),
        randomVisualBetween(0.12, 0.18),
      );

      world.cloudVolume.position.y = randomVisualBetween(150, 166);
      const cloudWidth = randomVisualBetween(520, 650);
      world.cloudVolume.scale.set(
        cloudWidth,
        randomVisualBetween(290, 350),
        cloudWidth * randomVisualBetween(0.9, 1),
      );
    };

    randomizeCloudShape();

    const syncCameraEuler = () => {
      cameraEuler.setFromQuaternion(camera.quaternion, "YXZ");
    };

    const teleportToStorm = () => {
      const { x, z } = currentSnapshot.tornadoActive
        ? currentSnapshot.tornadoPosition
        : currentSnapshot.stormPosition;
      camera.position.set(x - 205, 105, z + 225);
      camera.lookAt(x, 105, z);
      syncCameraEuler();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      keys.add(event.code);
      if (event.code === "Escape") document.exitPointerLock?.();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.code);
    };
    const onMouseMove = (event: MouseEvent) => {
      if (
        document.pointerLockElement !== renderer.domElement ||
        cameraModeRef.current !== "libre"
      ) {
        return;
      }
      cameraEuler.y -= event.movementX * 0.0021;
      cameraEuler.x -= event.movementY * 0.0021;
      cameraEuler.x = THREE.MathUtils.clamp(
        cameraEuler.x,
        -Math.PI / 2 + 0.03,
        Math.PI / 2 - 0.03,
      );
    };
    const onCanvasClick = () => {
      if (cameraModeRef.current === "libre") {
        renderer.domElement.requestPointerLock?.();
      }
    };
    const onPointerLock = () => {
      onPointerLockRef.current(
        document.pointerLockElement === renderer.domElement,
      );
    };
    const onResize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointerlockchange", onPointerLock);
    renderer.domElement.addEventListener("click", onCanvasClick);
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(mount);

    let animationFrame = 0;
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      uiAccumulator += delta;

      if (resetTokenRef.current !== Number(renderer.domElement.dataset.reset ?? 0)) {
        simulation.reset();
        renderer.domElement.dataset.reset = String(resetTokenRef.current);
        currentSnapshot = simulation.snapshot();
        cloudShapeCycle = -1;
      }
      if (
        teleportTokenRef.current !==
        Number(renderer.domElement.dataset.teleport ?? 0)
      ) {
        renderer.domElement.dataset.teleport = String(teleportTokenRef.current);
        teleportToStorm();
      }

      if (!pausedRef.current) {
        currentSnapshot = simulation.step(delta * speedRef.current);
        snapshotRef.current = currentSnapshot;
      }
      if (cloudShapeCycle !== currentSnapshot.cycleId) {
        cloudShapeCycle = currentSnapshot.cycleId;
        randomizeCloudShape();
      }

      const elapsed = currentSnapshot.simulatedSeconds;
      const weatherDelta = pausedRef.current ? 0 : delta;
      const storminess = THREE.MathUtils.lerp(
        world.skyUniforms.storminess.value,
        currentSnapshot.cloudCover * 0.88,
        1 - Math.exp(-delta * 0.8),
      );
      const lightningFlash =
        Math.pow(
          Math.max(
            0,
            Math.sin(elapsed * 0.19 + Math.sin(elapsed * 0.047) * 2.6),
          ),
          22,
        ) *
        currentSnapshot.cloudCover *
        currentSnapshot.rainIntensity;
      world.skyUniforms.storminess.value = storminess;
      world.skyUniforms.lightning.value = lightningFlash;
      world.hemisphere.intensity = 2.2 - storminess * 1.25;
      world.sun.intensity = 2.1 - storminess * 1.8 + lightningFlash * 0.8;
      world.hemisphere.color.setRGB(
        0.72 - storminess * 0.26,
        0.82 - storminess * 0.28,
        0.84 - storminess * 0.25,
      );
      world.hemisphere.groundColor.setRGB(
        0.28 - storminess * 0.1,
        0.34 - storminess * 0.12,
        0.22 - storminess * 0.08,
      );
      world.sun.color.setRGB(
        1,
        0.9 - storminess * 0.15,
        0.74 - storminess * 0.2,
      );
      renderer.toneMappingExposure =
        1.08 - storminess * 0.32 + lightningFlash * 0.16;
      const fogWhitening = THREE.MathUtils.clamp(
        storminess * 0.75 + currentSnapshot.rainIntensity * 0.5,
        0,
        1,
      );
      if (scene.fog instanceof THREE.FogExp2) {
        scene.fog.density =
          0.00048 +
          storminess * 0.00065 +
          currentSnapshot.rainIntensity * 0.00075;
        scene.fog.color.setRGB(
          THREE.MathUtils.lerp(0.56, 0.72, fogWhitening),
          THREE.MathUtils.lerp(0.63, 0.76, fogWhitening),
          THREE.MathUtils.lerp(0.61, 0.8, fogWhitening),
        );
        world.skyUniforms.hazeColor.value.copy(scene.fog.color);
      }
      world.skyUniforms.hazeStrength.value =
        fogWhitening *
        (0.72 + currentSnapshot.rainIntensity * 0.22);

      let cloudDeckFormation = 1;
      let supercellFormation = 1;
      if (currentSnapshot.stage === "calma") {
        cloudDeckFormation = 0;
        supercellFormation = 0;
      } else if (currentSnapshot.stage === "cumulogenesis") {
        cloudDeckFormation = currentSnapshot.stageProgress;
        supercellFormation = 0;
      } else if (currentSnapshot.stage === "desarrollo") {
        supercellFormation = currentSnapshot.stageProgress;
      } else if (currentSnapshot.stage === "disipacion") {
        cloudDeckFormation = 1 - currentSnapshot.stageProgress;
        supercellFormation = 1 - currentSnapshot.stageProgress;
      }

      world.cloudDeckGroup.visible = cloudDeckFormation > 0.01;
      world.cloudDeckGroup.position.set(
        currentSnapshot.stormPosition.x,
        0,
        currentSnapshot.stormPosition.z,
      );
      world.cloudDeckGroup.rotation.y += weatherDelta * 0.0025;
      world.cloudDeckMaterial.opacity =
        cloudDeckFormation * (0.5 + currentSnapshot.cloudCover * 0.42);
      const cloudDarkening = THREE.MathUtils.clamp(
        cloudDeckFormation * 0.68 + supercellFormation * 0.42,
        0,
        1,
      );
      world.cloudDeckMaterial.color.setRGB(
        THREE.MathUtils.lerp(0.72, 0.2, cloudDarkening),
        THREE.MathUtils.lerp(0.74, 0.23, cloudDarkening),
        THREE.MathUtils.lerp(0.75, 0.25, cloudDarkening),
      );
      world.cloudDeckMaterial.emissive.copy(
        world.cloudDeckMaterial.color,
      );
      for (const cloud of world.cloudDeckGroup.children) {
        const threshold = cloud.userData.formationThreshold as number;
        const growth = THREE.MathUtils.smoothstep(
          cloudDeckFormation,
          threshold,
          Math.min(1, threshold + 0.22),
        );
        cloud.visible = growth > 0.01;
        cloud.scale
          .copy(cloud.userData.baseScale as THREE.Vector3)
          .multiplyScalar(THREE.MathUtils.lerp(0.35, 1, growth));
      }

      world.cloudGroup.visible =
        currentSnapshot.stormVisible && supercellFormation > 0.01;
      world.supercellCloudMaterial.opacity =
        supercellFormation * (0.5 + currentSnapshot.cloudCover * 0.42);
      world.supercellCloudMaterial.color.copy(
        world.cloudDeckMaterial.color,
      );
      world.supercellCloudMaterial.emissive.copy(
        world.cloudDeckMaterial.color,
      );
      for (const cloud of world.supercellCloudGroup.children) {
        const threshold = cloud.userData.formationThreshold as number;
        const growth = THREE.MathUtils.smoothstep(
          supercellFormation,
          threshold,
          Math.min(1, threshold + 0.24),
        );
        cloud.visible = growth > 0.01;
        cloud.scale
          .copy(cloud.userData.baseScale as THREE.Vector3)
          .multiplyScalar(THREE.MathUtils.lerp(0.35, 1, growth));
      }
      world.cloudGroup.position.set(
        currentSnapshot.stormPosition.x,
        0,
        currentSnapshot.stormPosition.z,
      );
      const horizontalCloudScale =
        (0.38 + currentSnapshot.cloudCover * 0.82) *
        THREE.MathUtils.lerp(0.55, 1, supercellFormation);
      world.cloudGroup.scale.set(
        horizontalCloudScale,
        1,
        horizontalCloudScale,
      );
      world.anvilCloudGroup.scale.set(
        1 + currentSnapshot.cloudCover * 0.14,
        0.94,
        0.98 + currentSnapshot.cloudCover * 0.1,
      );
      world.anvilCloudGroup.position.y = 12;
      world.anvilCloudGroup.rotation.y += weatherDelta * 0.012;
      world.cloudGroup.rotation.y +=
        weatherDelta * (0.025 + currentSnapshot.tornadicPotential * 0.09);
      const cloudScaleX =
        world.cloudVolume.scale.x *
        world.anvilCloudGroup.scale.x *
        world.cloudGroup.scale.x;
      const cloudScaleZ =
        world.cloudVolume.scale.z *
        world.anvilCloudGroup.scale.z *
        world.cloudGroup.scale.z;
      const cloudRotation = world.cloudGroup.rotation.y;
      world.cloudVolumeMaterial.uniforms.structureA.value.set(
        currentSnapshot.supercell.wallCloudStrength,
        currentSnapshot.supercell.tailCloudStrength,
        currentSnapshot.supercell.rfdCutStrength,
      );
      world.cloudVolumeMaterial.uniforms.wallCenter.value.set(
        (currentSnapshot.supercell.mesocyclonePosition.x -
          currentSnapshot.stormPosition.x) /
          cloudScaleX,
        (currentSnapshot.supercell.mesocyclonePosition.z -
          currentSnapshot.stormPosition.z) /
          cloudScaleZ,
      );
      world.cloudVolumeMaterial.uniforms.tailDirection.value.set(
        Math.cos(currentSnapshot.supercell.tailCloudDirectionRadians - cloudRotation),
        Math.sin(currentSnapshot.supercell.tailCloudDirectionRadians - cloudRotation),
      );
      world.cloudVolumeMaterial.uniforms.rfdCenter.value.set(
        (currentSnapshot.supercell.rfdPosition.x -
          currentSnapshot.stormPosition.x) /
          cloudScaleX,
        (currentSnapshot.supercell.rfdPosition.z -
          currentSnapshot.stormPosition.z) /
          cloudScaleZ,
      );
      const cloudBaseHeight =
        world.cloudGroup.scale.y *
        (world.anvilCloudGroup.position.y +
          world.anvilCloudGroup.scale.y * 138);
      world.stormLight.position.set(
        currentSnapshot.stormPosition.x - 28,
        135,
        currentSnapshot.stormPosition.z + 18,
      );
      world.stormLight.intensity = lightningFlash * 18;
      world.cloudVolumeMaterial.uniforms.time.value = elapsed;
      world.cloudVolumeMaterial.uniforms.storminess.value = storminess;
      world.cloudVolumeMaterial.uniforms.opacity.value = 0;
      world.cloudShadow.visible =
        currentSnapshot.stormVisible && supercellFormation > 0.01;
      world.cloudShadow.position.x = currentSnapshot.stormPosition.x + 18;
      world.cloudShadow.position.z = currentSnapshot.stormPosition.z + 12;
      world.cloudShadow.scale.setScalar(
        145 + currentSnapshot.cloudCover * 165,
      );
      world.cloudShadowMaterial.uniforms.opacity.value =
        (currentSnapshot.cloudCover * 0.2 +
          currentSnapshot.rainIntensity * 0.12) *
        supercellFormation;

      const ambientRain = THREE.MathUtils.smoothstep(
        currentSnapshot.cloudCover,
        0.2,
        0.58,
      );
      world.rain.visible = ambientRain > 0.02;
      world.rain.position.set(
        camera.position.x,
        0,
        camera.position.z,
      );
      world.rainMaterial.uniforms.opacity.value =
        0.05 + ambientRain * 0.22 + currentSnapshot.rainIntensity * 0.2;
      world.rainMaterial.uniforms.pointSize.value =
        1.8 + ambientRain * 1.15;
      const rainPosition = world.rainGeometry.attributes
        .position as THREE.BufferAttribute;
      if (world.rain.visible && weatherDelta > 0) {
        for (let index = 0; index < rainPosition.count; index += 1) {
          let y =
            rainPosition.getY(index) -
            weatherDelta * (145 + speedRef.current * 8);
          let x = rainPosition.getX(index) + weatherDelta * 11;
          let z = rainPosition.getZ(index);
          if (y < 1) {
            y = 175 + visualRandom() * 55;
            x = (visualRandom() - 0.5) * 360;
            z = (visualRandom() - 0.5) * 280;
          }
          rainPosition.setXYZ(index, x, y, z);
        }
        rainPosition.needsUpdate = true;
      }

      const intensity = currentSnapshot.tornadoIntensity;
      const { x: tornadoX, z: tornadoZ } = currentSnapshot.tornadoPosition;
      world.funnel.visible = currentSnapshot.tornadoActive;
      const baseRadius = THREE.MathUtils.clamp(
        currentSnapshot.tornadoRadiusMeters * 0.72,
        1.7,
        15,
      );
      const topRadius = THREE.MathUtils.clamp(
        20 + currentSnapshot.tornadoRadiusMeters * 1.45,
        24,
        48,
      );
      const funnelHeight = Math.max(
        4,
        cloudBaseHeight - 1 + 0.5,
      );
      const connectionOverlap = THREE.MathUtils.clamp(
        topRadius * 0.12,
        2,
        6,
      );
      const volumeHeight = funnelHeight + connectionOverlap;
      world.funnel.position.set(tornadoX, 1 + volumeHeight * 0.5, tornadoZ);
      world.funnel.scale.set(
        topRadius * 2.6,
        volumeHeight,
        topRadius * 2.6,
      );
      world.tornadoConnectorGroup.visible =
        currentSnapshot.tornadoActive && supercellFormation > 0.01;
      world.tornadoConnectorGroup.position.set(
        tornadoX,
        cloudBaseHeight + 2,
        tornadoZ,
      );
      world.tornadoConnectorGroup.scale.set(
        topRadius * 1.05,
        22 + intensity * 8,
        topRadius * 1.05,
      );
      world.tornadoConnectorGroup.rotation.y +=
        weatherDelta * (0.22 + intensity * 0.38);
      world.tornadoVolumeMaterial.uniforms.time.value = elapsed;
      world.tornadoVolumeMaterial.uniforms.intensity.value = intensity;
      world.tornadoVolumeMaterial.uniforms.funnelReach.value =
        currentSnapshot.funnelReach;
      world.tornadoVolumeMaterial.uniforms.condensation.value =
        currentSnapshot.tornadoActive
          ? Math.max(
              currentSnapshot.condensationOpacity * 0.88,
              0.72 + intensity * 0.18,
            )
          : 0;
      world.tornadoVolumeMaterial.uniforms.baseRadiusRatio.value =
        baseRadius / (topRadius * 2.6);
      world.tornadoVolumeMaterial.uniforms.cloudBaseRatio.value =
        funnelHeight / volumeHeight;
      world.tornadoVolumeMaterial.uniforms.storminess.value = storminess;
      world.tornadoVolumeMaterial.uniforms.cloudColor.value.setRGB(
        THREE.MathUtils.lerp(0.72, 0.32, cloudDarkening),
        THREE.MathUtils.lerp(0.74, 0.35, cloudDarkening),
        THREE.MathUtils.lerp(0.75, 0.38, cloudDarkening),
      );

      const contactGrowth = THREE.MathUtils.smoothstep(
        currentSnapshot.funnelReach,
        0.82,
        1,
      );
      const contactDecay =
        1 -
        THREE.MathUtils.smoothstep(
          currentSnapshot.tornadoLifeProgress,
          0.86,
          1,
        );
      const surfaceActivity =
        Math.max(contactGrowth * 0.16, currentSnapshot.groundCirculation) *
        contactDecay;
      const debrisRadius = THREE.MathUtils.clamp(
        8 +
          currentSnapshot.tornadoRadiusMeters *
            (1.55 + surfaceActivity * 1.1),
        12,
        65,
      );
      const debrisHeight = 5 + surfaceActivity * 20;
      world.groundDebris.visible = false;
      world.groundDebris.position.set(
        tornadoX,
        0.7 + debrisHeight * 0.5,
        tornadoZ,
      );
      world.groundDebris.scale.set(
        debrisRadius * 2.25,
        debrisHeight,
        debrisRadius * 2,
      );
      world.groundDebrisMaterial.uniforms.time.value = elapsed;
      world.groundDebrisMaterial.uniforms.intensity.value = intensity;
      world.groundDebrisMaterial.uniforms.circulation.value =
        surfaceActivity;
      world.groundDebrisMaterial.uniforms.debris.value =
        THREE.MathUtils.clamp(
          surfaceActivity *
            (0.28 +
              currentSnapshot.debrisIntensity * 0.72 +
              currentSnapshot.rainIntensity * 0.2),
          0,
          1,
        );
      world.groundDebrisMaterial.uniforms.rain.value =
        currentSnapshot.rainIntensity;
      world.groundDebrisMaterial.uniforms.motionDirection.value.set(
        Math.cos(currentSnapshot.stormMotion.directionRadians),
        Math.sin(currentSnapshot.stormMotion.directionRadians),
      );
      if (scene.fog instanceof THREE.FogExp2) {
        const debrisDistance = camera.position.distanceTo(
          world.groundDebris.position,
        );
        world.groundDebrisMaterial.uniforms.fogAmount.value =
          1 -
          Math.exp(
            -scene.fog.density *
              scene.fog.density *
              debrisDistance *
              debrisDistance,
          );
        world.groundDebrisMaterial.uniforms.fogColor.value.copy(
          scene.fog.color,
        );
      }

      const particleActivity =
        surfaceActivity * currentSnapshot.debrisIntensity;
      world.debrisParticles.visible =
        currentSnapshot.tornadoActive && particleActivity > 0.01;
      world.debrisParticles.position.set(tornadoX, 0.5, tornadoZ);
      world.debrisParticleMaterial.opacity =
        particleActivity * (0.3 + intensity * 0.5);
      world.debrisParticleMaterial.size = 0.22 + intensity * 0.18;
      world.debrisParticleMaterial.color.setRGB(
        THREE.MathUtils.lerp(0.45, 0.48, currentSnapshot.rainIntensity),
        THREE.MathUtils.lerp(0.39, 0.5, currentSnapshot.rainIntensity),
        THREE.MathUtils.lerp(0.28, 0.52, currentSnapshot.rainIntensity),
      );
      if (world.debrisParticles.visible) {
        const positions = world.debrisParticleGeometry.attributes
          .position as THREE.BufferAttribute;
        const rotationSign =
          currentSnapshot.supercell.rotationDirection === "clockwise"
            ? -1
            : 1;
        const motionX = Math.cos(
          currentSnapshot.stormMotion.directionRadians,
        );
        const motionZ = Math.sin(
          currentSnapshot.stormMotion.directionRadians,
        );
        for (let index = 0; index < positions.count; index += 1) {
          const rise =
            (world.debrisParticleHeights[index] +
              elapsed * world.debrisParticleSpeeds[index] * 0.055) %
            1;
          const angle =
            world.debrisParticlePhases[index] +
            rotationSign *
              elapsed *
              world.debrisParticleSpeeds[index] *
              (1.1 + intensity * 2);
          const radius =
            debrisRadius *
            world.debrisParticleRadii[index] *
            (0.5 + surfaceActivity * 0.5) *
            (1 - rise * 0.18);
          const drift = rise * debrisRadius * 0.18;
          positions.setXYZ(
            index,
            Math.cos(angle) * radius + motionX * drift,
            rise * (4 + surfaceActivity * 15),
            Math.sin(angle) * radius + motionZ * drift,
          );
        }
        positions.needsUpdate = true;
      }

      stormTarget.set(
        currentSnapshot.tornadoActive
          ? currentSnapshot.tornadoPosition.x
          : currentSnapshot.stormPosition.x,
        currentSnapshot.tornadoActive ? 68 : 138,
        currentSnapshot.tornadoActive
          ? currentSnapshot.tornadoPosition.z
          : currentSnapshot.stormPosition.z,
      );
      if (cameraModeRef.current === "seguir") {
        orbitAngle += delta * 0.085;
        const orbitRadius = 235;
        desiredCameraPosition.set(
          stormTarget.x + Math.cos(orbitAngle) * orbitRadius,
          92 + Math.sin(orbitAngle * 0.55) * 20,
          stormTarget.z + Math.sin(orbitAngle) * orbitRadius,
        );
        camera.position.lerp(
          desiredCameraPosition,
          1 - Math.exp(-delta * 1.8),
        );
        camera.lookAt(stormTarget);
        syncCameraEuler();
      } else {
        camera.quaternion.setFromEuler(cameraEuler);
        move.set(0, 0, 0);
        camera.getWorldDirection(forward);
        right.crossVectors(forward, camera.up).normalize();
        if (keys.has("KeyW")) move.add(forward);
        if (keys.has("KeyS")) move.sub(forward);
        if (keys.has("KeyD")) move.add(right);
        if (keys.has("KeyA")) move.sub(right);
        if (keys.has("Space")) move.y += 1;
        if (keys.has("ControlLeft") || keys.has("KeyC")) move.y -= 1;
        if (move.lengthSq() > 0) {
          move.normalize();
          const boost =
            keys.has("ShiftLeft") || keys.has("ShiftRight") ? 2.4 : 1;
          camera.position.addScaledVector(
            move,
            cameraSpeedRef.current * boost * delta,
          );
        }
        camera.position.x = THREE.MathUtils.clamp(
          camera.position.x,
          -WORLD_CONFIG.playableRadius,
          WORLD_CONFIG.playableRadius,
        );
        camera.position.z = THREE.MathUtils.clamp(
          camera.position.z,
          -WORLD_CONFIG.playableRadius,
          WORLD_CONFIG.playableRadius,
        );
        camera.position.y = THREE.MathUtils.clamp(camera.position.y, 4, 440);
      }

      if (uiAccumulator > 0.18) {
        uiAccumulator = 0;
        onSnapshotRef.current(currentSnapshot);
      }

      world.cloudVolumeMaterial.uniforms.cameraLocal.value.copy(camera.position);
      world.cloudVolume.worldToLocal(
        world.cloudVolumeMaterial.uniforms.cameraLocal.value,
      );
      world.tornadoVolumeMaterial.uniforms.cameraLocal.value.copy(
        camera.position,
      );
      world.funnel.worldToLocal(
        world.tornadoVolumeMaterial.uniforms.cameraLocal.value,
      );
      if (world.groundDebris.visible) {
        world.groundDebrisMaterial.uniforms.cameraLocal.value.copy(
          camera.position,
        );
        world.groundDebris.worldToLocal(
          world.groundDebrisMaterial.uniforms.cameraLocal.value,
        );
      }
      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("pointerlockchange", onPointerLock);
      renderer.domElement.removeEventListener("click", onCanvasClick);
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock?.();
      }
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry?.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => material?.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [snapshotRef]);

  useEffect(() => {
    resetTokenRef.current = resetToken;
  }, [resetToken]);

  useEffect(() => {
    teleportTokenRef.current = teleportToken;
  }, [teleportToken]);

  return <div ref={mountRef} className="storm-scene" aria-label="Mundo 3D" />;
}
