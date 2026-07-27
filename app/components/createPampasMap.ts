import * as THREE from "three";
import { WORLD_CONFIG } from "../game/config";

type RandomSource = () => number;

const terrainHeightAt = (x: number, z: number) =>
  Math.sin(x * 0.0038) * 1.35 +
  Math.cos(z * 0.0046) * 1.05 +
  Math.sin((x + z) * 0.0021) * 0.8;

const groundMaterial = (color: number) =>
  new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });

const createTerrainPatch = (
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
  rotation: number,
  yOffset: number,
  material: THREE.Material,
  widthSegments = 10,
  depthSegments = 8,
) => {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let zIndex = 0; zIndex <= depthSegments; zIndex += 1) {
    const localZ = (zIndex / depthSegments - 0.5) * depth;
    for (let xIndex = 0; xIndex <= widthSegments; xIndex += 1) {
      const localX = (xIndex / widthSegments - 0.5) * width;
      const x =
        centerX +
        Math.cos(rotation) * localX +
        Math.sin(rotation) * localZ;
      const z =
        centerZ -
        Math.sin(rotation) * localX +
        Math.cos(rotation) * localZ;
      positions.push(x, terrainHeightAt(x, z) + yOffset, z);
    }
  }

  const rowWidth = widthSegments + 1;
  for (let zIndex = 0; zIndex < depthSegments; zIndex += 1) {
    for (let xIndex = 0; xIndex < widthSegments; xIndex += 1) {
      const start = zIndex * rowWidth + xIndex;
      indices.push(
        start,
        start + rowWidth,
        start + 1,
        start + 1,
        start + rowWidth,
        start + rowWidth + 1,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
};

const createTerrainPolygon = (
  points: THREE.Vector2[],
  yOffset: number,
  material: THREE.Material,
) => {
  const triangles = THREE.ShapeUtils.triangulateShape(points, []);
  const positions = points.flatMap(({ x, y: z }) => [
    x,
    terrainHeightAt(x, z) + yOffset,
    z,
  ]);
  const indices: number[] = [];
  for (const triangle of triangles) {
    const [first, second, third] = triangle;
    const a = new THREE.Vector3().fromArray(positions, first * 3);
    const b = new THREE.Vector3().fromArray(positions, second * 3);
    const c = new THREE.Vector3().fromArray(positions, third * 3);
    const normalY = b.clone().sub(a).cross(c.clone().sub(a)).y;
    indices.push(
      first,
      normalY >= 0 ? second : third,
      normalY >= 0 ? third : second,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
};

const createGroundRibbon = (
  points: THREE.Vector3[],
  width: number | ((progress: number) => number),
  yOffset: number,
  material: THREE.Material,
  segments = 96,
) => {
  const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.18);
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];

  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments;
    const center = curve.getPointAt(progress);
    const tangent = curve.getTangentAt(progress).normalize();
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const widthAtProgress =
      typeof width === "number" ? width : width(progress);
    for (const direction of [-1, 1]) {
      const x = center.x + side.x * widthAtProgress * 0.5 * direction;
      const z = center.z + side.z * widthAtProgress * 0.5 * direction;
      positions.push(x, terrainHeightAt(x, z) + yOffset, z);
      uvs.push(direction < 0 ? 0 : 1, progress);
    }
    if (index < segments) {
      const start = index * 2;
      indices.push(
        start,
        start + 1,
        start + 2,
        start + 2,
        start + 1,
        start + 3,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { mesh: new THREE.Mesh(geometry, material), curve };
};

const offsetGroundPath = (points: THREE.Vector3[], offset: number) =>
  points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const tangent = next.clone().sub(previous).normalize();
    return new THREE.Vector3(
      point.x - tangent.z * offset,
      0,
      point.z + tangent.x * offset,
    );
  });

const createGabledRoofGeometry = (
  width: number,
  depth: number,
  height: number,
) => {
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -halfWidth, 0, -halfDepth,
        halfWidth, 0, -halfDepth,
        -halfWidth, 0, halfDepth,
        halfWidth, 0, halfDepth,
        -halfWidth, height, 0,
        halfWidth, height, 0,
      ],
      3,
    ),
  );
  geometry.setIndex([
    0, 1, 5, 0, 5, 4,
    2, 4, 5, 2, 5, 3,
    0, 4, 2,
    1, 3, 5,
  ]);
  geometry.computeVertexNormals();
  return geometry;
};

