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

interface FunnelGeometryData {
  geometry: THREE.BufferGeometry;
  phases: Float32Array;
  heights: Float32Array;
  baseRadii: Float32Array;
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

const createFunnelGeometry = (): FunnelGeometryData => {
  const rings = 28;
  const segments = 34;
  const vertexCount = (rings + 1) * (segments + 1);
  const positions = new Float32Array(vertexCount * 3);
  const phases = new Float32Array(vertexCount);
  const heights = new Float32Array(vertexCount);
  const baseRadii = new Float32Array(vertexCount);
  const indices: number[] = [];
  let vertex = 0;

  for (let ring = 0; ring <= rings; ring += 1) {
    const height = ring / rings;
    for (let segment = 0; segment <= segments; segment += 1) {
      const phase = (segment / segments) * Math.PI * 2;
      const radius =
        3.2 +
        Math.pow(height, 0.72) * 30 +
        Math.sin(height * Math.PI * 5.2) * 1.8;
      positions[vertex * 3] = Math.cos(phase) * radius;
      positions[vertex * 3 + 1] = height * 128;
      positions[vertex * 3 + 2] = Math.sin(phase) * radius;
      phases[vertex] = phase;
      heights[vertex] = height;
      baseRadii[vertex] = radius;
      vertex += 1;
    }
  }

  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = ring * (segments + 1) + segment;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, phases, heights, baseRadii };
};

