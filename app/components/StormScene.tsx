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

const createTornadoVolumeGeometry = () => {
  const verticalSlices = 36;
  const radialSegments = 48;
  const vertexCount = (verticalSlices + 1) * (radialSegments + 1);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];
  let vertex = 0;

  for (let slice = 0; slice <= verticalSlices; slice += 1) {
    const height = slice / verticalSlices;
    for (let segment = 0; segment <= radialSegments; segment += 1) {
      const around = segment / radialSegments;
      const angle = around * Math.PI * 2;
      positions[vertex * 3] = Math.cos(angle);
      positions[vertex * 3 + 1] = height;
      positions[vertex * 3 + 2] = Math.sin(angle);
      uvs[vertex * 2] = around;
      uvs[vertex * 2 + 1] = height;
      vertex += 1;
    }
  }

  for (let slice = 0; slice < verticalSlices; slice += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const a = slice * (radialSegments + 1) + segment;
      const b = a + radialSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
};

const tornadoVertexShader = `
  uniform float time;
  uniform float intensity;
  uniform float baseRadius;
  uniform float topRadius;
  uniform float volumeHeight;
  uniform float radiusScale;

  varying float vHeight;
  varying float vAngle;
  varying float vTurbulence;
  varying vec3 vWorldPosition;

  void main() {
    float height = position.y;
    float angle = atan(position.z, position.x);
    float taper = mix(baseRadius, topRadius, pow(height, 0.68));
    float broadWave = sin(angle * 3.0 + height * 9.0 - time * 1.65);
    float fineWave = sin(angle * 7.0 - height * 15.0 + time * 2.35);
    float slowPulse = sin(height * 20.0 + time * 0.72);
    float turbulence =
      broadWave * 0.085 +
      fineWave * 0.038 +
      slowPulse * 0.022;
    float radius = taper * radiusScale * (1.0 + turbulence * (0.5 + intensity));

    vec3 transformed = vec3(
      cos(angle) * radius,
      height * volumeHeight,
      sin(angle) * radius
    );
    float sway = height * height * (2.5 + intensity * 5.5);
    transformed.x +=
      sin(time * 0.48 + height * 6.4) * sway +
      sin(time * 0.91 + height * 13.0) * sway * 0.22;
    transformed.z +=
      cos(time * 0.41 + height * 5.1) * sway * 0.72;

    vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
    vHeight = height;
    vAngle = angle;
    vTurbulence = broadWave * 0.55 + fineWave * 0.3 + slowPulse * 0.15;
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const tornadoFragmentShader = `
  uniform float time;
  uniform float intensity;
  uniform float condensation;
  uniform float innerCore;

  varying float vHeight;
  varying float vAngle;
  varying float vTurbulence;
  varying vec3 vWorldPosition;

  void main() {
    vec3 surfaceNormal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
    if (!gl_FrontFacing) surfaceNormal *= -1.0;
    vec3 lightDirection = normalize(vec3(-0.45, 0.82, 0.35));
    float light = 0.42 + max(dot(surfaceNormal, lightDirection), 0.0) * 0.48;

    float rotatingNoise =
      sin(vAngle * 4.0 + vTurbulence * 3.8 + vHeight * 19.0 - time * 1.2) *
        0.5 +
      sin(vAngle * 7.0 - vHeight * 31.0 + time * 0.58) * 0.22;
    float wisps = smoothstep(-0.62, 0.82, rotatingNoise);
    float groundConnection = smoothstep(0.0, 0.035, vHeight);
    float cloudBlend = 1.0 - smoothstep(0.965, 1.0, vHeight);
    float density = mix(0.68, 1.0, smoothstep(0.18, 0.88, vHeight));

    vec3 outerColor = mix(
      vec3(0.43, 0.46, 0.46),
      vec3(0.67, 0.7, 0.69),
      light
    );
    vec3 coreColor = vec3(0.16, 0.18, 0.18) * (0.78 + light * 0.22);
    vec3 color = mix(outerColor, coreColor, innerCore);
    float outerAlpha =
      condensation *
      groundConnection *
      cloudBlend *
      density *
      (0.7 + intensity * 0.3) *
      (0.68 + wisps * 0.32);
    float coreAlpha =
      condensation *
      groundConnection *
      cloudBlend *
      (0.42 + intensity * 0.3) *
      (0.72 + wisps * 0.28);
    float alpha = mix(outerAlpha, coreAlpha, innerCore);

    if (alpha < 0.018) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

const createTornadoVolumeMaterial = (innerCore: boolean) => {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      intensity: { value: 0 },
      condensation: { value: 0 },
      baseRadius: { value: 2 },
      topRadius: { value: 32 },
      volumeHeight: { value: 122 },
      radiusScale: { value: innerCore ? 0.43 : 1 },
      innerCore: { value: innerCore ? 1 : 0 },
    },
    vertexShader: tornadoVertexShader,
    fragmentShader: tornadoFragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: innerCore ? THREE.BackSide : THREE.FrontSide,
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
        void main() {
          float h = normalize(vPosition).y * 0.5 + 0.5;
          vec3 horizon = mix(vec3(0.62, 0.72, 0.70), vec3(0.34, 0.42, 0.43), storminess);
          vec3 zenith = mix(vec3(0.20, 0.40, 0.52), vec3(0.035, 0.06, 0.085), storminess);
          float gradient = smoothstep(0.12, 0.86, h);
          vec3 color = mix(horizon, zenith, gradient);
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
  const wallCloudGroup = new THREE.Group();
  const upperCloudMaterial = new THREE.MeshStandardMaterial({
    color: 0xc7d0ce,
    roughness: 1,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const lowerCloudMaterial = new THREE.MeshStandardMaterial({
    color: 0x667173,
    roughness: 1,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const wallCloudMaterial = new THREE.MeshStandardMaterial({
    color: 0x3d4648,
    roughness: 1,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const cloudGeometry = new THREE.SphereGeometry(1, 24, 16);
  for (let index = 0; index < 78; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.pow(random(), 0.62) * 142;
    const upper = index >= 44;
    const cloud = new THREE.Mesh(
      cloudGeometry,
      upper ? upperCloudMaterial : lowerCloudMaterial,
    );
    cloud.position.set(
      Math.cos(angle) * distance,
      upper ? 205 + random() * 74 : 134 + random() * 72,
      Math.sin(angle) * distance * 0.68,
    );
    const size = upper ? 18 + random() * 28 : 15 + random() * 25;
    cloud.scale.set(
      size * (1.08 + random() * 0.34),
      size * (upper ? 0.48 : 0.72),
      size,
    );
    if (upper) {
      anvilCloudGroup.add(cloud);
    } else {
      cloudGroup.add(cloud);
    }
  }
  const wallCloudGeometry = new THREE.SphereGeometry(1, 48, 24);
  const wallCloudPositions = wallCloudGeometry.getAttribute("position");
  for (let index = 0; index < wallCloudPositions.count; index += 1) {
    const x = wallCloudPositions.getX(index);
    const y = wallCloudPositions.getY(index);
    const z = wallCloudPositions.getZ(index);
    const angle = Math.atan2(z, x);
    const ripple =
      1 +
      Math.sin(angle * 3 + y * 5) * 0.1 +
      Math.sin(angle * 7 - y * 3) * 0.045;
    wallCloudPositions.setXYZ(index, x * ripple, y * (0.92 + ripple * 0.08), z * ripple);
  }
  wallCloudPositions.needsUpdate = true;
  wallCloudGeometry.computeVertexNormals();

  const wallCloudLayers = [
    { x: 0, y: 126, z: 0, width: 86, height: 21, depth: 64 },
    { x: -9, y: 117, z: 5, width: 58, height: 17, depth: 47 },
    { x: 12, y: 110, z: -8, width: 37, height: 12, depth: 31 },
  ];
  for (const layer of wallCloudLayers) {
    const wallCloud = new THREE.Mesh(wallCloudGeometry, wallCloudMaterial);
    wallCloud.position.set(layer.x, layer.y, layer.z);
    wallCloud.scale.set(layer.width, layer.height, layer.depth);
    wallCloudGroup.add(wallCloud);
  }
  const funnelCloudGroup = new THREE.Group();
  const funnelCloudLayers = [
    { x: 0, y: 119, z: 0, width: 42, height: 11, depth: 36 },
    { x: 5, y: 111, z: -3, width: 27, height: 9, depth: 24 },
  ];
  for (const layer of funnelCloudLayers) {
    const funnelCloud = new THREE.Mesh(wallCloudGeometry, wallCloudMaterial);
    funnelCloud.position.set(layer.x, layer.y, layer.z);
    funnelCloud.scale.set(layer.width, layer.height, layer.depth);
    funnelCloudGroup.add(funnelCloud);
  }
  cloudGroup.add(anvilCloudGroup, wallCloudGroup, funnelCloudGroup);
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
    rainPositions[index * 3] = (random() - 0.5) * 260;
    rainPositions[index * 3 + 1] = 8 + random() * 210;
    rainPositions[index * 3 + 2] = (random() - 0.5) * 190;
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

  const tornadoVolumeGeometry = createTornadoVolumeGeometry();
  const tornadoVolumeMaterial = createTornadoVolumeMaterial(false);
  const funnel = new THREE.Mesh(
    tornadoVolumeGeometry,
    tornadoVolumeMaterial,
  );
  funnel.visible = false;
  funnel.frustumCulled = false;
  funnel.renderOrder = 2;
  scene.add(funnel);

  const tornadoCoreMaterial = createTornadoVolumeMaterial(true);
  const tornadoCore = new THREE.Mesh(
    tornadoVolumeGeometry,
    tornadoCoreMaterial,
  );
  tornadoCore.visible = false;
  tornadoCore.frustumCulled = false;
  tornadoCore.renderOrder = 1;
  scene.add(tornadoCore);

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
    wallCloudGroup,
    funnelCloudGroup,
    cloudShadow,
    cloudShadowMaterial,
    upperCloudMaterial,
    lowerCloudMaterial,
    wallCloudMaterial,
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
    tornadoCore,
    tornadoCoreMaterial,
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
    const visualRandom = seededRandom(94821);
    const keys = new Set<string>();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const move = new THREE.Vector3();
    const stormTarget = new THREE.Vector3();
    const desiredCameraPosition = new THREE.Vector3();

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
      world.cloudGroup.scale.setScalar(
        0.38 + currentSnapshot.cloudCover * 0.82,
      );
      world.anvilCloudGroup.scale.set(
        1.04 + currentSnapshot.cloudCover * 0.28,
        0.78,
        1 + currentSnapshot.cloudCover * 0.14,
      );
      world.anvilCloudGroup.position.y =
        12 + currentSnapshot.cloudCover * 18;
      world.anvilCloudGroup.rotation.y += weatherDelta * 0.012;
      world.cloudGroup.rotation.y +=
        weatherDelta * (0.025 + currentSnapshot.tornadicPotential * 0.09);
      world.wallCloudGroup.rotation.y -=
        weatherDelta * (0.08 + currentSnapshot.groundCirculation * 0.2);
      world.wallCloudGroup.position.y =
        -currentSnapshot.tornadoIntensity * 12;
      world.wallCloudGroup.scale.set(
        1 + currentSnapshot.tornadoIntensity * 0.24,
        0.82 + currentSnapshot.tornadoIntensity * 0.34,
        1 + currentSnapshot.tornadoIntensity * 0.24,
      );
      world.funnelCloudGroup.visible = currentSnapshot.tornadoActive;
      world.funnelCloudGroup.position.set(
        currentSnapshot.tornadoPosition.x - currentSnapshot.stormPosition.x,
        -currentSnapshot.tornadoIntensity * 8,
        currentSnapshot.tornadoPosition.z - currentSnapshot.stormPosition.z,
      );
      world.funnelCloudGroup.scale.setScalar(
        0.78 + currentSnapshot.tornadoIntensity * 0.42,
      );
      world.funnelCloudGroup.rotation.y +=
        weatherDelta * (0.11 + currentSnapshot.tornadoIntensity * 0.18);
      world.stormLight.position.set(
        currentSnapshot.stormPosition.x - 28,
        135,
        currentSnapshot.stormPosition.z + 18,
      );
      world.stormLight.intensity = lightningFlash * 18;
      world.upperCloudMaterial.opacity =
        currentSnapshot.stormVisible
          ? 0.13 + currentSnapshot.cloudCover * 0.46
          : 0;
      world.lowerCloudMaterial.opacity =
        currentSnapshot.stormVisible
          ? 0.08 + currentSnapshot.cloudCover * 0.4
          : 0;
      world.wallCloudMaterial.opacity =
        currentSnapshot.stormVisible
          ? 0.28 + currentSnapshot.cloudCover * 0.5
          : 0;
      world.upperCloudMaterial.color.setRGB(
        0.78 - storminess * 0.25,
        0.82 - storminess * 0.28,
        0.81 - storminess * 0.25,
      );
      world.lowerCloudMaterial.color.setRGB(
        0.47 - storminess * 0.24,
        0.51 - storminess * 0.24,
        0.52 - storminess * 0.22,
      );
      world.wallCloudMaterial.color.setRGB(
        0.28 - storminess * 0.12,
        0.32 - storminess * 0.13,
        0.33 - storminess * 0.12,
      );
      world.cloudShadow.visible = currentSnapshot.stormVisible;
      world.cloudShadow.position.x = currentSnapshot.stormPosition.x + 18;
      world.cloudShadow.position.z = currentSnapshot.stormPosition.z + 12;
      world.cloudShadow.scale.setScalar(
        145 + currentSnapshot.cloudCover * 165,
      );
      world.cloudShadowMaterial.uniforms.opacity.value =
        currentSnapshot.cloudCover * 0.2 +
        currentSnapshot.rainIntensity * 0.12;

      world.rain.visible = currentSnapshot.rainIntensity > 0.03;
      world.rain.position.set(
        currentSnapshot.stormPosition.x + 42,
        0,
        currentSnapshot.stormPosition.z + 12,
      );
      world.rainMaterial.uniforms.opacity.value =
        currentSnapshot.rainIntensity * 0.62;
      world.rainMaterial.uniforms.pointSize.value =
        2.4 + currentSnapshot.rainIntensity * 1.2;
      const rainPosition = world.rainGeometry.attributes
        .position as THREE.BufferAttribute;
      if (world.rain.visible && weatherDelta > 0) {
        const vortexX =
          currentSnapshot.tornadoPosition.x - world.rain.position.x;
        const vortexZ =
          currentSnapshot.tornadoPosition.z - world.rain.position.z;
        const circulationRadius =
          28 +
          currentSnapshot.tornadoRadiusMeters * 2.2 +
          currentSnapshot.groundCirculation * 45;
        for (let index = 0; index < rainPosition.count; index += 1) {
          let y =
            rainPosition.getY(index) -
            weatherDelta * (145 + speedRef.current * 8);
          let x = rainPosition.getX(index) + weatherDelta * 11;
          let z = rainPosition.getZ(index);
          if (currentSnapshot.groundCirculation > 0.02 && y < 90) {
            const offsetX = x - vortexX;
            const offsetZ = z - vortexZ;
            const distance = Math.hypot(offsetX, offsetZ);
            if (distance < circulationRadius && distance > 1) {
              const turn =
                weatherDelta *
                currentSnapshot.groundCirculation *
                (2.8 - distance / circulationRadius);
              const cosine = Math.cos(turn);
              const sine = Math.sin(turn);
              x = vortexX + offsetX * cosine - offsetZ * sine;
              z = vortexZ + offsetX * sine + offsetZ * cosine;
            }
          }
          if (y < 1) {
            y = 175 + visualRandom() * 55;
            x = (visualRandom() - 0.5) * 260;
            z = (visualRandom() - 0.5) * 190;
          }
          rainPosition.setXYZ(index, x, y, z);
        }
        rainPosition.needsUpdate = true;
      }

      const intensity = currentSnapshot.tornadoIntensity;
      const { x: tornadoX, z: tornadoZ } = currentSnapshot.tornadoPosition;
      world.rainCurtain.visible =
        currentSnapshot.tornadoActive && currentSnapshot.rainIntensity > 0.08;
      world.rainCurtain.position.set(tornadoX, 0, tornadoZ);
      world.rainCurtainMaterial.uniforms.opacity.value =
        currentSnapshot.rainIntensity * (0.28 + intensity * 0.36);
      world.rainCurtainMaterial.uniforms.pointSize.value =
        2.8 + currentSnapshot.rainIntensity * 1.4;
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
      world.tornadoCore.visible = world.funnel.visible;
      world.condensation.visible = world.funnel.visible;
      world.dust.visible = currentSnapshot.debrisIntensity > 0.015;
      world.funnel.position.set(tornadoX, 1, tornadoZ);
      world.tornadoCore.position.copy(world.funnel.position);
      world.condensation.position.copy(world.funnel.position);
      world.dust.position.set(tornadoX, 1.5, tornadoZ);
      const baseRadius = THREE.MathUtils.clamp(
        currentSnapshot.tornadoRadiusMeters * 0.72,
        1.7,
        15,
      );
      const topRadius = THREE.MathUtils.clamp(
        27 + currentSnapshot.tornadoRadiusMeters * 2,
        30,
        68,
      );
      const volumeHeight = 112 + intensity * 25;
      for (const material of [
        world.tornadoVolumeMaterial,
        world.tornadoCoreMaterial,
      ]) {
        material.uniforms.time.value = elapsed;
        material.uniforms.intensity.value = intensity;
        material.uniforms.condensation.value =
          currentSnapshot.condensationOpacity;
        material.uniforms.baseRadius.value = baseRadius;
        material.uniforms.topRadius.value = topRadius;
        material.uniforms.volumeHeight.value = volumeHeight;
      }
      world.condensationMaterial.uniforms.opacity.value =
        currentSnapshot.condensationOpacity * (0.3 + intensity * 0.22);
      world.condensationMaterial.uniforms.pointSize.value =
        1.7 + intensity * 1.5;
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
              Math.pow(height, 0.68),
            ) *
            world.condensationRadii[index];
          const sway = height * height * (2.5 + intensity * 5.5);
          condensationPosition.setXYZ(
            index,
            Math.cos(phase) * funnelRadius +
              Math.sin(elapsed * 0.48 + height * 6.4) * sway,
            height * volumeHeight,
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
