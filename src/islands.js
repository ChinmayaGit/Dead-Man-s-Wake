import * as THREE from 'three';

export class Archipelago {
  constructor(scene) {
    this.scene = scene;
    this.islands = [];
    this.flags = [];
    this.flagTime = 0;

    // Island coordinates across the Caribbean map (balanced around central bay)
    const islandLocs = [
      { x: -110, z: -100, radius: 42, height: 26, trees: 22, seed: 1.4, hasFort: false, name: 'North Reef' },
      { x: 150, z: -120, radius: 52, height: 30, trees: 24, seed: 3.8, hasFort: true, name: 'Fort Charles' },
      { x: -160, z: 140, radius: 58, height: 32, trees: 30, seed: 5.2, hasFort: false, name: "Pirate's Cove" },
      { x: 180, z: 150, radius: 54, height: 32, trees: 26, seed: 7.1, hasFort: false, name: "Smuggler's Isle" }
    ];

    islandLocs.forEach((loc) => {
      this.createIsland(loc);
    });

    this.createBuoys();
  }

  // Analytical Elevation Function: Returns exact Y ground height at any (localX, localZ)
  // Waves crest up to +2.32m, so all visible dry land is engineered from y = 2.5m upwards!
  getIslandSurfaceY(localX, localZ, config) {
    const dist = Math.hypot(localX, localZ);
    const R = config.radius;

    // Submerged reef shelf beyond visible shoreline: drops smoothly into deep water
    if (dist >= R) {
      const dropT = Math.min(1.0, (dist - R) / (R * 0.22));
      return 2.4 - dropT * 12.0; // from 2.4m at shore dropping down to -9.6m
    }

    // Normalized progress: 0 at beach shore edge, 1 at island center peak
    const normDist = dist / R;
    const t = 1.0 - normDist;

    // Continuous smooth cosine mountain dome (rounded peak, zero pointy pyramid artifacts)
    const domeCurve = Math.pow(Math.cos(normDist * Math.PI * 0.5), 1.35);
    let baseElevation = 2.5 + domeCurve * (config.height - 2.5);

    // If island has Fort Charles, create a dedicated level fortress terrace plateau!
    // Fort is at fortPos (-16, 14). Flatten terrain across radius 26 around fortPos
    if (config.hasFort) {
      const fortDist = Math.hypot(localX - (-16), localZ - 14);
      if (fortDist < 26.0) {
        const terraceY = 9.0; // Solid elevated terrace height for the fortress
        const terraceWeight = Math.cos(Math.min(1.0, fortDist / 26.0) * Math.PI * 0.5);
        const smoothBlend = terraceWeight * terraceWeight * (3 - 2 * terraceWeight);
        baseElevation = THREE.MathUtils.lerp(baseElevation, terraceY, smoothBlend * 0.94);
      }
    }

    // Natural organic topography ridges and rolling hills
    const angle = Math.atan2(localZ, localX);
    const ridgeNoise = (Math.sin(localX * 0.12 + (config.seed || 1.0)) * Math.cos(localZ * 0.12) +
                        Math.sin(angle * 3.0 + (config.seed || 1.0) * 2.0) * 0.45) * 1.8;

    // Noise smoothly fades near shoreline so beach has a smooth water-line grade
    const noiseWeight = Math.min(1.0, Math.pow(t, 0.75));
    return Math.max(2.4, baseElevation + ridgeNoise * noiseWeight);
  }