const townBuildings: Array<
  [number, number, number, number, number, number, number, number]
> = [
  [205, 270, 15, 12, 9, 0xd8d0b7, Math.PI / 2, 0],
  [205, 350, 16, 12, 9, 0xb7c1b2, Math.PI / 2, 1],
  [205, 400, 14, 11, 8.5, 0xc9a986, Math.PI / 2, 2],
  [455, 280, 15, 12, 9, 0xe0ded1, -Math.PI / 2, 1],
  [455, 350, 17, 13, 10, 0x9eaaa0, -Math.PI / 2, 2],
  [455, 400, 14, 11, 8.5, 0xd8d0b7, -Math.PI / 2, 0],
  [278, 475, 16, 12, 9, 0xb7c1b2, Math.PI, 1],
  [395, 475, 16, 12, 9, 0xc9a986, Math.PI, 2],
  [300, 273, 15, 12, 9, 0xe0ded1, 0, 0],
  [365, 276, 16, 12, 9, 0x9eaaa0, 0, 1],
  [334, 454, 31, 18, 12, 0xd8d2bd, Math.PI, 2],
];

const townTreePositions: Array<[number, number, number]> = [
  [180, 290, 0.9],
  [180, 370, 1.05],
  [225, 375, 0.8],
  [182, 438, 1.1],
  [480, 305, 0.85],
  [482, 372, 1.05],
  [478, 438, 0.95],
  [250, 495, 1.1],
  [420, 495, 0.9],
  [296, 338, 0.75],
  [368, 338, 0.82],
  [297, 399, 0.78],
  [368, 399, 0.86],
  [332, 368, 1.25],
];

const addFields = (map: THREE.Group) => {
  const fieldColors = [
    0x82925a, 0xa39a5d, 0x73894d, 0x9b8c4f, 0x6b8248, 0x927443,
  ];
  const layouts: Array<[number, number, number, number, number, number]> = [
    [-620, -565, 390, 300, -0.08, 0],
    [-275, -610, 210, 230, 0.04, 1],
    [265, -610, 350, 250, -0.04, 2],
    [660, -560, 350, 310, 0.06, 3],
    [-665, -205, 300, 245, 0.05, 4],
    [-345, -240, 250, 190, -0.06, 2],
    [265, -250, 220, 190, 0.07, 5],
    [720, -175, 240, 220, -0.03, 1],
    [-675, 335, 310, 160, -0.04, 3],
    [-330, 350, 260, 260, 0.08, 0],
    [650, 455, 300, 180, -0.08, 4],
    [-620, 635, 390, 270, 0.03, 2],
    [-185, 665, 310, 245, -0.05, 5],
    [250, 675, 320, 240, 0.05, 0],
    [650, 660, 340, 260, -0.03, 1],
  ];
  const borderMaterial = groundMaterial(0x5a7048);
  const cropMaterials = fieldColors.map(groundMaterial);
  const rowMaterial = groundMaterial(0x6a7749);

  for (const [x, z, width, depth, angle, colorIndex] of layouts) {
    const border = createTerrainPatch(
      x,
      z,
      width + 5,
      depth + 5,
      angle,
      0.12,
      borderMaterial,
    );
    map.add(border);

    const crop = createTerrainPatch(
      x,
      z,
      width,
      depth,
      angle,
      0.2,
      cropMaterials[colorIndex],
    );
    map.add(crop);

    const trackCount = Math.max(5, Math.floor(depth / 24));
    for (let track = 1; track < trackCount; track += 1) {
      const offset = -depth * 0.5 + (track / trackCount) * depth;
      const trackX = x + Math.sin(angle) * offset;
      const trackZ = z + Math.cos(angle) * offset;
      const trackMesh = createTerrainPatch(
        trackX,
        trackZ,
        width * 0.94,
        0.28,
        angle,
        0.3,
        rowMaterial,
        10,
        1,
      );
      map.add(trackMesh);
    }
  }
};

