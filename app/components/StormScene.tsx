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
      condensation: { value: 0 },
      baseRadiusRatio: { value: 0.04 },
      cloudBaseRatio: { value: 0.86 },
      storminess: { value: 0 },
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
      uniform float condensation;
      uniform float baseRadiusRatio;
      uniform float cloudBaseRatio;
      uniform float storminess;

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
          cloudDissolve;
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

        for (int index = 0; index < 30; index += 1) {
          vec3 point =
            cameraLocal +
            rayDirection * (rayStart + jitter + float(index) * stepLength);
          float density = funnelDensity(point);
          if (density > 0.01) {
            vec3 cloudColor = mix(
              vec3(0.33, 0.38, 0.39),
              vec3(0.2, 0.235, 0.24),
              storminess
            );
            vec3 sampleColor = cloudColor;
            sampleColor *=
              1.05 - density * (0.22 + storminess * 0.12);
            float sampleAlpha =
              (1.0 - exp(-density * stepLength * 12.0)) *
              condensation *
              (0.72 + intensity * 0.28);
            accumulated.rgb +=
              (1.0 - accumulated.a) * sampleColor * sampleAlpha;
            accumulated.a += (1.0 - accumulated.a) * sampleAlpha;
          }
          if (accumulated.a > 0.97) break;
        }

        if (accumulated.a < 0.015) discard;
        gl_FragColor = accumulated;
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
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

