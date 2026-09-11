import * as THREE from 'three';

export class CombatSystem {
  constructor(scene, ocean, sound) {
    this.scene = scene;
    this.ocean = ocean;
    this.sound = sound;

    this.cannonballs = [];
    this.particles = [];
    this.flashes = [];
    this.damageNumbers = [];
    this.onShipHit = null;
    this.playerDamageMultiplier = 1.0;
    this.enemyDamageMultiplier = 1.0;

    // Cannonball material & geometry
    this.ballGeo = new THREE.SphereGeometry(0.26, 8, 8);
    this.ballMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.3,
      metalness: 0.9
    });

    // Initialize Long-Range Aiming System (Yellow Transparent Sector + Ballistic Arc)
    this.initAimVisuals();
  }

  setDifficultyMultipliers(playerMult = 1.0, enemyMult = 1.0) {
    this.playerDamageMultiplier = playerMult;
    this.enemyDamageMultiplier = enemyMult;
  }

  initAimVisuals() {
    this.aimGroup = new THREE.Group();
    this.scene.add(this.aimGroup);
    this.aimGroup.visible = false;

    // 1. Yellow Transparent Water Impact Sector Mesh
    // 32 angular segments -> 33 inner and 33 outer vertices (66 total)
    this.sectorSegments = 32;
    const vertexCount = (this.sectorSegments + 1) * 2;
    const sectorPositions = new Float32Array(vertexCount * 3);
    const sectorIndices = new Uint16Array(this.sectorSegments * 6);

    for (let i = 0; i < this.sectorSegments; i++) {
      const i0 = i * 2;
      const i1 = i * 2 + 1;
      const i2 = (i + 1) * 2;
      const i3 = (i + 1) * 2 + 1;

      sectorIndices[i * 6 + 0] = i0;
      sectorIndices[i * 6 + 1] = i1;
      sectorIndices[i * 6 + 2] = i2;
      sectorIndices[i * 6 + 3] = i2;
      sectorIndices[i * 6 + 4] = i1;
      sectorIndices[i * 6 + 5] = i3;
    }

    const sectorGeo = new THREE.BufferGeometry();
    sectorGeo.setAttribute('position', new THREE.BufferAttribute(sectorPositions, 3));
    sectorGeo.setIndex(new THREE.BufferAttribute(sectorIndices, 1));

    this.aimSectorMat = new THREE.MeshBasicMaterial({
      color: 0xffeb3b,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.aimSectorMesh = new THREE.Mesh(sectorGeo, this.aimSectorMat);
    this.aimSectorMesh.renderOrder = 3;
    this.aimSectorMesh.frustumCulled = false;
    this.aimGroup.add(this.aimSectorMesh);

    // 2. Outer Impact Arc Line (where cannons will hit at maximum range)
    const impactPositions = new Float32Array((this.sectorSegments + 1) * 3);
    const impactGeo = new THREE.BufferGeometry();
    impactGeo.setAttribute('position', new THREE.BufferAttribute(impactPositions, 3));
    this.aimImpactLineMat = new THREE.LineBasicMaterial({
      color: 0xffeb3b,
      linewidth: 3,
      transparent: true,
      opacity: 0.85,
      depthTest: true,
      depthWrite: false
    });
    this.aimImpactLine = new THREE.Line(impactGeo, this.aimImpactLineMat);
    this.aimImpactLine.renderOrder = 4;
    this.aimImpactLine.frustumCulled = false;
    this.aimGroup.add(this.aimImpactLine);

    // 3. Central Long-Range Ballistic Trajectory Line
    const trajectoryPoints = 36;
    const centerPositions = new Float32Array(trajectoryPoints * 3);
    const centerColors = new Float32Array(trajectoryPoints * 3);

    for (let i = 0; i < trajectoryPoints; i++) {
      const p = i / (trajectoryPoints - 1);
      centerColors[i * 3 + 0] = 1.0;
      centerColors[i * 3 + 1] = 0.95 - p * 0.15;
      centerColors[i * 3 + 2] = 0.2 + p * 0.2;
    }

    const centerGeo = new THREE.BufferGeometry();
    centerGeo.setAttribute('position', new THREE.BufferAttribute(centerPositions, 3));
    centerGeo.setAttribute('color', new THREE.BufferAttribute(centerColors, 3));
    this.aimCenterLineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      linewidth: 3,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false
    });
    this.aimCenterLine = new THREE.Line(centerGeo, this.aimCenterLineMat);
    this.aimCenterLine.renderOrder = 5;
    this.aimCenterLine.frustumCulled = false;
    this.aimGroup.add(this.aimCenterLine);

    // 4. Boundary Guide Lines (Left and Right edges of the narrow cone)
    const edgeGeoL = new THREE.BufferGeometry();
    edgeGeoL.setAttribute('position', new THREE.BufferAttribute(new Float32Array(trajectoryPoints * 3), 3));
    const edgeGeoR = new THREE.BufferGeometry();
    edgeGeoR.setAttribute('position', new THREE.BufferAttribute(new Float32Array(trajectoryPoints * 3), 3));
    this.aimEdgeMat = new THREE.LineBasicMaterial({
      color: 0xffd54f,
      linewidth: 1.5,
      transparent: true,
      opacity: 0.65,
      depthTest: true,
      depthWrite: false
    });
    this.aimLeftLine = new THREE.Line(edgeGeoL, this.aimEdgeMat);
    this.aimRightLine = new THREE.Line(edgeGeoR, this.aimEdgeMat);
    this.aimLeftLine.renderOrder = 4;
    this.aimRightLine.renderOrder = 4;
    this.aimLeftLine.frustumCulled = false;
    this.aimRightLine.frustumCulled = false;
    this.aimGroup.add(this.aimLeftLine);
    this.aimGroup.add(this.aimRightLine);

    // 5. Impact Reticle Marker on Water
    const reticleGeo = new THREE.RingGeometry(1.8, 2.6, 24);
    reticleGeo.rotateX(-Math.PI * 0.5);
    this.aimReticleMat = new THREE.MeshBasicMaterial({
      color: 0xffeb3b,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false
    });
    this.aimReticle = new THREE.Mesh(reticleGeo, this.aimReticleMat);
    this.aimReticle.renderOrder = 6;
    this.aimReticle.frustumCulled = false;
    this.aimGroup.add(this.aimReticle);

    this.aimGroup.frustumCulled = false;

    // Backward compatibility
    this.aimLine = this.aimCenterLine;
  }

  updateAimSector(playerShip, side, charge = 0, enemies = []) {
    if (!this.aimGroup || !playerShip) return;

    const chargeClamped = Math.max(0, Math.min(1.0, charge));

    // Dynamic Attack Range: 45m (quick tap) up to 145m (fully held charge)
    const minRange = 45.0;
    const maxRange = 145.0;
    const range = THREE.MathUtils.lerp(minRange, maxRange, chargeClamped);

    // Dynamic Spread Angle: Wide (~22 deg) down to razor-sharp (~3.2 deg) as charge increases
    const maxSpread = 0.38; // wide scatter
    const minSpread = 0.055; // narrow focused salvo
    const spreadAngle = THREE.MathUtils.lerp(maxSpread, minSpread, chargeClamped);

    // Launch Ballistics Parameters: Low elevation (~9.2 deg) keeps trajectory close to water level
    // ensuring cannonballs slice directly through hulls & rigging along the entire firing line!
    const gravity = 18.0;
    const alpha = 0.16; // Authentic low naval elevation (~9.2 deg)
    const cosA = Math.cos(alpha);
    const sinA = Math.sin(alpha);
    const y0 = 2.0;
    const muzzleSpeed = Math.sqrt((gravity * range * range) / (2 * cosA * cosA * (y0 + range * (sinA / cosA))));

    const right = playerShip.getRightVector();
    const broadsideDir = side === 'port' ? right.clone().negate() : right.clone();
    const forward = playerShip.getForwardVector();
    const shipCenter = playerShip.position;
    const heave = (typeof playerShip.heave === 'number' && !isNaN(playerShip.heave)) ? playerShip.heave : 0;

    // Check if ANY enemy ship is on the yellow line or within the broadside sector
    let isTargetLocked = false;
    let lockedEnemy = null;
    let closestLockedDist = Infinity;

    const activeEnemies = Array.isArray(enemies) ? enemies : (enemies ? [enemies] : []);
    for (const enemy of activeEnemies) {
      if (enemy && enemy.ship && !enemy.ship.isSinking) {
        const toEnemy = enemy.ship.position.clone().sub(shipCenter);
        // Distance along the broadside firing direction
        const lateralDist = toEnemy.dot(broadsideDir);
        // Distance perpendicular to broadside firing direction (along ship forward axis)
        const forwardOffset = Math.abs(toEnemy.dot(forward));

        // Effective sector half-width at distance lateralDist
        const sectorHalfWidth = Math.max(4.2, lateralDist * Math.tan(spreadAngle) + 4.2);

        // Check if enemy intersects yellow line / sector anywhere between 4m and range + 8m
        if (lateralDist >= 4.0 && lateralDist <= range + 8.0 && forwardOffset <= sectorHalfWidth + 5.5) {
          isTargetLocked = true;
          if (lateralDist < closestLockedDist) {
            closestLockedDist = lateralDist;
            lockedEnemy = enemy;
          }
        }
      }
    }

    // Dynamic Visual Styling: Golden Yellow normally, Fiery Red when locked on target!
    if (isTargetLocked) {
      this.aimSectorMat.color.setHex(0xff3d00);
      this.aimSectorMat.opacity = 0.42;
      this.aimImpactLineMat.color.setHex(0xff1744);
      this.aimReticleMat.color.setHex(0xff1744);
      this.aimEdgeMat.color.setHex(0xff5722);
    } else {
      this.aimSectorMat.color.setHex(0xffeb3b);
      this.aimSectorMat.opacity = 0.30;
      this.aimImpactLineMat.color.setHex(0xffd54f);
      this.aimReticleMat.color.setHex(0xffd54f);
      this.aimEdgeMat.color.setHex(0xffd54f);
    }

    // 1. Update Yellow Transparent Water Impact Sector Mesh & Outer Impact Line
    const sectorPosAttr = this.aimSectorMesh.geometry.attributes.position;
    const impactPosAttr = this.aimImpactLine.geometry.attributes.position;
    const N = this.sectorSegments;

    for (let i = 0; i <= N; i++) {
      const frac = i / N;
      const angle = -spreadAngle + frac * (2 * spreadAngle);

      // Radial direction for this segment
      const dirX = broadsideDir.x * Math.cos(angle) + forward.x * Math.sin(angle);
      const dirZ = broadsideDir.z * Math.cos(angle) + forward.z * Math.sin(angle);

      // Inner point: along ship broadside hull
      const innerOffset = (frac - 0.5) * 7.5;
      const inX = shipCenter.x + broadsideDir.x * 3.4 + forward.x * innerOffset;
      const inZ = shipCenter.z + broadsideDir.z * 3.4 + forward.z * innerOffset;
      const inY = this.ocean.getWaveHeight(inX, inZ) + 0.25;

      // Outer point: at exact impact range R
      const outX = shipCenter.x + dirX * range;
      const outZ = shipCenter.z + dirZ * range;
      const outY = this.ocean.getWaveHeight(outX, outZ) + 0.35;

      sectorPosAttr.setXYZ(i * 2 + 0, inX, inY, inZ);
      sectorPosAttr.setXYZ(i * 2 + 1, outX, outY, outZ);

      impactPosAttr.setXYZ(i, outX, outY, outZ);
    }
    sectorPosAttr.needsUpdate = true;
    impactPosAttr.needsUpdate = true;
    if (this.aimSectorMesh.geometry.computeBoundingSphere) this.aimSectorMesh.geometry.computeBoundingSphere();
    if (this.aimImpactLine.geometry.computeBoundingSphere) this.aimImpactLine.geometry.computeBoundingSphere();

    // 2. Update Central Long-Range Ballistic Trajectory Line
    const trajectoryPoints = 36;
    const totalFlightTime = range / (muzzleSpeed * cosA);
    const dt = totalFlightTime / (trajectoryPoints - 1);
    const centerPosAttr = this.aimCenterLine.geometry.attributes.position;

    const startPos = shipCenter.clone().addScaledVector(broadsideDir, 2.8);
    startPos.y = heave + y0;

    for (let j = 0; j < trajectoryPoints; j++) {
      const t = j * dt;
      const curX = startPos.x + muzzleSpeed * cosA * broadsideDir.x * t;
      const curY = startPos.y + (muzzleSpeed * sinA * t) - (0.5 * gravity * t * t);
      const curZ = startPos.z + muzzleSpeed * cosA * broadsideDir.z * t;
      centerPosAttr.setXYZ(j, curX, Math.max(curY, this.ocean.getWaveHeight(curX, curZ) + 0.35), curZ);
    }
    centerPosAttr.needsUpdate = true;
    if (this.aimCenterLine.geometry.computeBoundingSphere) this.aimCenterLine.geometry.computeBoundingSphere();

    // 3. Update Left and Right Edge Boundary Lines
    const leftPosAttr = this.aimLeftLine.geometry.attributes.position;
    const rightPosAttr = this.aimRightLine.geometry.attributes.position;

    const leftDirX = broadsideDir.x * Math.cos(-spreadAngle) + forward.x * Math.sin(-spreadAngle);
    const leftDirZ = broadsideDir.z * Math.cos(-spreadAngle) + forward.z * Math.sin(-spreadAngle);
    const rightDirX = broadsideDir.x * Math.cos(spreadAngle) + forward.x * Math.sin(spreadAngle);
    const rightDirZ = broadsideDir.z * Math.cos(spreadAngle) + forward.z * Math.sin(spreadAngle);

    const startPosLeft = shipCenter.clone().addScaledVector(broadsideDir, 2.8).addScaledVector(forward, -3.5);
    startPosLeft.y = heave + y0;
    const startPosRight = shipCenter.clone().addScaledVector(broadsideDir, 2.8).addScaledVector(forward, 3.5);
    startPosRight.y = heave + y0;

    for (let j = 0; j < trajectoryPoints; j++) {
      const t = j * dt;
      const curY = startPos.y + (muzzleSpeed * sinA * t) - (0.5 * gravity * t * t);

      const lx = startPosLeft.x + muzzleSpeed * cosA * leftDirX * t;
      const lz = startPosLeft.z + muzzleSpeed * cosA * leftDirZ * t;
      leftPosAttr.setXYZ(j, lx, Math.max(curY, this.ocean.getWaveHeight(lx, lz) + 0.35), lz);

      const rx = startPosRight.x + muzzleSpeed * cosA * rightDirX * t;
      const rz = startPosRight.z + muzzleSpeed * cosA * rightDirZ * t;
      rightPosAttr.setXYZ(j, rx, Math.max(curY, this.ocean.getWaveHeight(rx, rz) + 0.35), rz);
    }
    leftPosAttr.needsUpdate = true;
    rightPosAttr.needsUpdate = true;
    if (this.aimLeftLine.geometry.computeBoundingSphere) this.aimLeftLine.geometry.computeBoundingSphere();
    if (this.aimRightLine.geometry.computeBoundingSphere) this.aimRightLine.geometry.computeBoundingSphere();

    // 4. Update Impact Reticle Marker on the Water
    // If an enemy is on the yellow line, reticle highlights that enemy; otherwise marks the end circle!
    let centerImpactX, centerImpactZ;
    if (lockedEnemy) {
      centerImpactX = lockedEnemy.ship.position.x;
      centerImpactZ = lockedEnemy.ship.position.z;
    } else {
      centerImpactX = shipCenter.x + broadsideDir.x * range;
      centerImpactZ = shipCenter.z + broadsideDir.z * range;
    }
    const centerImpactY = this.ocean.getWaveHeight(centerImpactX, centerImpactZ) + 0.18;
    this.aimReticle.position.set(centerImpactX, centerImpactY, centerImpactZ);

    const pulse = 1.0 + Math.sin(performance.now() * 0.01) * 0.16;
    this.aimReticle.scale.set(pulse, pulse, pulse);

    this.aimGroup.visible = true;

    return { isTargetLocked, lockedEnemy, closestLockedDist };
  }

  hideAimSector() {
    if (this.aimGroup) {
      this.aimGroup.visible = false;
    }
  }

  updateAimArc(playerShip, side, range = 55.0) {
    this.updateAimSector(playerShip, side, 0.15);
  }

  hideAimArc() {
    this.hideAimSector();
  }

  // Fire a broadside salvo of cannonballs with dynamic charge-based velocity and narrow spread
  fireBroadside(firingShip, targetShip, side, charge = 0, isRemoteVisual = false) {
    const muzzlePositions = firingShip.getCannonOrigins(side);
    const right = firingShip.getRightVector();
    const broadsideDir = side === 'port' ? right.clone().negate() : right.clone();

    const chargeClamped = Math.max(0, Math.min(1.0, charge));

    // Dynamic Range: 45m (quick tap) up to 145m (fully charged hold)
    const minRange = 45.0;
    const maxRange = 145.0;
    const range = THREE.MathUtils.lerp(minRange, maxRange, chargeClamped);

    const gravity = 18.0;
    const alpha = 0.16; // Low, authentic naval trajectory (~9.2 deg)
    const cosA = Math.cos(alpha);
    const sinA = Math.sin(alpha);
    const y0 = 2.0;
    const baseMuzzleSpeed = Math.sqrt((gravity * range * range) / (2 * cosA * cosA * (y0 + range * (sinA / cosA))));

    // Spread narrows from 0.08 rad down to 0.014 rad as charge increases
    const spreadMax = THREE.MathUtils.lerp(0.08, 0.014, chargeClamped);

    this.sound.playCannonBlast();

    const fireOrigin = firingShip.position.clone();

    muzzlePositions.forEach((origin, index) => {
      setTimeout(() => {
        if (!firingShip.group.parent) return;

        // Narrowing spread matches the yellow transparent area
        const spread = (Math.random() - 0.5) * 2.0 * spreadMax;
        const elevation = alpha + (Math.random() - 0.5) * 0.015;

        const ballDir = broadsideDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
        ballDir.y = elevation;
        ballDir.normalize();

        const speed = baseMuzzleSpeed + (Math.random() - 0.5) * 1.5;
        const velocity = ballDir.multiplyScalar(speed);

        // Spawn ball mesh
        const mesh = new THREE.Mesh(this.ballGeo, this.ballMat);
        mesh.position.copy(origin);
        this.scene.add(mesh);

        this.cannonballs.push({
          mesh,
          velocity,
          firingShip,
          firingOrigin: fireOrigin.clone(),
          targetShip,
          alive: true,
          age: 0,
          charge: chargeClamped,
          prevPos: origin.clone(),
          isRemoteVisual
        });

        // Muzzle smoke and flash
        this.spawnMuzzleFlash(origin);
        this.spawnSmoke(origin, broadsideDir);
      }, index * 85);
    });
  }

  // Floating 3D Damage Indicator: Shows "-58 POINT BLANK!" / "-38 CLOSE HIT" / "-18"
  spawnDamageNumber(pos, amount, hitDist) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isPointBlank = hitDist <= 32;
    const isClose = hitDist <= 58;

    ctx.clearRect(0, 0, 256, 128);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (isPointBlank) {
      // Golden glowing point blank critical
      ctx.shadowColor = 'rgba(255, 109, 0, 0.95)';
      ctx.shadowBlur = 18;
      ctx.font = '900 52px Impact, sans-serif';
      ctx.fillStyle = '#ffea00';
      ctx.fillText(`-${amount}`, 128, 46);

      ctx.shadowColor = 'rgba(255, 23, 68, 0.95)';
      ctx.shadowBlur = 10;
      ctx.font = 'bold 22px sans-serif';
      ctx.fillStyle = '#ff3d00';
      ctx.fillText('POINT BLANK!', 128, 96);
    } else if (isClose) {
      ctx.shadowColor = 'rgba(213, 0, 0, 0.9)';
      ctx.shadowBlur = 14;
      ctx.font = '900 48px Impact, sans-serif';
      ctx.fillStyle = '#ff5252';
      ctx.fillText(`-${amount}`, 128, 52);

      ctx.shadowColor = 'rgba(255, 23, 68, 0.8)';
      ctx.shadowBlur = 8;
      ctx.font = 'bold 20px sans-serif';
      ctx.fillStyle = '#ff8a80';
      ctx.fillText('CLOSE HIT', 128, 96);
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 10;
      ctx.font = '900 44px Impact, sans-serif';
      ctx.fillStyle = '#ff7043';
      ctx.fillText(`-${amount}`, 128, 64);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      depthTest: false
    });

    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(pos).add(new THREE.Vector3(
      (Math.random() - 0.5) * 1.5,
      3.2 + Math.random() * 1.2,
      (Math.random() - 0.5) * 1.5
    ));
    const scale = isPointBlank ? 13 : (isClose ? 11 : 8.5);
    sprite.scale.set(scale, scale * 0.5, 1);
    this.scene.add(sprite);

    this.damageNumbers.push({
      sprite,
      texture,
      mat,
      life: 0,
      maxLife: 1.25,
      vy: 4.8
    });
  }

  // Floating 3D Reward Notification: e.g. "+50 HP REPAIRED!" or "+350 GOLD LOOTED!"
  spawnFloatingReward(pos, text, subtext, color = '#69f0ae') {
    const canvas = document.createElement('canvas');
    canvas.width = 340;
    canvas.height = 140;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, 340, 140);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.font = '900 46px Impact, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(text, 170, 48);

    if (subtext) {
      ctx.shadowBlur = 10;
      ctx.font = 'bold 22px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(subtext, 170, 96);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      depthTest: false
    });

    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(pos).add(new THREE.Vector3(0, 5.2, 0));
    sprite.scale.set(16, 6.5, 1);
    this.scene.add(sprite);

    this.damageNumbers.push({
      sprite,
      texture,
      mat,
      life: 0,
      maxLife: 2.2,
      vy: 3.6
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
    const count = Math.max(3, Math.round(8 * (this.particleMultiplier || 1.0)));
    for (let i = 0; i < count; i++) {
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
    const count = Math.max(4, Math.round(12 * (this.particleMultiplier || 1.0)));
    for (let i = 0; i < count; i++) {
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
      const prevPos = b.mesh.position.clone();
      b.mesh.position.addScaledVector(b.velocity, delta);
      b.velocity.y -= gravity * delta;
      const currPos = b.mesh.position;

      const waveH = this.ocean.getWaveHeight(currPos.x, currPos.z);

      // Check collision with Target Ship(s) along the line of fire
      const targets = Array.isArray(b.targetShip) ? b.targetShip : (b.targetShip ? [b.targetShip] : []);
      let hit = false;

      for (let t = 0; t < targets.length; t++) {
        const tShip = targets[t];
        if (!tShip || tShip.isSinking || tShip === b.firingShip) continue;

        const shipPos = tShip.position;
        const shipWaveH = this.ocean.getWaveHeight(shipPos.x, shipPos.z);
        const shipFwd = tShip.getForwardVector();
        const shipRight = tShip.getRightVector();

        // Continuous Collision Detection: test current position and midpoint of segment
        const testPositions = [currPos, prevPos.clone().add(currPos).multiplyScalar(0.5)];

        for (const testPos of testPositions) {
          const rel = testPos.clone().sub(shipPos);
          const localFwd = rel.dot(shipFwd);
          const localLat = rel.dot(shipRight);
          const localVert = testPos.y - shipWaveH;

          const inOrientedBox = Math.abs(localFwd) <= 9.2 && Math.abs(localLat) <= 4.6 && localVert >= -1.5 && localVert <= 16.5;
          const horizontalDist = Math.sqrt(rel.x * rel.x + rel.z * rel.z);
          const inCylinder = horizontalDist <= 7.5 && localVert >= -1.5 && localVert <= 16.5;

          if (inOrientedBox || inCylinder) {
            // DIRECT HIT on ship along the yellow line / trajectory!
            const fireOrigin = b.firingOrigin || (b.firingShip ? b.firingShip.position : shipPos);
            const hitDist = currPos.distanceTo(fireOrigin);

            // "MORE NEAR MORE DAMAGE" - Balanced Naval Combat:
            // Point-blank range (<=12m) deals 1.35x damage (~8 to 11 dmg per ball)
            // Mid-range (60m) deals 1.0x damage (~6 to 8 dmg per ball)
            // Maximum range (145m) deals 0.75x damage (~4 to 6 dmg per ball)
            // A full 4-ball broadside volley deals ~24-34 damage total, requiring 3-4 tactical volleys to sink a 100 HP ship!
            const minProximityDist = 12.0;
            const maxProximityDist = 145.0;
            const proximity = 1.0 - THREE.MathUtils.clamp((hitDist - minProximityDist) / (maxProximityDist - minProximityDist), 0.0, 1.0);
            const proximityMultiplier = THREE.MathUtils.lerp(0.75, 1.35, proximity);

            const isPlayerFiring = (b.firingShip && b.firingShip.isPlayer);
            const baseBallDamage = isPlayerFiring ? 6 : 5;
            const chargeBonus = Math.round((b.charge || 0) * 2);
            const dmgMult = isPlayerFiring ? (this.playerDamageMultiplier || 1.0) : (this.enemyDamageMultiplier || 1.0);
            const finalDamage = Math.max(3, Math.round((baseBallDamage + chargeBonus) * proximityMultiplier * dmgMult));

            if (!b.isRemoteVisual) {
              tShip.takeDamage(finalDamage);
              if (this.onShipHit) {
                this.onShipHit(tShip, finalDamage, hitDist);
              }
            }
            this.spawnSplinterExplosion(currPos);
            this.spawnDamageNumber(currPos, finalDamage, hitDist);

            this.scene.remove(b.mesh);
            this.cannonballs.splice(i, 1);
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
      if (hit) continue;

      // Check water splash
      if (currPos.y <= waveH) {
        const splashPos = currPos.clone();
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

    // 4. Update Floating 3D Damage Numbers
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const d = this.damageNumbers[i];
      d.life += delta;
      d.sprite.position.y += d.vy * delta;
      d.vy *= 0.93;
      const progress = d.life / d.maxLife;
      d.mat.opacity = Math.max(0, 1.0 - progress);

      if (d.life >= d.maxLife) {
        this.scene.remove(d.sprite);
        d.texture.dispose();
        d.mat.dispose();
        this.damageNumbers.splice(i, 1);
      }
    }
  }
}