  createIsland(config) {
    const group = new THREE.Group();
    group.position.set(config.x, 0, config.z);

    // 1. Continuous Organic Island Terrain Mesh (High-detail smooth geometry)
    const radialSegs = 64;
    const ringSegs = 32;
    const terrainGeo = new THREE.BufferGeometry();

    const positions = [];
    const colors = [];
    const indices = [];

    // Center apex vertex
    const centerApexY = this.getIslandSurfaceY(0, 0, config);
    positions.push(0, centerApexY, 0);

    const summitColor = new THREE.Color(0x7a8288); // Volcanic limestone summit
    colors.push(summitColor.r, summitColor.g, summitColor.b);

    // Generate concentric elevation rings
    for (let r = 1; r <= ringSegs; r++) {
      const isSkirtRing = (r === ringSegs);
      const ringRatio = isSkirtRing ? 1.15 : (r / (ringSegs - 1));
      const ringDist = ringRatio * config.radius;

      for (let s = 0; s < radialSegs; s++) {
        const angle = (s / radialSegs) * Math.PI * 2;
        const vx = Math.cos(angle) * ringDist;
        const vz = Math.sin(angle) * ringDist;

        let vy;
        if (isSkirtRing) {
          // Submerged underwater skirt so island never exposes seams in wave troughs
          vy = -9.6;
        } else {
          vy = this.getIslandSurfaceY(vx, vz, config);
        }

        positions.push(vx, vy, vz);

        // Biome Color Palette according to ground elevation
        const vertColor = new THREE.Color();
        if (vy <= 2.3) {
          // Submerged coral reef shelf / shallows
          vertColor.setRGB(0.18, 0.48, 0.50);
        } else if (vy <= 4.8) {
          // Caribbean Golden Sand Beach (clearly visible above wave crests!)
          const sandT = (vy - 2.3) / 2.5;
          vertColor.setRGB(
            THREE.MathUtils.lerp(0.88, 0.82, sandT),
            THREE.MathUtils.lerp(0.80, 0.74, sandT),
            THREE.MathUtils.lerp(0.54, 0.46, sandT)
          );
        } else if (vy <= 8.0) {
          // Coastal Grass / Turf
          const grassT = (vy - 4.8) / 3.2;
          vertColor.setRGB(
            THREE.MathUtils.lerp(0.48, 0.22, grassT),
            THREE.MathUtils.lerp(0.68, 0.50, grassT),
            THREE.MathUtils.lerp(0.22, 0.15, grassT)
          );
        } else if (vy <= config.height * 0.70) {
          // Dense Tropical Jungle Canopy
          const jungleT = (vy - 8.0) / (config.height * 0.70 - 8.0);
          vertColor.setRGB(
            THREE.MathUtils.lerp(0.16, 0.11, jungleT),
            THREE.MathUtils.lerp(0.46, 0.36, jungleT),
            THREE.MathUtils.lerp(0.14, 0.09, jungleT)
          );
        } else {
          // Weathered Volcanic Limestone Summit Cliffs
          const rockT = Math.min(1.0, (vy - config.height * 0.70) / (config.height * 0.30));
          vertColor.setRGB(
            THREE.MathUtils.lerp(0.42, 0.50, rockT),
            THREE.MathUtils.lerp(0.46, 0.52, rockT),
            THREE.MathUtils.lerp(0.46, 0.53, rockT)
          );
        }

        colors.push(vertColor.r, vertColor.g, vertColor.b);
      }
    }

    // Build triangular mesh faces
    // 1. Center apex fan to Ring 1
    for (let s = 0; s < radialSegs; s++) {
      const nextS = (s + 1) % radialSegs;
      indices.push(0, 1 + s, 1 + nextS);
    }

    // 2. Concentric ring quads
    for (let r = 1; r < ringSegs; r++) {
      const innerBase = 1 + (r - 1) * radialSegs;
      const outerBase = 1 + r * radialSegs;

      for (let s = 0; s < radialSegs; s++) {
        const nextS = (s + 1) % radialSegs;

        const i0 = innerBase + s;
        const i1 = outerBase + s;
        const i2 = outerBase + nextS;
        const i3 = innerBase + nextS;

        indices.push(i0, i1, i2);
        indices.push(i0, i2, i3);
      }
    }

    terrainGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    terrainGeo.setIndex(indices);
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.06
    });

    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    group.add(terrainMesh);

    // 2. Fort Integration (Positioned on Island 2 facing Seaward)
    const fortPos = { x: -16, z: 14 };
    if (config.hasFort) {
      this.createFort(group, config, fortPos);
    }

    // 3. Palm Trees (Strictly Planted on the Ground Surface - ZERO FLOATING TREES!)
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d3a1a, roughness: 0.9 });
    const frondMat = new THREE.MeshStandardMaterial({ color: 0x1b5e20, roughness: 0.65, side: THREE.DoubleSide });

    let spawnedTrees = 0;
    let treeAttempts = 0;
    const maxTreeAttempts = config.trees * 6;

    while (spawnedTrees < config.trees && treeAttempts < maxTreeAttempts) {
      treeAttempts++;
      const angle = Math.random() * Math.PI * 2;
      const dist = 6 + Math.random() * (config.radius * 0.78);
      const tx = Math.cos(angle) * dist;
      const tz = Math.sin(angle) * dist;

      // Keep trees clear of the fortress perimeter
      if (config.hasFort && Math.hypot(tx - fortPos.x, tz - fortPos.z) < 22) {
        continue;
      }

      const groundY = this.getIslandSurfaceY(tx, tz, config);
      // Valid tree zones: above beach level (4.5m) and below sheer rocky summits
      if (groundY < 4.5 || groundY > config.height * 0.72) {
        continue;
      }

      const tree = this.createPalmTree(trunkMat, frondMat);
      // Anchor base 0.25m into the soil so roots firmly penetrate the ground
      tree.position.set(tx, groundY - 0.25, tz);

      // Natural tropical palm lean towards the ocean
      const radialAngle = Math.atan2(tz, tx);
      const leanAmt = 0.08 + Math.random() * 0.14;
      tree.rotation.y = radialAngle + Math.PI + (Math.random() - 0.5) * 0.5;
      tree.rotation.z = Math.cos(radialAngle) * leanAmt;
      tree.rotation.x = Math.sin(radialAngle) * leanAmt;

      const scale = 0.8 + Math.random() * 0.45;
      tree.scale.set(scale, scale, scale);
      group.add(tree);
      spawnedTrees++;
    }

    // 4. Coastal Boulders & Tropical Shrubbery (Firmly Planted)
    this.createIslandBouldersAndFlora(group, config, fortPos);

    this.scene.add(group);
    this.islands.push({
      pos: new THREE.Vector2(config.x, config.z),
      radius: config.radius,
      hasFort: !!config.hasFort,
      name: config.name || 'Island'
    });
  }

  // Create High-Seas Caribbean Stone Fortress (Fort Charles)
  createFort(group, config, fortPos) {
    const fortGroup = new THREE.Group();
    const groundY = this.getIslandSurfaceY(fortPos.x, fortPos.z, config);
    fortGroup.position.set(fortPos.x, groundY, fortPos.z);

    // Rotate fort so local +Z faces seaward towards map center (South-West)
    fortGroup.rotation.y = Math.atan2(fortPos.x, fortPos.z);

    // Fortress Materials
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x757068, roughness: 0.9, metalness: 0.08 });
    const darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4642, roughness: 0.92, metalness: 0.05 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x4e2712, roughness: 0.85 });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x1f2428, roughness: 0.35, metalness: 0.85 });

    // 1. Massive Stone Bedrock Plinth (Anchored 18m deep into island mountain bedrock!)
    // Top surface at y = 1.0, bottom reaches y = -17.0! Zero floating possible.
    const baseGeo = new THREE.BoxGeometry(32, 18.0, 28);
    const base = new THREE.Mesh(baseGeo, stoneMat);
    base.position.set(0, -8.0, 0);
    base.receiveShadow = true;
    fortGroup.add(base);

    // 2. Stone Bastion Ramparts (Walls)
    // Front seaward wall
    const frontWallGeo = new THREE.BoxGeometry(26, 4.2, 1.6);
    const frontWall = new THREE.Mesh(frontWallGeo, stoneMat);
    frontWall.position.set(0, 2.5, 10.3);
    fortGroup.add(frontWall);

    // Left flank wall
    const leftWallGeo = new THREE.BoxGeometry(1.6, 4.2, 20.6);
    const leftWall = new THREE.Mesh(leftWallGeo, stoneMat);
    leftWall.position.set(-12.3, 2.5, 0);
    fortGroup.add(leftWall);

    // Right flank wall
    const rightWallGeo = new THREE.BoxGeometry(1.6, 4.2, 20.6);
    const rightWall = new THREE.Mesh(rightWallGeo, stoneMat);
    rightWall.position.set(12.3, 2.5, 0);
    fortGroup.add(rightWall);

    // Rear wall with arched gateway
    const rearWallL = new THREE.Mesh(new THREE.BoxGeometry(9.5, 4.2, 1.6), stoneMat);
    rearWallL.position.set(-8.2, 2.5, -10.3);
    fortGroup.add(rearWallL);

    const rearWallR = new THREE.Mesh(new THREE.BoxGeometry(9.5, 4.2, 1.6), stoneMat);
    rearWallR.position.set(8.2, 2.5, -10.3);
    fortGroup.add(rearWallR);

    // Archway lintel over gate
    const gateLintel = new THREE.Mesh(new THREE.BoxGeometry(7.0, 1.6, 1.8), darkStoneMat);
    gateLintel.position.set(0, 5.0, -10.3);
    fortGroup.add(gateLintel);

    // Oak timber gate doors with iron straps
    const gateDoor = new THREE.Mesh(new THREE.BoxGeometry(6.4, 4.0, 0.5), woodMat);
    gateDoor.position.set(0, 2.2, -10.3);
    fortGroup.add(gateDoor);

    // 3. Crenellations (Battlements & Merlons along parapets)
    const addCrenellations = (startX, startZ, endX, endZ, count) => {
      for (let i = 0; i <= count; i++) {
        if (i % 2 === 0) { // Alternating merlon and embrasure
          const t = i / count;
          const cx = THREE.MathUtils.lerp(startX, endX, t);
          const cz = THREE.MathUtils.lerp(startZ, endZ, t);
          const merlon = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 1.5), darkStoneMat);
          merlon.position.set(cx, 4.9, cz);
          fortGroup.add(merlon);
        }
      }
    };

    // Front wall crenellations
    addCrenellations(-11.5, 10.3, 11.5, 10.3, 12);
    // Left wall crenellations
    addCrenellations(-12.3, -9.0, -12.3, 9.0, 10);
    // Right wall crenellations
    addCrenellations(12.3, -9.0, 12.3, 9.0, 10);

    // 4. Corner Sentry Turrets (Garitas)
    const cornerCoords = [
      { x: -12.3, z: 10.3 },
      { x: 12.3, z: 10.3 },
      { x: -12.3, z: -10.3 },
      { x: 12.3, z: -10.3 }
    ];

    cornerCoords.forEach((c) => {
      const turretGeo = new THREE.CylinderGeometry(1.4, 1.2, 5.2, 8);
      const turret = new THREE.Mesh(turretGeo, stoneMat);
      turret.position.set(c.x, 3.2, c.z);
      fortGroup.add(turret);

      const capGeo = new THREE.ConeGeometry(1.7, 1.8, 8);
      const cap = new THREE.Mesh(capGeo, darkStoneMat);
      cap.position.set(c.x, 6.7, c.z);
      fortGroup.add(cap);
    });

    // 5. Central Watchtower / Citadel Keep
    const towerGeo = new THREE.BoxGeometry(7.0, 12.0, 7.0);
    const tower = new THREE.Mesh(towerGeo, stoneMat);
    tower.position.set(0, 6.5, -2.5);
    fortGroup.add(tower);

    // Tower upper battlements
    const towerTopGeo = new THREE.BoxGeometry(8.2, 1.2, 8.2);
    const towerTop = new THREE.Mesh(towerTopGeo, darkStoneMat);
    towerTop.position.set(0, 12.8, -2.5);
    fortGroup.add(towerTop);

    // Flagpole
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 9.0, 8);
    const pole = new THREE.Mesh(poleGeo, woodMat);
    pole.position.set(0, 17.5, -2.5);
    fortGroup.add(pole);

    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), darkStoneMat);
    finial.position.set(0, 22.1, -2.5);
    fortGroup.add(finial);

    // Animated Pirate Jolly Roger Flag
    const flagGeo = new THREE.PlaneGeometry(3.6, 2.2, 8, 4);
    const flagTexture = this.createPirateFlagTexture();
    const flagMat = new THREE.MeshStandardMaterial({
      map: flagTexture,
      side: THREE.DoubleSide,
      roughness: 0.85
    });
    const flagMesh = new THREE.Mesh(flagGeo, flagMat);
    flagMesh.position.set(1.8, 20.5, -2.5);
    fortGroup.add(flagMesh);
    this.flags.push(flagMesh);

    // Warm Beacon Torch Light on tower
    const beaconLight = new THREE.PointLight(0xff7700, 2.5, 25.0);
    beaconLight.position.set(2.5, 13.8, 0.5);
    fortGroup.add(beaconLight);

    const brazier = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.25, 0.7, 6), ironMat);
    brazier.position.set(2.5, 13.3, 0.5);
    fortGroup.add(brazier);

    // 6. Heavy Coastal Artillery: 6 Iron Naval Cannons
    const frontCannonX = [-8.0, -2.7, 2.7, 8.0];
    frontCannonX.forEach((cx) => {
      this.createFortCannon(fortGroup, cx, 2.8, 9.2, 0, ironMat, woodMat);
    });
    // Flank cannons
    this.createFortCannon(fortGroup, -11.0, 2.8, 0, -Math.PI * 0.5, ironMat, woodMat);
    this.createFortCannon(fortGroup, 11.0, 2.8, 0, Math.PI * 0.5, ironMat, woodMat);

    // 7. Stone Stairway to Harbor & Shoreline
    // Forward stairs leading seaward towards the harbor path
    for (let st = 0; st < 8; st++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.45, 1.4), darkStoneMat);
      step.position.set(0, 0.8 - st * 0.45, 12.0 + st * 1.3);
      fortGroup.add(step);
    }

    // Inland steps from rear gateway
    for (let st = 0; st < 6; st++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.4, 1.2), darkStoneMat);
      step.position.set(0, 0.2 - st * 0.35, -11.5 - st * 1.1);
      fortGroup.add(step);
    }

    // 8. Wooden Harbor Pier / Sea Dock
    this.createFortPier(group, config, fortPos, woodMat);

    group.add(fortGroup);
  }

  // Create a detailed naval garrison cannon on wheeled wooden carriage
  createFortCannon(parent, x, y, z, rotY, ironMat, woodMat) {
    const cannonGroup = new THREE.Group();
    cannonGroup.position.set(x, y, z);
    cannonGroup.rotation.y = rotY;

    // Wooden carriage
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.65, 1.8), woodMat);
    carriage.position.set(0, 0.35, 0);
    cannonGroup.add(carriage);

    // 4 Wooden truck wheels
    const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.16, 8);
    wheelGeo.rotateZ(Math.PI * 0.5);
    [[-0.6, 0.3, -0.6], [0.6, 0.3, -0.6], [-0.6, 0.3, 0.6], [0.6, 0.3, 0.6]].forEach((wp) => {
      const wheel = new THREE.Mesh(wheelGeo, woodMat);
      wheel.position.set(wp[0], wp[1], wp[2]);
      cannonGroup.add(wheel);
    });

    // Cast iron cannon barrel
    const barrelGeo = new THREE.CylinderGeometry(0.20, 0.32, 2.6, 10);
    barrelGeo.rotateX(Math.PI * 0.5);
    const barrel = new THREE.Mesh(barrelGeo, ironMat);
    barrel.position.set(0, 0.8, 0.4);
    cannonGroup.add(barrel);

    // Cascabel ball at breech
    const cascabel = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), ironMat);
    cascabel.position.set(0, 0.8, -0.95);
    cannonGroup.add(cascabel);

    // Stacked Pyramid of Cannonballs beside gun
    const ballGeo = new THREE.SphereGeometry(0.16, 6, 6);
    const ballPos = [
      [-1.1, 0.16, -0.4], [-0.8, 0.16, -0.4], [-0.95, 0.16, -0.1],
      [-0.95, 0.42, -0.25]
    ];
    ballPos.forEach((bp) => {
      const ball = new THREE.Mesh(ballGeo, ironMat);
      ball.position.set(bp[0], bp[1], bp[2]);
      cannonGroup.add(ball);
    });

    parent.add(cannonGroup);
  }

  // Create Wooden Harbor Pier extending from the beach into the sea
  createFortPier(islandGroup, config, fortPos, woodMat) {
    const pierGroup = new THREE.Group();
    // Position pier on the beach along the seaward direction from the fort
    const angle = Math.atan2(fortPos.z, fortPos.x);
    // Island 2 has radius 52. Dry sand beach is at dist ~40-42m.
    // Pier starts firmly on dry sand at dist = 39m and extends out to dist = 57m.
    const shoreDist = config.radius * 0.76; // ~39.5m (firmly on golden sand beach)
    const pierStartX = Math.cos(angle) * shoreDist;
    const pierStartZ = Math.sin(angle) * shoreDist;

    pierGroup.position.set(pierStartX, 0, pierStartZ);
    // Align local +Z along the outward vector towards ocean
    pierGroup.rotation.y = Math.atan2(Math.cos(angle), Math.sin(angle));

    // Wooden deck walkway (spans 18m from z = 0 on dry sand to z = 18m over shallow water)
    const deckLength = 18.0;
    const deckGeo = new THREE.BoxGeometry(4.5, 0.4, deckLength);
    const deck = new THREE.Mesh(deckGeo, woodMat);
    deck.position.set(0, 2.7, deckLength * 0.5);
    deck.receiveShadow = true;
    pierGroup.add(deck);

    // Pier support pilings firmly driven deep into seabed
    const pilingGeo = new THREE.CylinderGeometry(0.24, 0.28, 14.0, 7);
    for (let pz = 1.5; pz <= 17.0; pz += 3.5) {
      [-1.8, 1.8].forEach((px) => {
        const piling = new THREE.Mesh(pilingGeo, woodMat);
        piling.position.set(px, -4.0, pz);
        pierGroup.add(piling);

        // Mooring bollard on top of pier
        const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.65, 6), woodMat);
        bollard.position.set(px, 3.2, pz);
        pierGroup.add(bollard);
      });
    }

    // Cargo supply crates and rum barrels on the dock
    const crateGeo = new THREE.BoxGeometry(1.0, 1.0, 1.0);
    const crate1 = new THREE.Mesh(crateGeo, woodMat);
    crate1.position.set(-1.1, 3.4, 6.0);
    pierGroup.add(crate1);

    const barrelGeo = new THREE.CylinderGeometry(0.4, 0.46, 1.1, 8);
    const barrel = new THREE.Mesh(barrelGeo, woodMat);
    barrel.position.set(1.1, 3.45, 11.0);
    pierGroup.add(barrel);

    // Pierhead Harbor Lantern
    const lanternMat = new THREE.MeshStandardMaterial({ color: 0xffb74d, emissive: 0xff8f00, emissiveIntensity: 0.8 });
    const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.65, 0.45), lanternMat);
    lantern.position.set(1.8, 3.8, 17.5);
    pierGroup.add(lantern);

    const pierLight = new THREE.PointLight(0xff9800, 2.0, 18.0);
    pierLight.position.set(1.8, 4.0, 17.5);
    pierGroup.add(pierLight);

    // Cobblestone stone path connecting the fort's seaward steps down to the pier entrance
    const pathMat = new THREE.MeshStandardMaterial({ color: 0x615c54, roughness: 0.95 });
    for (let p = 0; p < 8; p++) {
      const pathT = p / 7;
      const pathDist = THREE.MathUtils.lerp(27.0, shoreDist - 0.5, pathT);
      const px = Math.cos(angle) * pathDist;
      const pz = Math.sin(angle) * pathDist;
      const py = this.getIslandSurfaceY(px, pz, config);
      const pathSlab = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.35, 1.8), pathMat);
      pathSlab.position.set(px, py + 0.1, pz);
      pathSlab.rotation.y = angle + Math.PI * 0.5;
      pathSlab.receiveShadow = true;
      islandGroup.add(pathSlab);
    }

    islandGroup.add(pierGroup);
  }

  // Generate Procedural Pirate Jolly Roger Canvas Texture (Skull & Crossbones)
  createPirateFlagTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');

    // Weathered black cloth
    ctx.fillStyle = '#121416';
    ctx.fillRect(0, 0, 512, 320);

    // Fabric weave subtleties
    ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
    for (let i = 0; i < 50; i++) {
      ctx.fillRect(Math.random() * 512, Math.random() * 320, Math.random() * 80, 2);
    }

    ctx.save();
    ctx.translate(256, 160);
    ctx.strokeStyle = '#f5f5f0';
    ctx.fillStyle = '#f5f5f0';
    ctx.lineWidth = 18;
    ctx.lineCap = 'round';

    // Bone 1 (\)
    ctx.save();
    ctx.rotate(Math.PI / 4.2);
    ctx.beginPath();
    ctx.moveTo(-110, 0);
    ctx.lineTo(110, 0);
    ctx.stroke();
    [-110, 110].forEach((bx) => {
      ctx.beginPath();
      ctx.arc(bx, -12, 14, 0, Math.PI * 2);
      ctx.arc(bx, 12, 14, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    // Bone 2 (/)
    ctx.save();
    ctx.rotate(-Math.PI / 4.2);
    ctx.beginPath();
    ctx.moveTo(-110, 0);
    ctx.lineTo(110, 0);
    ctx.stroke();
    [-110, 110].forEach((bx) => {
      ctx.beginPath();
      ctx.arc(bx, -12, 14, 0, Math.PI * 2);
      ctx.arc(bx, 12, 14, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    // White Skull
    ctx.beginPath();
    ctx.arc(0, -20, 52, 0, Math.PI * 2);
    ctx.fill();

    // Jaw / Teeth section
    ctx.beginPath();
    ctx.moveTo(-35, -5);
    ctx.lineTo(35, -5);
    ctx.lineTo(26, 38);
    ctx.lineTo(-26, 38);
    ctx.closePath();
    ctx.fill();

    // Teeth grooves
    ctx.fillStyle = '#121416';
    for (let t = -18; t <= 18; t += 9) {
      ctx.fillRect(t - 2, 22, 4, 16);
    }

    // Eye sockets
    ctx.beginPath();
    ctx.ellipse(-18, -14, 14, 18, -0.2, 0, Math.PI * 2);
    ctx.ellipse(18, -14, 14, 18, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Nose cavity
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.lineTo(-6, 12);
    ctx.lineTo(6, 12);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  }

  // Create High-Quality Palm Tree
  createPalmTree(trunkMat, frondMat) {
    const treeGroup = new THREE.Group();

    // Organic curved trunk (spans y = 0 to y = 6.2)
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.52, 6.2, 7);
    trunkGeo.rotateZ(0.14);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 3.1;
    treeGroup.add(trunk);

    // Coconut cluster
    const cocoGeo = new THREE.SphereGeometry(0.26, 4, 4);
    const cocoMat = new THREE.MeshStandardMaterial({ color: 0x3d2314, roughness: 0.9 });
    const coconuts = new THREE.Mesh(cocoGeo, cocoMat);
    coconuts.position.set(0.35, 6.0, 0);
    treeGroup.add(coconuts);

    // 7 Palm fronds radiating outwards and drooping down
    for (let j = 0; j < 7; j++) {
      const frondAngle = (j / 7) * Math.PI * 2;
      const frondGeo = new THREE.PlaneGeometry(0.9, 3.4, 2, 5);

      const pos = frondGeo.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const vy = pos.getY(k);
        pos.setZ(k, -Math.pow(vy + 1.7, 2) * 0.13);
      }
      frondGeo.computeVertexNormals();

      const frond = new THREE.Mesh(frondGeo, frondMat);
      frond.position.set(0.35, 6.1, 0);
      frond.rotation.set(0.65, frondAngle, 0, 'YXZ');
      treeGroup.add(frond);
    }

    return treeGroup;
  }

  // Scatter coastal boulders and tropical shrubs
  createIslandBouldersAndFlora(group, config, fortPos) {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x546e7a, roughness: 0.95 });
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.8 });

    for (let b = 0; b < 14; b++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 5 + Math.random() * (config.radius * 0.88);
      const bx = Math.cos(angle) * dist;
      const bz = Math.sin(angle) * dist;

      if (config.hasFort && Math.hypot(bx - fortPos.x, bz - fortPos.z) < 18) {
        continue;
      }

      const gy = this.getIslandSurfaceY(bx, bz, config);
      if (gy < 2.5 || gy > config.height * 0.8) continue;

      if (b % 2 === 0) {
        // Coastal boulder embedded in the sand/rock
        const rSize = 0.8 + Math.random() * 1.4;
        const boulder = new THREE.Mesh(new THREE.DodecahedronGeometry(rSize, 1), rockMat);
        boulder.position.set(bx, gy + rSize * 0.35, bz);
        boulder.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        group.add(boulder);
      } else {
        // Tropical shrub
        const sSize = 0.6 + Math.random() * 0.8;
        const bush = new THREE.Mesh(new THREE.SphereGeometry(sSize, 5, 5), bushMat);
        bush.position.set(bx, gy + sSize * 0.5, bz);
        group.add(bush);
      }
    }
  }

  // Dynamic animation update (waves pirate flag in the Caribbean breeze)
  update(delta) {
    this.flagTime += delta;
    if (this.flags && this.flags.length > 0) {
      for (const flag of this.flags) {
        const pos = flag.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const vx = pos.getX(i);
          // Wave displacement proportional to distance from the flagpole
          const waveWeight = Math.max(0, (vx + 1.8) / 3.6);
          const zOffset = Math.sin(this.flagTime * 4.5 + vx * 2.2) * 0.35 * waveWeight;
          pos.setZ(i, zOffset);
        }
        pos.needsUpdate = true;
      }
    }
  }

  createBuoys() {
    const buoyLocs = [
      { x: -18, z: -25 },
      { x: 20, z: -55 },
      { x: -25, z: -90 },
      { x: 35, z: -130 },
      { x: -10, z: -175 }
    ];

    const buoyGeo = new THREE.CylinderGeometry(0.7, 0.7, 1.4, 12);
    const buoyMat = new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.5 });
    const whiteBandMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x424242 });
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xffd54f, side: THREE.DoubleSide });

    buoyLocs.forEach((loc) => {
      const buoyGroup = new THREE.Group();
      buoyGroup.position.set(loc.x, 0.4, loc.z);

      const barrel = new THREE.Mesh(buoyGeo, buoyMat);
      buoyGroup.add(barrel);

      const bandGeo = new THREE.CylinderGeometry(0.72, 0.72, 0.4, 12);
      const band = new THREE.Mesh(bandGeo, whiteBandMat);
      buoyGroup.add(band);

      const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.5, 6);
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.y = 1.6;
      buoyGroup.add(pole);

      const flagGeo = new THREE.PlaneGeometry(0.9, 0.55);
      const flag = new THREE.Mesh(flagGeo, flagMat);
      flag.position.set(0.45, 2.4, 0);
      buoyGroup.add(flag);

      this.scene.add(buoyGroup);
    });
  }
}

