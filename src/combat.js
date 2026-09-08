import * as THREE from 'three';

export class CombatSystem {
  constructor(scene, ocean, sound) {
    this.scene = scene;
    this.ocean = ocean;
    this.sound = sound;

    this.cannonballs = [];
    this.particles = [];
    this.flashes = [];

    // Aiming Arc Guide Line
    this.aimLine = this.createAimArc();
    this.scene.add(this.aimLine);
    this.aimLine.visible = false;

    // Cannonball material & geometry
    this.ballGeo = new THREE.SphereGeometry(0.25, 8, 8);
    this.ballMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.3,
      metalness: 0.9
    });
  }

  createAimArc() {
    const pointsCount = 30;
    const positions = new Float32Array(pointsCount * 3);
    const colors = new Float32Array(pointsCount * 3);

    for (let i = 0; i < pointsCount; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;

      // Golden aiming arc
      colors[i * 3] = 1.0;
      colors[i * 3 + 1] = 0.8;
      colors[i * 3 + 2] = 0.2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeBoundingSphere();

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      linewidth: 3,
      transparent: true,
      opacity: 0.8
    });

    return new THREE.Line(geo, mat);
  }

  updateAimArc(playerShip, side, range = 55.0) {
    if (!this.aimLine) return;
    this.aimLine.visible = true;

    const right = playerShip.getRightVector();
    const aimDir = side === 'port' ? right.clone().negate() : right.clone();

    // Aim slightly upward for parabolic trajectory
    aimDir.y = 0.28;
    aimDir.normalize();

    if (!playerShip || !playerShip.position || isNaN(playerShip.position.x) || isNaN(playerShip.position.z)) return;
    const heave = (typeof playerShip.heave === 'number' && !isNaN(playerShip.heave)) ? playerShip.heave : 0;

    const startPos = playerShip.position.clone();
    startPos.y = heave + 2.0;

    const gravity = 18.0;
    const muzzleSpeed = 38.0;
    const velocity = aimDir.clone().multiplyScalar(muzzleSpeed);

    const positions = this.aimLine.geometry.attributes.position;
    const dt = 0.07;
    let curPos = startPos.clone();
    let curVel = velocity.clone();

    for (let i = 0; i < 30; i++) {
      positions.setXYZ(i, curPos.x, curPos.y, curPos.z);
      curPos.addScaledVector(curVel, dt);
      curVel.y -= gravity * dt;

      // Stop arc at water level
      if (curPos.y < this.ocean.getWaveHeight(curPos.x, curPos.z)) {
        for (let j = i + 1; j < 30; j++) {
          positions.setXYZ(j, curPos.x, curPos.y, curPos.z);
        }
        break;
      }
    }
    positions.needsUpdate = true;
  }

  hideAimArc() {
    if (this.aimLine) this.aimLine.visible = false;
  }

  // Fire a broadside salvo of cannonballs
  fireBroadside(firingShip, targetShip, side) {
    const muzzlePositions = firingShip.getCannonOrigins(side);
    const right = firingShip.getRightVector();
    const fireDir = side === 'port' ? right.clone().negate() : right.clone();

    this.sound.playCannonBlast();

    muzzlePositions.forEach((origin, index) => {
      // Stagger cannon shots slightly for realistic volley sound & visual
      setTimeout(() => {
        if (!firingShip.group.parent) return;

        // Spread & elevation variation
        const spread = (Math.random() - 0.5) * 0.08;
        const elevation = 0.26 + (Math.random() - 0.5) * 0.04;
        const ballDir = fireDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
        ballDir.y = elevation;
        ballDir.normalize();

        const speed = 40.0 + (Math.random() - 0.5) * 4.0;
        const velocity = ballDir.multiplyScalar(speed);

        // Spawn ball mesh
        const mesh = new THREE.Mesh(this.ballGeo, this.ballMat);
        mesh.position.copy(origin);
        this.scene.add(mesh);

        this.cannonballs.push({
          mesh,
          velocity,
          firingShip,
          targetShip,
          alive: true,
          age: 0
        });

        // Muzzle smoke and flash
        this.spawnMuzzleFlash(origin);
        this.spawnSmoke(origin, fireDir);
      }, index * 90);
    });
  }

  spawnMuzzleFlash(pos) {
    const light = new THREE.PointLight(0xffaa22, 5.0, 10.0);
    light.position.copy(pos);
    this.scene.add(light);
    this.flashes.push({ light, life: 0.12 });
  }

  spawnSmoke(pos, dir) {
    for (let i = 0; i < 4; i++) {
      const geo = new THREE.SphereGeometry(0.8 + Math.random() * 0.6, 6, 6);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xdddddd,
        transparent: true,
        opacity: 0.7
      });
      const smoke = new THREE.Mesh(geo, mat);
      smoke.position.copy(pos).add(new THREE.Vector3(
        (Math.random() - 0.5) * 1.5,
        Math.random() * 0.8,
        (Math.random() - 0.5) * 1.5
      ));
      this.scene.add(smoke);

      this.particles.push({
        mesh: smoke,
        velocity: dir.clone().multiplyScalar(4 + Math.random() * 3).add(new THREE.Vector3(0, 1.5, 0)),
        maxLife: 1.2,
        life: 0,
        scaleSpeed: 2.2
      });
    }
  }

  spawnWaterSplash(pos) {
    this.sound.playWaterSplash();
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.SphereGeometry(0.4 + Math.random() * 0.3, 5, 5);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8
      });
      const drop = new THREE.Mesh(geo, mat);
      drop.position.copy(pos);
      this.scene.add(drop);

      this.particles.push({
        mesh: drop,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 6.0,
          6.0 + Math.random() * 5.0,
          (Math.random() - 0.5) * 6.0
        ),
        gravity: 16.0,
        maxLife: 0.9,
        life: 0,
        scaleSpeed: -0.3
      });
    }
  }

  spawnSplinterExplosion(pos) {
    this.sound.playHullImpact();
    // Wood splinters
    for (let i = 0; i < 12; i++) {
      const geo = new THREE.BoxGeometry(0.15, 0.5 + Math.random() * 0.4, 0.15);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x6b4423,
        roughness: 0.9
      });
      const splinter = new THREE.Mesh(geo, mat);
      splinter.position.copy(pos);
      this.scene.add(splinter);

      this.particles.push({
        mesh: splinter,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 10.0,
          5.0 + Math.random() * 7.0,
          (Math.random() - 0.5) * 10.0
        ),
        gravity: 15.0,
        maxLife: 1.1,
        life: 0,
        rotSpeed: (Math.random() - 0.5) * 15.0
      });
    }

    // Fire explosion flash
    const light = new THREE.PointLight(0xff5500, 7.0, 15.0);
    light.position.copy(pos);
    this.scene.add(light);
    this.flashes.push({ light, life: 0.2 });
  }

  update(delta) {
    const gravity = 18.0;

    // 1. Update Cannonballs
    for (let i = this.cannonballs.length - 1; i >= 0; i--) {
      const b = this.cannonballs[i];
      b.age += delta;

      // Ballistic physics
      b.mesh.position.addScaledVector(b.velocity, delta);
      b.velocity.y -= gravity * delta;

      const waveH = this.ocean.getWaveHeight(b.mesh.position.x, b.mesh.position.z);

      // Check collision with Target Ship Hull
      if (b.targetShip && !b.targetShip.isSinking) {
        const dist = b.mesh.position.distanceTo(b.targetShip.position);
        if (dist < 6.8 && b.mesh.position.y > waveH - 1.0 && b.mesh.position.y < waveH + 6.0) {
          // Hit Target!
          this.spawnSplinterExplosion(b.mesh.position);
          b.targetShip.takeDamage(20);
          this.scene.remove(b.mesh);
          this.cannonballs.splice(i, 1);
          continue;
        }
      }

      // Check water splash
      if (b.mesh.position.y <= waveH) {
        const splashPos = b.mesh.position.clone();
        splashPos.y = waveH;
        this.spawnWaterSplash(splashPos);
        this.scene.remove(b.mesh);
        this.cannonballs.splice(i, 1);
        continue;
      }

      // Max lifetime failsafe
      if (b.age > 4.5) {
        this.scene.remove(b.mesh);
        this.cannonballs.splice(i, 1);
      }
    }

    // 2. Update Particles (smoke, splinters, splash)
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += delta;
      const progress = p.life / p.maxLife;

      p.mesh.position.addScaledVector(p.velocity, delta);
      if (p.gravity) {
        p.velocity.y -= p.gravity * delta;
      }

      if (p.rotSpeed) {
        p.mesh.rotation.x += p.rotSpeed * delta;
        p.mesh.rotation.z += p.rotSpeed * delta;
      }

      if (p.scaleSpeed) {
        p.mesh.scale.addScalar(p.scaleSpeed * delta);
      }

      if (p.mesh.material.opacity !== undefined) {
        p.mesh.material.opacity = (1.0 - progress) * 0.8;
      }

      if (p.life >= p.maxLife) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }

    // 3. Update Muzzle Flash Lights
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= delta;
      if (f.life <= 0) {
        this.scene.remove(f.light);
        this.flashes.splice(i, 1);
      }
    }
  }
}