const addFarmGrounds = (map: THREE.Group) => {
  const wornEdgeMaterial = groundMaterial(0x6f7152);
  const yardMaterial = groundMaterial(0x887a61);
  const workAreaMaterial = groundMaterial(0x98876a);
  const residenceMaterial = groundMaterial(0x6f8457);

  map.add(
    createTerrainPolygon(
      [
        new THREE.Vector2(-508, 52),
        new THREE.Vector2(-480, 37),
        new THREE.Vector2(-392, 39),
        new THREE.Vector2(-348, 62),
        new THREE.Vector2(-346, 112),
        new THREE.Vector2(-378, 139),
        new THREE.Vector2(-472, 143),
        new THREE.Vector2(-510, 116),
      ],
      0.18,
      wornEdgeMaterial,
    ),
    createTerrainPolygon(
      [
        new THREE.Vector2(-499, 57),
        new THREE.Vector2(-475, 45),
        new THREE.Vector2(-397, 47),
        new THREE.Vector2(-355, 67),
        new THREE.Vector2(-355, 107),
        new THREE.Vector2(-382, 132),
        new THREE.Vector2(-468, 135),
        new THREE.Vector2(-500, 111),
      ],
      0.24,
      yardMaterial,
    ),
    createTerrainPolygon(
      [
        new THREE.Vector2(-488, 89),
        new THREE.Vector2(-455, 69),
        new THREE.Vector2(-407, 74),
        new THREE.Vector2(-390, 101),
        new THREE.Vector2(-413, 126),
        new THREE.Vector2(-470, 125),
      ],
      0.3,
      workAreaMaterial,
    ),
    createTerrainPolygon(
      [
        new THREE.Vector2(-410, 43),
        new THREE.Vector2(-348, 51),
        new THREE.Vector2(-344, 105),
        new THREE.Vector2(-372, 119),
        new THREE.Vector2(-407, 103),
      ],
      0.31,
      residenceMaterial,
    ),
    createTerrainPolygon(
      [
        new THREE.Vector2(405, -326),
        new THREE.Vector2(438, -345),
        new THREE.Vector2(535, -340),
        new THREE.Vector2(572, -307),
        new THREE.Vector2(568, -219),
        new THREE.Vector2(530, -195),
        new THREE.Vector2(430, -202),
        new THREE.Vector2(398, -240),
      ],
      0.18,
      wornEdgeMaterial,
    ),
    createTerrainPolygon(
      [
        new THREE.Vector2(413, -319),
        new THREE.Vector2(442, -337),
        new THREE.Vector2(529, -331),
        new THREE.Vector2(563, -302),
        new THREE.Vector2(559, -226),
        new THREE.Vector2(525, -204),
        new THREE.Vector2(435, -211),
        new THREE.Vector2(407, -244),
      ],
      0.24,
      yardMaterial,
    ),
    createTerrainPolygon(
      [
        new THREE.Vector2(430, -306),
        new THREE.Vector2(486, -325),
        new THREE.Vector2(540, -302),
        new THREE.Vector2(543, -247),
        new THREE.Vector2(506, -222),
        new THREE.Vector2(447, -232),
      ],
      0.3,
      workAreaMaterial,
    ),
  );
};