const createVortexParticleMaterial = (
  color: number,
  initialSize: number,
) =>
  new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(color) },
      opacity: { value: 0 },
      pointSize: { value: initialSize },
    },
    vertexShader: particleVertexShader,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
        float edge = 1.0 - smoothstep(0.38, 1.0, radius);
        if (edge < 0.02) discard;
        gl_FragColor = vec4(color, opacity * edge);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
  });

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
    cloudDeck: { value: 0 },
    time: { value: 0 },
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
        uniform float cloudDeck;
        uniform float time;

        float random2(vec2 point) {
          return fract(
            sin(dot(point, vec2(127.1, 311.7))) * 43758.5453
          );
        }

        float noise2(vec2 point) {
          vec2 cell = floor(point);
          vec2 blend = fract(point);
          blend = blend * blend * (3.0 - 2.0 * blend);
          return mix(
            mix(random2(cell), random2(cell + vec2(1.0, 0.0)), blend.x),
            mix(
              random2(cell + vec2(0.0, 1.0)),
              random2(cell + vec2(1.0, 1.0)),
              blend.x
            ),
            blend.y
          );
        }

        float deckNoise(vec2 point) {
          float detail = noise2(point);
          detail += noise2(point * 2.07 + 4.3) * 0.5;
          detail += noise2(point * 4.03 - 2.1) * 0.25;
          return detail / 1.75;
        }

        void main() {
          vec3 direction = normalize(vPosition);
          float h = direction.y * 0.5 + 0.5;
          vec3 horizon = mix(vec3(0.62, 0.72, 0.70), vec3(0.34, 0.42, 0.43), storminess);
          vec3 zenith = mix(vec3(0.20, 0.40, 0.52), vec3(0.035, 0.06, 0.085), storminess);
          float gradient = smoothstep(0.12, 0.86, h);
          vec3 color = mix(horizon, zenith, gradient);

          float deckGrowth = smoothstep(0.08, 0.62, cloudDeck);
          vec2 cloudCoordinates = vec2(
            atan(direction.z, direction.x) * 1.7,
            direction.y * 4.2
          );
          cloudCoordinates += vec2(time * 0.004, time * -0.0025);
          float broadCloud = deckNoise(cloudCoordinates * 1.35);
          float fineCloud = noise2(cloudCoordinates * 5.2 + 8.4);
          float brokenCoverage = smoothstep(
            mix(0.72, 0.38, deckGrowth),
            mix(0.88, 0.6, deckGrowth),
            broadCloud
          );
          float solidCoverage =
            smoothstep(0.58, 0.92, deckGrowth) *
            (0.78 + broadCloud * 0.22);
          float overheadMask = smoothstep(-0.16, 0.16, direction.y);
          float deckMask =
            max(brokenCoverage, solidCoverage) *
            deckGrowth *
            overheadMask;
          vec3 cloudLight = vec3(0.43, 0.48, 0.49);
          vec3 cloudDark = vec3(0.105, 0.13, 0.145);
          float undersideShade = clamp(
            storminess * 0.72 +
              (1.0 - direction.y) * 0.2 +
              (1.0 - broadCloud) * 0.24,
            0.0,
            1.0
          );
          vec3 deckColor = mix(cloudLight, cloudDark, undersideShade);
          deckColor *= 0.92 + fineCloud * 0.12;
          color = mix(color, deckColor, clamp(deckMask, 0.0, 0.96));

          color += vec3(0.08, 0.055, 0.025) * pow(1.0 - h, 6.0);
          color += vec3(0.18, 0.22, 0.27) * lightning * (1.0 - gradient * 0.6);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    }),
  );
  scene.add(sky);

  const terrainGeometry = new THREE.PlaneGeometry(
    WORLD_CONFIG.visualRadius * 1.55,
    WORLD_CONFIG.visualRadius * 1.55,
    54,
    54,
  );
  const terrainPositions = terrainGeometry.attributes.position;
  const terrainColors = new Float32Array(terrainPositions.count * 3);
  const terrainColor = new THREE.Color();
  for (let index = 0; index < terrainPositions.count; index += 1) {
    const x = terrainPositions.getX(index);
    const y = terrainPositions.getY(index);
    const height =
      Math.sin(x * 0.006) * 2.4 +
      Math.cos(y * 0.008) * 1.8 +
      Math.sin((x + y) * 0.0035) * 2.6;
    terrainPositions.setZ(index, height);
    const fieldVariation =
      Math.sin(x * 0.012) * 0.5 + Math.cos(y * 0.015) * 0.5;
    terrainColor
      .set(fieldVariation > 0.18 ? 0x718950 : 0x5e7845)
      .offsetHSL(0, 0, height * 0.004 + (random() - 0.5) * 0.035);
    terrainColors[index * 3] = terrainColor.r;
    terrainColors[index * 3 + 1] = terrainColor.g;
    terrainColors[index * 3 + 2] = terrainColor.b;
  }
  terrainGeometry.setAttribute(
    "color",
    new THREE.BufferAttribute(terrainColors, 3),
  );
  terrainGeometry.computeVertexNormals();
  const terrain = new THREE.Mesh(
    terrainGeometry,
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    }),
  );
  terrain.rotation.x = -Math.PI / 2;
  terrain.receiveShadow = false;
  scene.add(terrain);

  const fieldGroup = new THREE.Group();
  const fieldColors = [
    0x78894a, 0x9a8845, 0x667c3f, 0x9c9b61, 0x806a39, 0x708c56,
  ];
  for (let index = 0; index < 34; index += 1) {
    const width = 95 + random() * 185;
    const depth = 80 + random() * 155;
    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshStandardMaterial({
        color: fieldColors[index % fieldColors.length],
        roughness: 1,
      }),
    );
    field.rotation.x = -Math.PI / 2;
    field.rotation.z = (random() - 0.5) * 0.2;
    field.position.set(
      (random() - 0.5) * 1750,
      0.8 + random() * 0.3,
      (random() - 0.5) * 1500,
    );
    fieldGroup.add(field);
  }
  scene.add(fieldGroup);

  const roadMaterial = new THREE.MeshStandardMaterial({
    color: 0x4b4d48,
    roughness: 0.98,
  });
  const roadA = new THREE.Mesh(new THREE.PlaneGeometry(34, 1500), roadMaterial);
  roadA.rotation.x = -Math.PI / 2;
  roadA.rotation.z = 0.04;
  roadA.position.set(105, 1.15, 25);
  scene.add(roadA);
  const roadB = new THREE.Mesh(new THREE.PlaneGeometry(1120, 22), roadMaterial);
  roadB.rotation.x = -Math.PI / 2;
  roadB.rotation.z = -0.035;
  roadB.position.set(-20, 1.2, 135);
  scene.add(roadB);

  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xd5bd70 });
  const lineA = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1490), lineMaterial);
  lineA.rotation.x = -Math.PI / 2;
  lineA.rotation.z = 0.04;
  lineA.position.set(105, 1.25, 25);
  scene.add(lineA);

  const structures = new THREE.Group();
  const wallPalette = [0xd8d0b7, 0xb7c1b2, 0xc9a986, 0xe0ded1, 0x9eaaa0];
  const addBuilding = (
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    color: number,
  ) => {
    const building = new THREE.Group();
    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color, roughness: 0.95 }),
    );
    walls.position.y = height / 2 + 1;
    building.add(walls);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(width, depth) * 0.72, 5.5, 4),
      new THREE.MeshStandardMaterial({ color: 0x704b38, roughness: 1 }),
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.y = height + 3.4;
    building.add(roof);
    building.position.set(x, 0, z);
    structures.add(building);
  };

  for (let index = 0; index < 18; index += 1) {
    const row = Math.floor(index / 6);
    const column = index % 6;
    addBuilding(
      165 + column * 27 + (row % 2) * 8,
      176 + row * 31,
      13 + random() * 5,
      11 + random() * 5,
      8 + random() * 3,
      wallPalette[index % wallPalette.length],
    );
  }
  addBuilding(-310, 95, 36, 24, 13, 0xd4c19b);
  addBuilding(-350, 128, 19, 17, 9, 0xc8d0c1);
  addBuilding(390, -230, 42, 27, 14, 0xbda77f);
  addBuilding(430, -205, 17, 16, 9, 0xd6d0bd);
  scene.add(structures);

  const siloMaterial = new THREE.MeshStandardMaterial({
    color: 0xaab4b2,
    roughness: 0.72,
    metalness: 0.25,
  });
  for (const [x, z] of [
    [-286, 118],
    [418, -248],
  ]) {
    const silo = new THREE.Mesh(
      new THREE.CylinderGeometry(7, 7.8, 25, 12),
      siloMaterial,
    );
    silo.position.set(x, 13, z);
    scene.add(silo);
  }

  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x4e3c2b,
    roughness: 1,
  });
  const poleGroup = new THREE.Group();
  const wirePoints: THREE.Vector3[][] = [[], [], []];
  for (let index = -9; index <= 9; index += 1) {
    const z = index * 68;
    const x = 128 + z * -0.04;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 1, 20, 7),
      poleMaterial,
    );
    pole.position.set(x, 10.5, z);
    poleGroup.add(pole);
    const crossbar = new THREE.Mesh(
      new THREE.BoxGeometry(12, 0.9, 0.9),
      poleMaterial,
    );
    crossbar.position.set(x, 19.5, z);
    poleGroup.add(crossbar);
    wirePoints[0].push(new THREE.Vector3(x - 5, 19.6, z));
    wirePoints[1].push(new THREE.Vector3(x, 20.4, z));
    wirePoints[2].push(new THREE.Vector3(x + 5, 19.6, z));
  }
  const wireMaterial = new THREE.LineBasicMaterial({
    color: 0x302b25,
    transparent: true,
    opacity: 0.8,
  });
  for (const points of wirePoints) {
    poleGroup.add(
      new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), wireMaterial),
    );
  }
  scene.add(poleGroup);

  const cloudGroup = new THREE.Group();
  const anvilCloudGroup = new THREE.Group();
  const cloudVolumeMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
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
  const cloudVolume = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    cloudVolumeMaterial,
  );
  cloudVolume.position.set(0, 158, 0);
  cloudVolume.scale.set(350, 280, 245);
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

  const rainCurtainCount = 780;
  const rainCurtainPositions = new Float32Array(rainCurtainCount * 3);
  const rainCurtainPhases = new Float32Array(rainCurtainCount);
  const rainCurtainRadii = new Float32Array(rainCurtainCount);
  const rainCurtainHeights = new Float32Array(rainCurtainCount);
  const rainCurtainSpeeds = new Float32Array(rainCurtainCount);
  for (let index = 0; index < rainCurtainCount; index += 1) {
    rainCurtainPhases[index] = -1.9 + random() * 2.8;
    rainCurtainRadii[index] = 20 + random() * 54;
    rainCurtainHeights[index] = random();
    rainCurtainSpeeds[index] = 0.7 + random() * 0.65;
  }
  const rainCurtainGeometry = new THREE.BufferGeometry();
  rainCurtainGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(rainCurtainPositions, 3),
  );
  const rainCurtainMaterial = createRainMaterial();
  rainCurtainMaterial.uniforms.color.value.set(0x91b0b5);
  const rainCurtain = new THREE.Points(rainCurtainGeometry, rainCurtainMaterial);
  rainCurtain.visible = false;
  rainCurtain.renderOrder = 3;
  scene.add(rainCurtain);

  const tornadoVolumeMaterial = createTornadoVolumeMaterial();
  const funnel = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    tornadoVolumeMaterial,
  );
  funnel.visible = false;
  funnel.frustumCulled = false;
  funnel.renderOrder = 2;
  scene.add(funnel);

  const condensationCount = 420;
  const condensationPositions = new Float32Array(condensationCount * 3);
  const condensationPhases = new Float32Array(condensationCount);
  const condensationHeights = new Float32Array(condensationCount);
  const condensationRadii = new Float32Array(condensationCount);
  const condensationSpeeds = new Float32Array(condensationCount);
  for (let index = 0; index < condensationCount; index += 1) {
    condensationPhases[index] = random() * Math.PI * 2;
    condensationHeights[index] = Math.pow(random(), 0.82);
    condensationRadii[index] = 0.7 + random() * 0.42;
    condensationSpeeds[index] = 0.72 + random() * 0.72;
  }
  const condensationGeometry = new THREE.BufferGeometry();
  condensationGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(condensationPositions, 3),
  );
  const condensationMaterial = createVortexParticleMaterial(0xc3ccca, 2.8);
  const condensation = new THREE.Points(
    condensationGeometry,
    condensationMaterial,
  );
  condensation.visible = false;
  condensation.renderOrder = 3;
  scene.add(condensation);

  const dustCount = 320;
  const dustPositions = new Float32Array(dustCount * 3);
  const dustPhases = new Float32Array(dustCount);
  const dustRadii = new Float32Array(dustCount);
  const dustHeights = new Float32Array(dustCount);
  const dustSpeeds = new Float32Array(dustCount);
  for (let index = 0; index < dustCount; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 3 + Math.pow(random(), 0.62) * 23;
    dustPhases[index] = angle;
    dustRadii[index] = radius;
    dustHeights[index] = random();
    dustSpeeds[index] = 0.65 + random() * 1.6;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(dustPositions, 3),
  );
  const dustMaterial = createVortexParticleMaterial(0x715b42, 3.2);
  const dust = new THREE.Points(dustGeometry, dustMaterial);
  dust.visible = false;
  dust.renderOrder = 4;
  scene.add(dust);

  return {
    skyUniforms,
    hemisphere,
    sun,
    stormLight,
    cloudGroup,
    anvilCloudGroup,
    cloudShadow,
    cloudShadowMaterial,
    cloudVolume,
    cloudVolumeMaterial,
    rain,
    rainGeometry,
    rainMaterial,
    rainCurtain,
    rainCurtainGeometry,
    rainCurtainMaterial,
    rainCurtainPhases,
    rainCurtainRadii,
    rainCurtainHeights,
    rainCurtainSpeeds,
    funnel,
    tornadoVolumeMaterial,
    condensation,
    condensationGeometry,
    condensationMaterial,
    condensationPhases,
    condensationHeights,
    condensationRadii,
    condensationSpeeds,
    dust,
    dustGeometry,
    dustMaterial,
    dustPhases,
    dustRadii,
    dustHeights,
    dustSpeeds,
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
      world.skyUniforms.cloudDeck.value = currentSnapshot.cloudCover;
      world.skyUniforms.time.value = elapsed;
      world.hemisphere.intensity = 2.2 - storminess * 0.85;
      world.sun.intensity = 2.1 - storminess * 1.35 + lightningFlash * 0.8;
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
      renderer.toneMappingExposure = 1.08 - storminess * 0.2 + lightningFlash * 0.16;
      if (scene.fog instanceof THREE.FogExp2) {
        scene.fog.density =
          0.00048 + storminess * 0.00055 + currentSnapshot.rainIntensity * 0.00035;
        scene.fog.color.setRGB(
          0.54 - storminess * 0.24,
          0.61 - storminess * 0.25,
          0.58 - storminess * 0.24,
        );
      }

      world.cloudGroup.visible = currentSnapshot.stormVisible;
      world.cloudGroup.position.set(
        currentSnapshot.stormPosition.x,
        0,
        currentSnapshot.stormPosition.z,
      );
      const horizontalCloudScale =
        0.38 + currentSnapshot.cloudCover * 0.82;
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
      const cloudScale = world.cloudGroup.scale.y;
      const cloudBaseHeight =
        cloudScale *
        (world.anvilCloudGroup.position.y +
          world.anvilCloudGroup.scale.y *
            (world.cloudVolume.position.y +
              world.cloudVolumeMaterial.uniforms.cloudProfileA.value.x *
                world.cloudVolume.scale.y));
      world.stormLight.position.set(
        currentSnapshot.stormPosition.x - 28,
        135,
        currentSnapshot.stormPosition.z + 18,
      );
      world.stormLight.intensity = lightningFlash * 18;
      world.cloudVolumeMaterial.uniforms.time.value = elapsed;
      world.cloudVolumeMaterial.uniforms.storminess.value = storminess;
      world.cloudVolumeMaterial.uniforms.opacity.value =
        currentSnapshot.stormVisible
          ? 0.68 + currentSnapshot.cloudCover * 0.28
          : 0;
      world.cloudShadow.visible = currentSnapshot.stormVisible;
      world.cloudShadow.position.x = currentSnapshot.stormPosition.x + 18;
      world.cloudShadow.position.z = currentSnapshot.stormPosition.z + 12;
      world.cloudShadow.scale.setScalar(
        145 + currentSnapshot.cloudCover * 165,
      );
      world.cloudShadowMaterial.uniforms.opacity.value =
        currentSnapshot.cloudCover * 0.2 +
        currentSnapshot.rainIntensity * 0.12;

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
      world.rainCurtain.visible =
        currentSnapshot.stormVisible &&
        currentSnapshot.supercell.rfdIntensity > 0.03;
      const rfdBlend = currentSnapshot.supercell.hookStrength * 0.55;
      world.rainCurtain.position.set(
        THREE.MathUtils.lerp(
          currentSnapshot.supercell.rfdPosition.x,
          currentSnapshot.supercell.mesocyclonePosition.x,
          rfdBlend,
        ),
        0,
        THREE.MathUtils.lerp(
          currentSnapshot.supercell.rfdPosition.z,
          currentSnapshot.supercell.mesocyclonePosition.z,
          rfdBlend,
        ),
      );
      world.rainCurtain.rotation.y =
        currentSnapshot.supercell.tailCloudDirectionRadians;
      world.rainCurtainMaterial.uniforms.opacity.value =
        currentSnapshot.supercell.rfdIntensity *
        (0.2 + currentSnapshot.supercell.hookStrength * 0.42);
      world.rainCurtainMaterial.uniforms.pointSize.value =
        2.2 + currentSnapshot.supercell.rfdIntensity * 1.5;
      if (world.rainCurtain.visible) {
        const rainCurtainPosition = world.rainCurtainGeometry.attributes
          .position as THREE.BufferAttribute;
        for (let index = 0; index < rainCurtainPosition.count; index += 1) {
          const phase =
            world.rainCurtainPhases[index] +
            elapsed * world.rainCurtainSpeeds[index] * (0.22 + intensity * 0.48);
          const radius =
            world.rainCurtainRadii[index] * (0.82 + intensity * 0.22);
          const fall =
            (world.rainCurtainHeights[index] -
              elapsed * world.rainCurtainSpeeds[index] * 0.34) %
            1;
          const height = (fall < 0 ? fall + 1 : fall) * 105 + 4;
          rainCurtainPosition.setXYZ(
            index,
            Math.cos(phase) * radius,
            height,
            Math.sin(phase) * radius * 0.78,
          );
        }
        rainCurtainPosition.needsUpdate = true;
      }
      world.funnel.visible = currentSnapshot.condensationOpacity > 0.01;
      world.condensation.visible = world.funnel.visible;
      world.dust.visible = currentSnapshot.debrisIntensity > 0.015;
      world.condensation.position.set(tornadoX, 1, tornadoZ);
      world.dust.position.set(tornadoX, 1.5, tornadoZ);
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
        topRadius * 0.45,
        10,
        20,
      );
      const volumeHeight = funnelHeight + connectionOverlap;
      world.funnel.position.set(tornadoX, 1 + volumeHeight * 0.5, tornadoZ);
      world.funnel.scale.set(
        topRadius * 2.6,
        volumeHeight,
        topRadius * 2.6,
      );
      world.tornadoVolumeMaterial.uniforms.time.value = elapsed;
      world.tornadoVolumeMaterial.uniforms.intensity.value = intensity;
      world.tornadoVolumeMaterial.uniforms.condensation.value =
        currentSnapshot.condensationOpacity;
      world.tornadoVolumeMaterial.uniforms.baseRadiusRatio.value =
        baseRadius / (topRadius * 2.6);
      world.tornadoVolumeMaterial.uniforms.cloudBaseRatio.value =
        funnelHeight / volumeHeight;
      world.tornadoVolumeMaterial.uniforms.storminess.value = storminess;
      world.condensationMaterial.uniforms.opacity.value =
        currentSnapshot.condensationOpacity * (0.08 + intensity * 0.08);
      world.condensationMaterial.uniforms.pointSize.value =
        1.15 + intensity * 0.65;
      world.dustMaterial.uniforms.opacity.value =
        currentSnapshot.debrisIntensity * (0.44 + intensity * 0.42);
      world.dustMaterial.uniforms.pointSize.value =
        2.1 + intensity * 2.2;

      if (world.funnel.visible) {
        const condensationPosition = world.condensationGeometry.attributes
          .position as THREE.BufferAttribute;
        for (let index = 0; index < condensationPosition.count; index += 1) {
          const height = world.condensationHeights[index];
          const phase =
            world.condensationPhases[index] +
            elapsed *
              world.condensationSpeeds[index] *
              (2.2 + intensity * 2.4) *
              (1.1 - height * 0.28);
          const funnelRadius =
            THREE.MathUtils.lerp(
              baseRadius,
              topRadius,
              Math.pow(height, 1.12),
            ) *
            world.condensationRadii[index];
          const sway = height * height * (2.5 + intensity * 5.5);
          condensationPosition.setXYZ(
            index,
            Math.cos(phase) * funnelRadius +
              Math.sin(elapsed * 0.48 + height * 6.4) * sway,
            height * funnelHeight,
            Math.sin(phase) * funnelRadius +
              Math.cos(elapsed * 0.41 + height * 5.1) * sway * 0.72,
          );
        }
        condensationPosition.needsUpdate = true;
      }

      if (world.dust.visible) {
        const dustPosition = world.dustGeometry.attributes
          .position as THREE.BufferAttribute;
        for (let index = 0; index < dustPosition.count; index += 1) {
          const phase =
            world.dustPhases[index] +
            elapsed *
              world.dustSpeeds[index] *
              (0.9 + intensity * 3.2);
          const radius = Math.min(
            world.dustRadii[index] *
              (0.44 + currentSnapshot.groundCirculation * 0.72 + intensity * 0.16),
            32,
          );
          const risingHeight =
            (world.dustHeights[index] +
              elapsed * world.dustSpeeds[index] * 0.045) %
            1;
          dustPosition.setXYZ(
            index,
            Math.cos(phase) * radius,
            risingHeight * Math.min(23, 5 + currentSnapshot.debrisIntensity * 16 + intensity * 5),
            Math.sin(phase) * radius,
          );
        }
        dustPosition.needsUpdate = true;
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