const createWorld = (scene: THREE.Scene) => {
  const random = seededRandom(12873);

  const hemisphere = new THREE.HemisphereLight(0xb9d1d4, 0x485438, 2.2);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffe5bc, 2.1);
  sun.position.set(-420, 560, 180);
  sun.castShadow = false;
  scene.add(sun);

  const skyUniforms = {
    storminess: { value: 0.1 },
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
        void main() {
          float h = normalize(vPosition).y * 0.5 + 0.5;
          vec3 horizon = mix(vec3(0.62, 0.72, 0.70), vec3(0.25, 0.32, 0.34), storminess);
          vec3 zenith = mix(vec3(0.20, 0.40, 0.52), vec3(0.055, 0.085, 0.11), storminess);
          float gradient = smoothstep(0.12, 0.86, h);
          vec3 color = mix(horizon, zenith, gradient);
          color += vec3(0.08, 0.055, 0.025) * pow(1.0 - h, 6.0);
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
  for (let index = 0; index < terrainPositions.count; index += 1) {
    const x = terrainPositions.getX(index);
    const y = terrainPositions.getY(index);
    const height =
      Math.sin(x * 0.006) * 2.4 +
      Math.cos(y * 0.008) * 1.8 +
      Math.sin((x + y) * 0.0035) * 2.6;
    terrainPositions.setZ(index, height);
  }
  terrainGeometry.computeVertexNormals();
  const terrain = new THREE.Mesh(
    terrainGeometry,
    new THREE.MeshStandardMaterial({
      color: 0x68804a,
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
  const cloudGeometry = new THREE.SphereGeometry(1, 10, 8);
  for (let index = 0; index < 72; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.pow(random(), 0.62) * 142;
    const upper = index > 48;
    const cloud = new THREE.Mesh(
      cloudGeometry,
      upper ? upperCloudMaterial : lowerCloudMaterial,
    );
    cloud.position.set(
      Math.cos(angle) * distance,
      upper ? 205 + random() * 74 : 134 + random() * 72,
      Math.sin(angle) * distance * 0.68,
    );
    const size = upper ? 32 + random() * 54 : 24 + random() * 42;
    cloud.scale.set(
      size * (1.1 + random() * 0.8),
      size * (upper ? 0.36 : 0.58),
      size,
    );
    cloudGroup.add(cloud);
  }
  for (let index = 0; index < 20; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = 18 + random() * 64;
    const wallCloud = new THREE.Mesh(cloudGeometry, lowerCloudMaterial);
    wallCloud.position.set(
      Math.cos(angle) * distance,
      115 + random() * 28,
      Math.sin(angle) * distance * 0.72,
    );
    const size = 22 + random() * 32;
    wallCloud.scale.set(size * 1.4, size * 0.42, size);
    cloudGroup.add(wallCloud);
  }
  scene.add(cloudGroup);

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
  const rainMaterial = new THREE.PointsMaterial({
    color: 0xa9c8cc,
    size: 1.1,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const rain = new THREE.Points(rainGeometry, rainMaterial);
  scene.add(rain);

  const funnelData = createFunnelGeometry();
  const funnelMaterial = new THREE.MeshStandardMaterial({
    color: 0x667173,
    roughness: 0.92,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const funnel = new THREE.Mesh(funnelData.geometry, funnelMaterial);
  funnel.visible = false;
  scene.add(funnel);

  const dustCount = 420;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let index = 0; index < dustCount; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 8 + Math.pow(random(), 0.55) * 42;
    dustPositions[index * 3] = Math.cos(angle) * radius;
    dustPositions[index * 3 + 1] = random() * 20;
    dustPositions[index * 3 + 2] = Math.sin(angle) * radius;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(dustPositions, 3),
  );
  const dustMaterial = new THREE.PointsMaterial({
    color: 0x8d7658,
    size: 3.2,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const dust = new THREE.Points(dustGeometry, dustMaterial);
  dust.visible = false;
  scene.add(dust);

  return {
    skyUniforms,
    hemisphere,
    sun,
    cloudGroup,
    upperCloudMaterial,
    lowerCloudMaterial,
    rain,
    rainGeometry,
    rainMaterial,
    funnel,
    funnelData,
    funnelMaterial,
    dust,
    dustMaterial,
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
    let frame = 0;
    let orbitAngle = -0.7;
    const clock = new THREE.Clock();
    const keys = new Set<string>();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const move = new THREE.Vector3();
    const stormTarget = new THREE.Vector3();

    const syncCameraEuler = () => {
      cameraEuler.setFromQuaternion(camera.quaternion, "YXZ");
    };

    const teleportToStorm = () => {
      const { x, z } = currentSnapshot.stormPosition;
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
      const storminess = THREE.MathUtils.lerp(
        world.skyUniforms.storminess.value,
        currentSnapshot.cloudCover * 0.88,
        1 - Math.exp(-delta * 0.8),
      );
      world.skyUniforms.storminess.value = storminess;
      world.hemisphere.intensity = 2.2 - storminess * 0.85;
      world.sun.intensity = 2.1 - storminess * 1.35;
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
      world.cloudGroup.rotation.y +=
        delta * (0.025 + currentSnapshot.tornadicPotential * 0.09);
      world.upperCloudMaterial.opacity =
        currentSnapshot.stormVisible
          ? 0.16 + currentSnapshot.cloudCover * 0.62
          : 0;
      world.lowerCloudMaterial.opacity =
        currentSnapshot.stormVisible
          ? 0.13 + currentSnapshot.cloudCover * 0.72
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

      world.rain.visible = currentSnapshot.rainIntensity > 0.03;
      world.rain.position.set(
        currentSnapshot.stormPosition.x + 42,
        0,
        currentSnapshot.stormPosition.z + 12,
      );
      world.rainMaterial.opacity = currentSnapshot.rainIntensity * 0.72;
      const rainPosition = world.rainGeometry.attributes
        .position as THREE.BufferAttribute;
      for (let index = 0; index < rainPosition.count; index += 1) {
        let y = rainPosition.getY(index) - delta * (145 + speedRef.current * 8);
        let x = rainPosition.getX(index) + delta * 11;
        if (y < 1) {
          y = 175 + Math.random() * 55;
          x = (Math.random() - 0.5) * 260;
        }
        rainPosition.setY(index, y);
        rainPosition.setX(index, x);
      }
      rainPosition.needsUpdate = true;

      const intensity =
        currentSnapshot.tornadoActive && currentSnapshot.tornadoWindKmh > 0
          ? THREE.MathUtils.clamp(
              (currentSnapshot.tornadoWindKmh - 120) / 250,
              0,
              1,
            )
          : 0;
      world.funnel.visible = currentSnapshot.funnelOpacity > 0.01;
      world.dust.visible = world.funnel.visible;
      world.funnel.position.set(
        currentSnapshot.stormPosition.x,
        1,
        currentSnapshot.stormPosition.z,
      );
      world.dust.position.set(
        currentSnapshot.stormPosition.x,
        1.5,
        currentSnapshot.stormPosition.z,
      );
      world.funnelMaterial.opacity =
        currentSnapshot.funnelOpacity * (0.48 + intensity * 0.3);
      world.funnelMaterial.color.setRGB(
        0.43 - intensity * 0.13,
        0.46 - intensity * 0.14,
        0.47 - intensity * 0.13,
      );
      world.dustMaterial.opacity =
        currentSnapshot.funnelOpacity * (0.28 + intensity * 0.48);
      world.dust.rotation.y -= delta * (0.9 + intensity * 2.2);
      world.dust.scale.setScalar(0.7 + intensity * 0.95);

      if (world.funnel.visible) {
        const position = world.funnelData.geometry.attributes
          .position as THREE.BufferAttribute;
        for (let index = 0; index < position.count; index += 1) {
          const height = world.funnelData.heights[index];
          const phase =
            world.funnelData.phases[index] +
            elapsed * (1.8 + intensity * 2.5) * (1.15 - height * 0.34);
          const ripple =
            1 +
            Math.sin(elapsed * 2.4 + height * 18 + phase * 2) *
              (0.035 + intensity * 0.035);
          const radius =
            world.funnelData.baseRadii[index] *
            ripple *
            (0.72 + intensity * 0.63);
          const wobble =
            Math.sin(elapsed * 0.8 + height * 7.5) *
            height *
            (3 + intensity * 6);
          position.setXYZ(
            index,
            Math.cos(phase) * radius + wobble,
            height * (118 + intensity * 22),
            Math.sin(phase) * radius +
              Math.cos(elapsed * 0.65 + height * 5) * height * 4,
          );
        }
        position.needsUpdate = true;
        if (frame % 4 === 0) world.funnelData.geometry.computeVertexNormals();
      }

      stormTarget.set(
        currentSnapshot.stormPosition.x,
        currentSnapshot.tornadoActive ? 68 : 138,
        currentSnapshot.stormPosition.z,
      );
      if (cameraModeRef.current === "seguir") {
        orbitAngle += delta * 0.085;
        const orbitRadius = 235;
        const desired = new THREE.Vector3(
          stormTarget.x + Math.cos(orbitAngle) * orbitRadius,
          92 + Math.sin(orbitAngle * 0.55) * 20,
          stormTarget.z + Math.sin(orbitAngle) * orbitRadius,
        );
        camera.position.lerp(desired, 1 - Math.exp(-delta * 1.8));
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
      frame += 1;
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