const addRoads = (map: THREE.Group) => {
  const mainRoadPoints = [
    new THREE.Vector3(-175, 0, -920),
    new THREE.Vector3(-145, 0, -590),
    new THREE.Vector3(-88, 0, -310),
    new THREE.Vector3(-18, 0, -40),
    new THREE.Vector3(46, 0, 235),
    new THREE.Vector3(74, 0, 510),
    new THREE.Vector3(35, 0, 890),
  ];
  const mainShoulder = createGroundRibbon(
    mainRoadPoints,
    31,
    0.32,
    groundMaterial(0x756e58),
  );
  const mainRoad = createGroundRibbon(
    mainRoadPoints,
    21,
    0.42,
    groundMaterial(0x434744),
  );
  map.add(mainShoulder.mesh, mainRoad.mesh);

  const westernDirtRoad = [
    new THREE.Vector3(-900, 0, 178),
    new THREE.Vector3(-620, 0, 166),
    new THREE.Vector3(-350, 0, 145),
    new THREE.Vector3(-60, 0, 158),
    new THREE.Vector3(20, 0, 173),
  ];
  const easternDirtRoad = [
    new THREE.Vector3(46, 0, 179),
    new THREE.Vector3(105, 0, 193),
    new THREE.Vector3(230, 0, 218),
    new THREE.Vector3(520, 0, 285),
    new THREE.Vector3(890, 0, 305),
  ];
  const dirtRoadMaterial = groundMaterial(0x8a8067);
  const dirtVergeMaterial = groundMaterial(0x657050);
  const westernVerge = createGroundRibbon(
    westernDirtRoad,
    (progress) => THREE.MathUtils.lerp(20, 22, progress ** 4),
    0.28,
    dirtVergeMaterial,
    54,
  );
  const westernRoad = createGroundRibbon(
    westernDirtRoad,
    (progress) => THREE.MathUtils.lerp(12, 16, progress ** 4),
    0.38,
    dirtRoadMaterial,
    54,
  );
  const easternVerge = createGroundRibbon(
    easternDirtRoad,
    (progress) => THREE.MathUtils.lerp(22, 20, progress ** 0.25),
    0.28,
    dirtVergeMaterial,
    54,
  );
  const easternRoad = createGroundRibbon(
    easternDirtRoad,
    (progress) => THREE.MathUtils.lerp(16, 12, progress ** 0.25),
    0.38,
    dirtRoadMaterial,
    54,
  );
  map.add(
    westernVerge.mesh,
    westernRoad.mesh,
    easternVerge.mesh,
    easternRoad.mesh,
  );
  const rutMaterial = groundMaterial(0x82775d);
  for (const road of [westernDirtRoad, easternDirtRoad]) {
    for (const offset of [-2.35, 2.35]) {
      map.add(
        createGroundRibbon(
          offsetGroundPath(road, offset),
          0.18,
          0.43,
          rutMaterial,
          48,
        ).mesh,
      );
    }
  }

  const farmLaneMaterial = groundMaterial(0x81745c);
  map.add(
    createGroundRibbon(
      [
        new THREE.Vector3(-431, 0, 146),
        new THREE.Vector3(-431, 0, 124),
        new THREE.Vector3(-428, 0, 108),
      ],
      6,
      0.4,
      farmLaneMaterial,
      14,
    ).mesh,
    createGroundRibbon(
      [
        new THREE.Vector3(520, 0, 284),
        new THREE.Vector3(548, 0, 120),
        new THREE.Vector3(545, 0, -80),
        new THREE.Vector3(520, 0, -205),
        new THREE.Vector3(497, 0, -230),
      ],
      6,
      0.4,
      farmLaneMaterial,
      54,
    ).mesh,
    createGroundRibbon(
      [
        new THREE.Vector3(-430, 109),
        new THREE.Vector3(-405, 91),
        new THREE.Vector3(-383, 80),
      ],
      3,
      0.39,
      farmLaneMaterial,
      16,
    ).mesh,
  );
  map.add(
    createTerrainPatch(
      -431,
      130,
      11,
      10,
      0,
      0.45,
      groundMaterial(0x766c58),
      3,
      3,
    ),
  );

  const westernDrainage = westernDirtRoad
    .map((point) => new THREE.Vector3(point.x, 0, point.z - 15));
  const easternDrainage = [
    new THREE.Vector3(46, 0, 164),
    ...easternDirtRoad.slice(1).map(
      (point) => new THREE.Vector3(point.x, 0, point.z - 15),
    ),
  ];
  const drainageMaterial = groundMaterial(0x58734f);
  map.add(
    createGroundRibbon(
      westernDrainage,
      (progress) => THREE.MathUtils.lerp(3.2, 0.12, progress ** 5),
      0.18,
      drainageMaterial,
      46,
    ).mesh,
    createGroundRibbon(
      easternDrainage,
      (progress) => THREE.MathUtils.lerp(0.12, 3.2, progress ** 0.2),
      0.18,
      drainageMaterial,
      46,
    ).mesh,
  );

  const dashGeometry = new THREE.BoxGeometry(0.55, 0.06, 7);
  const dashMaterial = new THREE.MeshBasicMaterial({ color: 0xd5bd70 });
  for (let index = 2; index < 98; index += 4) {
    const progress = index / 100;
    const point = mainRoad.curve.getPointAt(progress);
    const tangent = mainRoad.curve.getTangentAt(progress);
    const dash = new THREE.Mesh(dashGeometry, dashMaterial);
    dash.position.set(
      point.x,
      terrainHeightAt(point.x, point.z) + 0.5,
      point.z,
    );
    dash.rotation.y = Math.atan2(tangent.x, tangent.z);
    map.add(dash);
  }

  const townStreets = [
    [
      new THREE.Vector3(245, 0, 224),
      new THREE.Vector3(250, 0, 305),
      new THREE.Vector3(255, 0, 430),
    ],
    [
      new THREE.Vector3(405, 0, 258),
      new THREE.Vector3(405, 0, 305),
      new THREE.Vector3(408, 0, 430),
    ],
    [
      new THREE.Vector3(180, 0, 305),
      new THREE.Vector3(250, 0, 305),
      new THREE.Vector3(405, 0, 305),
      new THREE.Vector3(475, 0, 300),
    ],
    [
      new THREE.Vector3(180, 0, 430),
      new THREE.Vector3(255, 0, 430),
      new THREE.Vector3(408, 0, 430),
      new THREE.Vector3(470, 0, 420),
    ],
  ];
  const streetShoulderMaterial = groundMaterial(0x697255);
  const streetMaterial = groundMaterial(0x746b59);
  for (const points of townStreets) {
    map.add(
      createGroundRibbon(
        points,
        13,
        0.3,
        streetShoulderMaterial,
        28,
      ).mesh,
      createGroundRibbon(points, 7.5, 0.36, streetMaterial, 28).mesh,
    );
  }
  for (const [x, z] of [
    [250, 305],
    [405, 305],
    [255, 430],
    [408, 430],
  ]) {
    const intersection = (radius: number) =>
      Array.from(
        { length: 14 },
        (_, index) =>
          new THREE.Vector2(
            x + Math.cos((index / 14) * Math.PI * 2) * radius,
            z + Math.sin((index / 14) * Math.PI * 2) * radius,
          ),
      );
    map.add(
      createTerrainPolygon(
        intersection(7.5),
        0.31,
        streetShoulderMaterial,
      ),
      createTerrainPolygon(intersection(5), 0.37, streetMaterial),
    );
  }

  const drivewayMaterial = groundMaterial(0x847965);
  const driveways: Array<[number, number, number, number]> = [
    [214, 270, 247, 270],
    [214, 350, 252, 350],
    [213, 400, 254, 400],
    [446, 280, 408, 280],
    [445, 350, 407, 350],
    [446, 400, 408, 400],
    [278, 467, 278, 433],
    [395, 467, 395, 433],
    [300, 281, 300, 307],
    [365, 284, 365, 307],
    [334, 444, 334, 430],
  ];
  for (const [startX, startZ, endX, endZ] of driveways) {
    map.add(
      createGroundRibbon(
        [
          new THREE.Vector3(startX, 0, startZ),
          new THREE.Vector3(
            (startX + endX) * 0.5,
            0,
            (startZ + endZ) * 0.5,
          ),
          new THREE.Vector3(endX, 0, endZ),
        ],
        2.7,
        0.39,
        drivewayMaterial,
        10,
      ).mesh,
    );
  }

  return mainRoad.curve;
};

