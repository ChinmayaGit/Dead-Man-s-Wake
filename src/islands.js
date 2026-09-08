import * as THREE from 'three';

export class Archipelago {
  constructor(scene) {
    this.scene = scene;
    this.islands = [];

    // Island coordinates across the Caribbean map
    const islandLocs = [
      { x: -60, z: -85, radius: 36, height: 16, trees: 15 },
      { x: 140, z: -120, radius: 45, height: 18, trees: 16 },
      { x: -160, z: 140, radius: 55, height: 22, trees: 22 },
      { x: 190, z: 140, radius: 50, height: 24, trees: 20 }
    ];

    islandLocs.forEach((loc) => {
      this.createIsland(loc);
    });

    this.createBuoys();
  }

  createIsland(config) {
    const group = new THREE.Group();
    group.position.set(config.x, 0, config.z);

    // 1. Sandy Island Terrain
    const segments = 32;
    const terrainGeo = new THREE.CylinderGeometry(config.radius * 0.1, config.radius, config.height, segments, 8);

    // Displace vertices for organic island shape
    const pos = terrainGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      const noise = (Math.sin(px * 0.2) + Math.cos(pz * 0.2)) * 2.5;
      pos.setX(i, px + noise);
      pos.setZ(i, pz + noise);
    }
    terrainGeo.computeVertexNormals();

    const sandMat = new THREE.MeshStandardMaterial({
      color: 0xdfc282, // Caribbean sand
      roughness: 0.9
    });

    const terrain = new THREE.Mesh(terrainGeo, sandMat);
    terrain.position.y = config.height * 0.35 - 2.0;
    group.add(terrain);

    // 2. Grassy Summit
    const grassGeo = new THREE.ConeGeometry(config.radius * 0.55, config.height * 0.6, 16);
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x2e6b2e, // Lush tropical green
      roughness: 0.8
    });
    const grass = new THREE.Mesh(grassGeo, grassMat);
    grass.position.y = config.height * 0.65;
    group.add(grass);

    // 3. Palm Trees
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6e4823, roughness: 0.9 });
    const frondMat = new THREE.MeshStandardMaterial({ color: 0x1d731d, roughness: 0.7, side: THREE.DoubleSide });

    for (let i = 0; i < config.trees; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 5 + Math.random() * (config.radius * 0.65);
      const tx = Math.cos(angle) * dist;
      const tz = Math.sin(angle) * dist;
      const ty = config.height * 0.45;

      const tree = this.createPalmTree(trunkMat, frondMat);
      tree.position.set(tx, ty, tz);
      tree.rotation.y = Math.random() * Math.PI * 2;
      const scale = 0.8 + Math.random() * 0.5;
      tree.scale.set(scale, scale, scale);
      group.add(tree);
    }

    this.scene.add(group);
    this.islands.push({ pos: new THREE.Vector2(config.x, config.z), radius: config.radius });
  }

  createPalmTree(trunkMat, frondMat) {
    const treeGroup = new THREE.Group();

    // Curved trunk
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.45, 6.0, 6);
    trunkGeo.rotateZ(0.12);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 3.0;
    treeGroup.add(trunk);

    // Coconut cluster
    const cocoGeo = new THREE.SphereGeometry(0.25, 4, 4);
    const cocoMat = new THREE.MeshStandardMaterial({ color: 0x3d2314 });
    const coconuts = new THREE.Mesh(cocoGeo, cocoMat);
    coconuts.position.set(0.3, 5.8, 0);
    treeGroup.add(coconuts);

    // Palm fronds (leaves)
    for (let j = 0; j < 6; j++) {
      const frondAngle = (j / 6) * Math.PI * 2;
      const frondGeo = new THREE.PlaneGeometry(0.8, 3.2, 2, 4);

      // Curve frond downward
      const pos = frondGeo.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const vy = pos.getY(k);
        pos.setZ(k, -Math.pow(vy + 1.6, 2) * 0.12);
      }
      frondGeo.computeVertexNormals();

      const frond = new THREE.Mesh(frondGeo, frondMat);
      frond.position.set(0.35, 5.9, 0);
      frond.rotation.set(0.6, frondAngle, 0, 'YXZ');
      treeGroup.add(frond);
    }

    return treeGroup;
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
