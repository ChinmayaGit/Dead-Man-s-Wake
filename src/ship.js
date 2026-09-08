import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

function createFoamTexture() {
  if (typeof document === 'undefined') return new THREE.Texture();
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  grad.addColorStop(0.35, 'rgba(220, 245, 255, 0.8)');
  grad.addColorStop(0.7, 'rgba(180, 230, 255, 0.35)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}

// Authentic Speed Presets from Ubisoft Montpellier: PlayerImmersivePhysics.lua (Lines 24-57)
export const SPEED_PRESETS = [
  // NO_SAIL (Index 0)
  {
    name: 'NO_SAIL',
    acceleration: 0,
    deceleration: 4.0,
    angularDeceleration: 1.2,
    targetVelocity: 0,
    maxAngularVelocity: Math.PI / 4, // 45 deg/s (0.785 rad/s)
    angularAcceleration: 0.12 * 7.5, // 0.90 rad/s²
  },
  // HALF_SAIL (Index 1)
  {
    name: 'HALF_SAIL',
    acceleration: 2.5,
    deceleration: 2.0,
    angularDeceleration: 1.0,
    targetVelocity: 8.5, // ~11 knots cruising speed
    maxAngularVelocity: Math.PI / 5, // 36 deg/s (0.628 rad/s)
    angularAcceleration: 0.10 * 7.5, // 0.75 rad/s²
  },
  // FULL_SAIL (Index 2)
  {
    name: 'FULL_SAIL',
    acceleration: 3.0,
    deceleration: 2.0,
    angularDeceleration: 1.0,
    targetVelocity: 17.5, // ~23 knots fast sailing
    maxAngularVelocity: Math.PI / 8, // 22.5 deg/s (0.392 rad/s)
    angularAcceleration: 0.08 * 7.5, // 0.60 rad/s²
  }
];

export class Ship {
  constructor(scene, ocean, isPlayer = true, modelName = 'ship-pirate-large.glb', maxHealth = 100) {
    this.scene = scene;
    this.ocean = ocean;
    this.isPlayer = isPlayer;
    this.modelName = modelName;

    // Ship State
    this.position = new THREE.Vector3(0, 0, 0);
    this.heading = 0; // 0 = forward along -Z (North)
    this.speed = 0;
    this.targetSpeed = 0;
    this.sailState = 2; // 0: Furled, 1: Half Sail, 2: Full Sail
    this.rudder = 0; // -1.0 (Port/Left) to +1.0 (Starboard/Right)
    this.targetRudder = 0;
    this.currentAngularVelocity = 0; // rad/s
    this.targetAngularVelocity = 0;
    this.maxHealth = maxHealth;
    this.health = maxHealth;
    this.isSinking = false;
    this.sinkProgress = 0;

    // Buoyancy state (from _WaterInfluencePhysics.lua)
    this.pitch = 0;
    this.roll = 0;
    this.heave = 0;
    this.rollBuoyancyCounter = 0;
    this.rollBuoyancySign = 1;

    // Sails list for furling animation
    this.sailsList = [];

    // Main 3D Container
    this.group = new THREE.Group();
    this.modelContainer = new THREE.Group();
    this.group.add(this.modelContainer);
    this.scene.add(this.group);

    // Build fallback visual immediately so there's never a blank frame
    this.buildFallbackShip();

    // Load actual Kenney 3D GLB Model Asset
    this.loadGLBModel(modelName);

    // Wake particle trail
    this.initWakeParticles();
  }

  buildFallbackShip() {
    const fallbackGroup = new THREE.Group();

    // Basic Hull
    const hullMat = new THREE.MeshStandardMaterial({
      color: this.isPlayer ? 0x4a2e1b : 0x2e1a1a,
      roughness: 0.7
    });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0xc49b66, roughness: 0.6 });
    const sailMat = new THREE.MeshStandardMaterial({
      color: this.isPlayer ? 0xf0e6d2 : 0xffffff,
      side: THREE.DoubleSide
    });

    const hullGeo = new THREE.BoxGeometry(5.0, 3.5, 14.0);
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.y = 1.6;
    fallbackGroup.add(hull);

    const deckGeo = new THREE.BoxGeometry(4.6, 0.4, 13.4);
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.y = 3.5;
    fallbackGroup.add(deck);

    // Masts & basic sails
    [-3.5, 0.5, 4.0].forEach((z, idx) => {
      const h = idx === 1 ? 12 : 9;
      const mastGeo = new THREE.CylinderGeometry(0.2, 0.25, h, 6);
      const mast = new THREE.Mesh(mastGeo, hullMat);
      mast.position.set(0, h * 0.5 + 3.5, z);
      fallbackGroup.add(mast);

      const sailGeo = new THREE.PlaneGeometry(5.0, 3.0);
      const sail = new THREE.Mesh(sailGeo, sailMat);
      sail.position.set(0, h * 0.6 + 3.5, z - 0.2);
      fallbackGroup.add(sail);
    });

    this.fallbackMesh = fallbackGroup;
    this.modelContainer.add(fallbackGroup);
  }

  loadGLBModel(modelName) {
    const loader = new GLTFLoader();
    loader.setPath('/models/');

    loader.load(
      modelName,
      (gltf) => {
        // Remove fallback
        if (this.fallbackMesh) {
          this.modelContainer.remove(this.fallbackMesh);
          this.fallbackMesh = null;
        }

        const model = gltf.scene;

        // Scale model appropriately (around 1.8x for impressive presence)
        model.scale.set(1.8, 1.8, 1.8);

        // Crucial: Rotate 180 deg so Kenney ship model bow points along -Z (forward)
        model.rotation.y = Math.PI;

        // Adjust waterline height offset
        model.position.y = 0.6;

        // Traverse to enable shadows and optimize materials
        this.sailsList = [];
        model.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;

            // Detect sails for furling/unfurling animation
            if (child.name.toLowerCase().includes('sail') || (child.parent && child.parent.name.toLowerCase().includes('sail'))) {
              this.sailsList.push(child);
            }
          }
        });

        this.modelContainer.add(model);
        this.loadedModel = model;
        console.log(`⛵ [AC Pirates] 3D model loaded successfully: ${modelName}`);
      },
      undefined,
      (err) => {
        console.warn(`Could not load GLB ${modelName}, using procedural ship`, err);
      }
    );
  }

  initWakeParticles() {
    this.wakeMax = 100;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(this.wakeMax * 3);

    for (let i = 0; i < this.wakeMax; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = -100;
      positions[i * 3 + 2] = 0;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 7.5,
      map: createFoamTexture(),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      sizeAttenuation: true
    });

    this.wakeParticles = new THREE.Points(geo, mat);
    this.wakeParticles.renderOrder = 2;
    this.scene.add(this.wakeParticles);
    this.wakeHistory = [];
  }

  setSailState(state) {
    if (this.isSinking) return;
    this.sailState = Math.max(0, Math.min(2, state));
  }

  getForwardVector() {
    // Ship bow points along local -Z, rotated by heading around +Y
    return new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
  }

  getRightVector() {
    // Ship starboard points along local +X, rotated by heading around +Y
    return new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));
  }

  update(delta, wind) {
    if (this.isSinking) {
      this.sinkProgress += delta * 0.2;
      this.group.position.y -= delta * 1.6;
      this.group.rotation.z += delta * 0.1;
      this.group.rotation.x += delta * 0.08;
      if (this.group.position.y < -20) {
        this.group.visible = false;
      }
      return;
    }

    const preset = SPEED_PRESETS[this.sailState] || SPEED_PRESETS[0];

    // 1. Angular Velocity and Steering (from BottomScreenWheelController.lua & _HighLevelBoatPhysics.lua)
    if (typeof this.rudder !== 'number' || isNaN(this.rudder)) this.rudder = 0;
    if (typeof this.heading !== 'number' || isNaN(this.heading)) this.heading = 0;

    // Authentic AC Pirates cosine steering curve:
    // steerFactor = (1 - cos(|modifier| * Pi)) * 0.5 * sign(modifier)
    const modifier = THREE.MathUtils.clamp(this.rudder, -1.0, 1.0);
    const steerFactor = (1.0 - Math.cos(Math.abs(modifier) * Math.PI)) * 0.5 * Math.sign(modifier);
    const targetAngularVelocity = steerFactor * preset.maxAngularVelocity;

    // Authentic second-order angular acceleration/deceleration (_HighLevelBoatPhysics.lua:564-596)
    let angAccel = 0;
    const signTarget = Math.sign(targetAngularVelocity);
    const signCurrent = Math.sign(this.currentAngularVelocity);

    if (signTarget === signCurrent && signTarget !== 0) {
      if (Math.abs(targetAngularVelocity) > Math.abs(this.currentAngularVelocity)) {
        angAccel = signTarget * preset.angularAcceleration;
      } else {
        angAccel = -signTarget * preset.angularDeceleration;
      }
    } else {
      let sign = signTarget;
      if (sign === 0) {
        sign = -signCurrent;
      }
      angAccel = sign * preset.angularDeceleration;
    }

    const signBefore = Math.sign(this.currentAngularVelocity - targetAngularVelocity);
    let finalAngVel = THREE.MathUtils.clamp(
      this.currentAngularVelocity + angAccel * delta,
      -preset.maxAngularVelocity,
      preset.maxAngularVelocity
    );
    const signAfter = Math.sign(finalAngVel - targetAngularVelocity);
    if (signAfter !== signBefore) {
      finalAngVel = targetAngularVelocity;
    }
    this.currentAngularVelocity = finalAngVel;

    // Heading integration: turning Right (positive angVel) decreases heading towards East (+X)
    // turning Left (negative angVel) increases heading towards West (-X)
    this.heading -= this.currentAngularVelocity * delta;

    // 2. Forward vector and Linear Velocity (from _HighLevelBoatPhysics.lua:483-548)
    const forward = this.getForwardVector();
    const right = this.getRightVector();

    let targetVel = preset.targetVelocity;

    // Authentic AC Pirates Wind Mechanics:
    // Ship ALWAYS moves forward in the steered direction!
    // - Tailwind (+1.0 alignment): +30% speed boost
    // - Crosswind (0.0 alignment): 100% normal cruise speed
    // - Headwind (-1.0 alignment): ~55% speed (tacking into wind, never stuck!)
    if (wind && wind.direction) {
      const windDir = wind.direction.clone().normalize();
      const windAlign = forward.dot(windDir); // -1.0 to +1.0
      const windFactor = (windAlign + 1.0) * 0.5; // 0.0 to 1.0
      const windMultiplier = THREE.MathUtils.lerp(0.55, 1.30, windFactor);
      targetVel *= windMultiplier;
    }

    this.targetSpeed = targetVel;
    if (typeof this.speed !== 'number' || isNaN(this.speed)) this.speed = 0;

    // Snap to target if very close
    let finalVel = this.speed;
    if (Math.abs(targetVel - finalVel) < 0.15) {
      finalVel = targetVel;
    }

    let linAccel = 0;
    if (targetVel > finalVel && targetVel !== 0) {
      linAccel = preset.acceleration;
    } else if (finalVel > 0 && targetVel < finalVel) {
      linAccel = -preset.deceleration;
    } else if (finalVel < 0) {
      linAccel = preset.deceleration;
    }

    finalVel += linAccel * delta;
    this.speed = Math.max(0, finalVel);

    // Position updated strictly along ship forward vector
    if (isNaN(this.position.x)) this.position.x = 0;
    if (isNaN(this.position.z)) this.position.z = 0;
    this.position.x += forward.x * this.speed * delta;
    this.position.z += forward.z * this.speed * delta;

    // 3. Authentic Buoyancy, Wave Pitch & Centrifugal Turn Banking (from _WaterInfluencePhysics.lua)
    const bowPos = this.position.clone().addScaledVector(forward, 7.5);
    const sternPos = this.position.clone().addScaledVector(forward, -7.5);
    const portPos = this.position.clone().addScaledVector(right, -3.0);
    const stbdPos = this.position.clone().addScaledVector(right, 3.0);

    const hCenter = this.ocean.getWaveHeight(this.position.x, this.position.z);
    const hBow = this.ocean.getWaveHeight(bowPos.x, bowPos.z);
    const hStern = this.ocean.getWaveHeight(sternPos.x, sternPos.z);
    const hPort = this.ocean.getWaveHeight(portPos.x, portPos.z);
    const hStbd = this.ocean.getWaveHeight(stbdPos.x, stbdPos.z);

    const targetPitch = THREE.MathUtils.clamp(
      Math.atan2(hBow - hStern, 16.0),
      -0.35, 0.35
    );

    const waveRoll = Math.atan2(hStbd - hPort, 6.5);

    // Periodic idle buoyancy rocking
    this.rollBuoyancyCounter += this.rollBuoyancySign * delta * 0.5;
    if (this.rollBuoyancyCounter > 1.0) {
      this.rollBuoyancyCounter = 1.0;
      this.rollBuoyancySign = -1.0;
    } else if (this.rollBuoyancyCounter < -1.0) {
      this.rollBuoyancyCounter = -1.0;
      this.rollBuoyancySign = 1.0;
    }
    const fakeRoll = this.rollBuoyancyCounter * 0.035;

    // Authentic turn heel/roll: hull banks away from turn direction (- angularVelocity)
    const targetRoll = THREE.MathUtils.clamp(
      waveRoll + fakeRoll - this.currentAngularVelocity * 0.22,
      -0.20, 0.20
    );

    this.pitch = THREE.MathUtils.lerp(isNaN(this.pitch) ? 0 : this.pitch, targetPitch, delta * 3.5);
    this.roll = THREE.MathUtils.lerp(isNaN(this.roll) ? 0 : this.roll, targetRoll, delta * 3.5);
    this.heave = THREE.MathUtils.lerp(isNaN(this.heave) ? 0 : this.heave, isNaN(hCenter) ? 0 : hCenter, delta * 4.5);

    // Apply transforms
    this.group.position.set(this.position.x, this.heave, this.position.z);
    this.group.rotation.set(0, this.heading, 0);
    this.modelContainer.rotation.x = this.pitch;
    this.modelContainer.rotation.z = this.roll;

    // 4. Sail scaling (furling/unfurling animation)
    if (this.sailsList && this.sailsList.length > 0) {
      const targetScaleY = this.sailState === 0 ? 0.15 : (this.sailState === 1 ? 0.75 : 1.0);
      this.sailsList.forEach((s) => {
        s.scale.y = THREE.MathUtils.lerp(s.scale.y, targetScaleY, delta * 3.0);
      });
    }

    // 5. Wake Trail
    this.updateWake(delta, forward, right);
  }

  updateWake(delta, forward, right) {
    if (!this.wakeParticles) return;

    if (this.speed > 1.0) {
      // Stern is behind the ship (in opposite direction of forward)
      const stern = this.position.clone().sub(forward.clone().multiplyScalar(7.2));
      const sternPort = stern.clone().sub(right.clone().multiplyScalar(1.6));
      const sternStbd = stern.clone().add(right.clone().multiplyScalar(1.6));

      this.wakeHistory.unshift({ pos: sternPort });
      this.wakeHistory.unshift({ pos: sternStbd });

      // Bow waves when moving fast
      if (this.speed > 4.5) {
        const bow = this.position.clone().add(forward.clone().multiplyScalar(7.8));
        this.wakeHistory.unshift({ pos: bow.clone().sub(right.clone().multiplyScalar(1.4)) });
        this.wakeHistory.unshift({ pos: bow.clone().add(right.clone().multiplyScalar(1.4)) });
      }
    }

    if (this.wakeHistory.length > this.wakeMax) {
      this.wakeHistory.length = this.wakeMax;
    }

    const posAttr = this.wakeParticles.geometry.attributes.position;
    for (let i = 0; i < this.wakeMax; i++) {
      if (i < this.wakeHistory.length) {
        const item = this.wakeHistory[i];
        const h = this.ocean.getWaveHeight(item.pos.x, item.pos.z);
        posAttr.setXYZ(i, item.pos.x, h + 0.15, item.pos.z);
      } else {
        posAttr.setXYZ(i, 0, -100, 0);
      }
    }
    posAttr.needsUpdate = true;
  }

  takeDamage(amount) {
    if (this.isSinking) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.isSinking = true;
    }
  }

  getCannonOrigins(side) {
    const forward = this.getForwardVector();
    const right = this.getRightVector();
    const lateralDir = side === 'port' ? right.clone().negate() : right.clone();

    const origins = [];
    [-4.0, -1.5, 1.0, 3.5].forEach((zOff) => {
      const pos = this.position.clone()
        .add(forward.clone().multiplyScalar(zOff))
        .add(lateralDir.clone().multiplyScalar(2.6));
      pos.y = this.heave + 2.0;
      origins.push(pos);
    });
    return origins;
  }
}