const addStructures = (map: THREE.Group) => {
  const materialCache = new Map<number, THREE.MeshStandardMaterial>();
  const materialFor = (color: number) => {
    const cached = materialCache.get(color);
    if (cached) return cached;
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.92,
    });
    materialCache.set(color, material);
    return material;
  };
  const roofMaterials = [
    materialFor(0x6e4938),
    materialFor(0x824f3d),
    materialFor(0x555d5a),
  ];
  roofMaterials.forEach((material) => {
    material.side = THREE.DoubleSide;
  });
  const windowMaterial = materialFor(0x6d8587);
  const doorMaterial = materialFor(0x5b4434);
  const structures = new THREE.Group();

  const addBuilding = (
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    color: number,
    rotation = 0,
    roofIndex = 0,
  ) => {
    const building = new THREE.Group();
    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      materialFor(color),
    );
    walls.position.y = height * 0.5;
    building.add(walls);

    const roof = new THREE.Mesh(
      createGabledRoofGeometry(width + 1.8, depth + 2.2, height * 0.34),
      roofMaterials[roofIndex % roofMaterials.length],
    );
    roof.position.y = height;
    building.add(roof);

    const door = new THREE.Mesh(
      new THREE.BoxGeometry(Math.min(3.1, width * 0.2), height * 0.52, 0.3),
      doorMaterial,
    );
    door.position.set(0, height * 0.27, depth * 0.5 + 0.17);
    building.add(door);
    for (const side of [-1, 1]) {
      const window = new THREE.Mesh(
        new THREE.BoxGeometry(2.3, 2.1, 0.24),
        windowMaterial,
      );
      window.position.set(side * width * 0.27, height * 0.58, depth * 0.5 + 0.18);
      building.add(window);
    }

    building.position.set(x, terrainHeightAt(x, z) + 0.35, z);
    building.rotation.y = rotation;
    structures.add(building);
  };

  townBuildings.forEach(
    ([x, z, width, depth, height, color, rotation, roofIndex]) => {
    addBuilding(
      x,
      z,
      width,
      depth,
        height,
        color,
      rotation,
      roofIndex,
    );
    },
  );

  addBuilding(-435, 99, 39, 24, 13, 0xb9966e, -0.04, 0);
  addBuilding(-375, 75, 18, 15, 9, 0xd2cab3, 0.08, 1);
  addBuilding(-472, 63, 23, 17, 10, 0x9eaaa0, -0.1, 2);
  addBuilding(485, -275, 43, 27, 14, 0xb59a72, 0.08, 0);
  addBuilding(530, -240, 18, 16, 9, 0xd6d0bd, -0.06, 1);
  addBuilding(445, -236, 25, 18, 10, 0xaeb8aa, 0.12, 2);
  map.add(structures);

  const siloMaterial = new THREE.MeshStandardMaterial({
    color: 0xaab4b2,
    roughness: 0.72,
    metalness: 0.25,
  });
  for (const [x, z] of [
    [-478, 110],
    [515, -303],
  ]) {
    const groundY = terrainHeightAt(x, z);
    const silo = new THREE.Mesh(
      new THREE.CylinderGeometry(7, 7.8, 25, 12),
      siloMaterial,
    );
    silo.position.set(x, groundY + 12.8, z);
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(7.1, 4.2, 12),
      materialFor(0x77807e),
    );
    cap.position.set(x, groundY + 27.2, z);
    map.add(silo, cap);
  }

  const baleMaterial = materialFor(0xb69b58);
  const baleGeometry = new THREE.CylinderGeometry(1.7, 1.7, 3.2, 10);
  for (const [x, z, rotation] of [
    [-399, 108, 0.08],
    [-395, 113, -0.05],
    [-402, 117, 0.12],
    [-391, 118, -0.1],
  ]) {
    const bale = new THREE.Mesh(baleGeometry, baleMaterial);
    bale.rotation.z = Math.PI / 2;
    bale.rotation.y = rotation;
    bale.position.set(x, terrainHeightAt(x, z) + 1.9, z);
    map.add(bale);
  }
  const trough = new THREE.Mesh(
    new THREE.BoxGeometry(8, 1.4, 2.8),
    materialFor(0x697777),
  );
  trough.position.set(
    -382,
    terrainHeightAt(-382, 101) + 0.9,
    101,
  );
  map.add(trough);

  const plazaPoints = (radius: number) =>
    Array.from(
      { length: 24 },
      (_, index) =>
        new THREE.Vector2(
          332 + Math.cos((index / 24) * Math.PI * 2) * radius,
          368 + Math.sin((index / 24) * Math.PI * 2) * radius,
        ),
    );
  map.add(
    createTerrainPolygon(
      plazaPoints(36),
      0.32,
      groundMaterial(0x847b65),
    ),
    createTerrainPolygon(
      plazaPoints(27),
      0.36,
      groundMaterial(0x72875a),
    ),
    createGroundRibbon(
      [
        new THREE.Vector3(297, 0, 368),
        new THREE.Vector3(332, 0, 368),
        new THREE.Vector3(367, 0, 368),
      ],
      2.2,
      0.39,
      groundMaterial(0x9a9079),
      16,
    ).mesh,
  );
};

const addTrees = (map: THREE.Group, random: RandomSource) => {
  const positions: Array<[number, number, number]> = [];
  const addRow = (
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    spacing: number,
  ) => {
    const count = Math.floor(Math.hypot(endX - startX, endZ - startZ) / spacing);
    for (let index = 0; index <= count; index += 1) {
      const progress = index / Math.max(count, 1);
      positions.push([
        THREE.MathUtils.lerp(startX, endX, progress) + (random() - 0.5) * 5,
        THREE.MathUtils.lerp(startZ, endZ, progress) + (random() - 0.5) * 5,
        0.8 + random() * 0.55,
      ]);
    }
  };
  addRow(-815, -390, -410, -405, 28);
  addRow(430, -405, 800, -390, 30);
  addRow(-800, 470, -455, 485, 27);
  addRow(510, 520, 825, 500, 30);
  for (const [centerX, centerZ, count, radius] of [
    [-532, 78, 7, 23],
    [-322, 78, 6, 22],
    [380, -300, 6, 24],
    [596, -250, 8, 30],
  ]) {
    for (let index = 0; index < count; index += 1) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * radius;
      positions.push([
        centerX + Math.cos(angle) * distance,
        centerZ + Math.sin(angle) * distance,
        0.7 + random() * 0.65,
      ]);
    }
  }
  positions.push(...townTreePositions);

  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.8, 1.15, 8, 6),
    groundMaterial(0x514534),
    positions.length,
  );
  const crowns = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(5.5, 0),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x213924,
      emissiveIntensity: 0.16,
      roughness: 1,
    }),
    positions.length,
  );
  const transform = new THREE.Object3D();
  const crownColor = new THREE.Color();
  positions.forEach(([x, z, scale], index) => {
    const y = terrainHeightAt(x, z);
    transform.position.set(x, y + 4 * scale, z);
    transform.scale.setScalar(scale);
    transform.rotation.y = random() * Math.PI;
    transform.updateMatrix();
    trunks.setMatrixAt(index, transform.matrix);
    transform.position.y = y + 10.5 * scale;
    transform.scale.set(scale * 1.15, scale, scale * 1.1);
    transform.updateMatrix();
    crowns.setMatrixAt(index, transform.matrix);
    crownColor.set(
      index % 3 === 0 ? 0x456d46 : index % 3 === 1 ? 0x527a4d : 0x496f43,
    );
    crowns.setColorAt(index, crownColor);
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  map.add(trunks, crowns);
};

const addFence = (
  map: THREE.Group,
  start: THREE.Vector2,
  end: THREE.Vector2,
  material: THREE.Material,
) => {
  const count = Math.max(1, Math.floor(start.distanceTo(end) / 12));
  const positions: number[] = [];
  const posts = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.22, 0.28, 3, 5),
    groundMaterial(0x594a34),
    count + 1,
  );
  const postTransform = new THREE.Object3D();
  for (let index = 0; index <= count; index += 1) {
    const progress = index / count;
    const x = THREE.MathUtils.lerp(start.x, end.x, progress);
    const z = THREE.MathUtils.lerp(start.y, end.y, progress);
    const y = terrainHeightAt(x, z);
    postTransform.position.set(x, y + 1.5, z);
    postTransform.updateMatrix();
    posts.setMatrixAt(index, postTransform.matrix);
    positions.push(x, y + 0.2, z, x, y + 2.8, z);
    if (index < count) {
      const nextProgress = (index + 1) / count;
      const nextX = THREE.MathUtils.lerp(start.x, end.x, nextProgress);
      const nextZ = THREE.MathUtils.lerp(start.y, end.y, nextProgress);
      const nextY = terrainHeightAt(nextX, nextZ);
      positions.push(x, y + 1.25, z, nextX, nextY + 1.25, nextZ);
      positions.push(x, y + 2.25, z, nextX, nextY + 2.25, nextZ);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  posts.instanceMatrix.needsUpdate = true;
  map.add(posts, new THREE.LineSegments(geometry, material));
};

const addUtilities = (map: THREE.Group, roadCurve: THREE.CatmullRomCurve3) => {
  const poleMaterial = groundMaterial(0x4e3c2b);
  const poles = new THREE.Group();
  const wirePoints: THREE.Vector3[][] = [[], [], []];

  for (let index = 0; index <= 72; index += 1) {
    const progress = 0.04 + (index / 72) * 0.92;
    const point = roadCurve.getPointAt(progress);
    const tangent = roadCurve.getTangentAt(progress);
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const x = point.x + side.x * 26;
    const z = point.z + side.z * 26;
    const groundY = terrainHeightAt(x, z);
    wirePoints[0].push(
      new THREE.Vector3(x - side.x * 5, groundY + 19.6, z - side.z * 5),
    );
    wirePoints[1].push(new THREE.Vector3(x, groundY + 20.4, z));
    wirePoints[2].push(
      new THREE.Vector3(x + side.x * 5, groundY + 19.6, z + side.z * 5),
    );
  }

  for (let index = 0; index <= 18; index += 1) {
    const progress = 0.04 + (index / 18) * 0.92;
    const point = roadCurve.getPointAt(progress);
    const tangent = roadCurve.getTangentAt(progress);
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const x = point.x + side.x * 26;
    const z = point.z + side.z * 26;
    if (Math.hypot(point.x - 33, point.z - 175) < 72) {
      continue;
    }
    const groundY = terrainHeightAt(x, z);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 1, 20, 7),
      poleMaterial,
    );
    pole.position.set(x, groundY + 10, z);
    poles.add(pole);

    const crossbar = new THREE.Mesh(
      new THREE.BoxGeometry(12, 0.9, 0.9),
      poleMaterial,
    );
    crossbar.position.set(x, groundY + 19.5, z);
    crossbar.rotation.y = Math.atan2(tangent.x, tangent.z);
    poles.add(crossbar);
  }

  const wireMaterial = new THREE.LineBasicMaterial({
    color: 0x302b25,
    transparent: true,
    opacity: 0.8,
  });
  wirePoints.forEach((points) => {
    poles.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        wireMaterial,
      ),
    );
  });
  map.add(poles);
};

export const createPampasMap = (
  scene: THREE.Scene,
  random: RandomSource,
) => {
  const terrainGeometry = new THREE.PlaneGeometry(
    WORLD_CONFIG.visualRadius * 1.55,
    WORLD_CONFIG.visualRadius * 1.55,
    64,
    64,
  );
  const positions = terrainGeometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = -positions.getY(index);
    const height = terrainHeightAt(x, z);
    positions.setZ(index, height);
    const variation = Math.sin(x * 0.006) * 0.45 + Math.cos(z * 0.007) * 0.55;
    color
      .set(variation > 0.1 ? 0x667f4d : 0x587345)
      .offsetHSL(0, 0, height * 0.008 + (random() - 0.5) * 0.025);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  terrainGeometry.setAttribute(
    "color",
    new THREE.BufferAttribute(colors, 3),
  );
  terrainGeometry.computeVertexNormals();
  const terrain = new THREE.Mesh(
    terrainGeometry,
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
    }),
  );
  terrain.rotation.x = -Math.PI / 2;
  scene.add(terrain);

  const map = new THREE.Group();
  addFields(map);
  addFarmGrounds(map);
  const roadCurve = addRoads(map);
  addStructures(map);
  addTrees(map, random);
  const fenceMaterial = new THREE.LineBasicMaterial({ color: 0x665b43 });
  const fenceSections: Array<[number, number, number, number]> = [
    [-508, 52, -480, 37],
    [-480, 37, -392, 39],
    [-392, 39, -348, 62],
    [-348, 62, -346, 112],
    [-346, 112, -378, 139],
    [-378, 139, -417, 141],
    [-444, 141, -472, 143],
    [-472, 143, -510, 116],
    [-510, 116, -508, 52],
    [405, -340, 575, -340],
    [405, -340, 405, -190],
    [575, -340, 575, -190],
    [405, -190, 505, -190],
    [535, -190, 575, -190],
  ];
  for (const [startX, startZ, endX, endZ] of fenceSections) {
    addFence(
      map,
      new THREE.Vector2(startX, startZ),
      new THREE.Vector2(endX, endZ),
      fenceMaterial,
    );
  }
  addUtilities(map, roadCurve);
  scene.add(map);
};
