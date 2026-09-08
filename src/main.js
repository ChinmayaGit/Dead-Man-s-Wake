import * as THREE from 'three';
import { Ocean } from './ocean.js';
import { Ship } from './ship.js';
import { CombatSystem } from './combat.js';
import { EnemyShip } from './enemy.js';
import { Archipelago } from './islands.js';
import { SoundController } from './audio.js';

// Camera Chase and Zoom Presets based on Sail State (authentic to AC Pirates)
export const SAIL_CAMERA_PRESETS = {
  0: { distance: 28.0, height: 6.5, fov: 54, lookHeight: 3.2 },  // Furled (Stop): intimate close-up view behind the stern (kept as it is)
  1: { distance: 46.0, height: 10.0, fov: 58, lookHeight: 3.8 },  // Half Sail: zoomed out a little more for tactical maneuvering
  2: { distance: 74.0, height: 16.0, fov: 65, lookHeight: 4.8 }   // Full Sail: complete panoramic zoom out to see the high seas
};

class Game {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.lastTime = performance.now();

    // Global Wind (North-East 14 knots)
    this.wind = {
      direction: new THREE.Vector3(0.6, 0, -0.8).normalize(),
      speedKnots: 14
    };

    // Cooldowns
    this.cooldowns = { port: 0, starboard: 0 };
    this.prevCooldowns = { port: 0, starboard: 0 };
    this.maxCooldown = 3.5;
    this.isFirstFrame = true;

    this.initScene();
    this.initLights();
    this.initGameObjects();
    this.initControls();
    this.initUI();

    // Immediate initial camera alignment
    this.updateCamera(0.016, true);

    // Start render loop
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x7ec8f2); // Sky blue
    this.scene.fog = new THREE.Fog(0x9bd7f5, 120, 800);

    this.camera = new THREE.PerspectiveCamera(
      54,
      window.innerWidth / window.innerHeight,
      0.5,
      2000
    );

    // Initial camera position (3rd person behind stern)
    this.camera.position.set(0, 11, 26);
    this.camera.lookAt(0, 3.5, -6);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.container.appendChild(this.renderer.domElement);

    // 3rd Person Camera Chase Config with Sail Zoom Support
    this.camOrbit = {
      distance: 28.0,
      height: 6.5,
      fov: 54,
      lookHeight: 3.2,
      userZoom: 0,
      angleH: 0,
      angleV: 0.18,
      targetPos: new THREE.Vector3()
    };

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  initLights() {
    // 1. Warm Direct Sunlight
    this.sunLight = new THREE.DirectionalLight(0xfffaed, 2.5);
    this.sunLight.position.set(150, 250, 150);
    this.scene.add(this.sunLight);

    // 2. Ambient Sky/Sea light
    this.hemiLight = new THREE.HemisphereLight(0xb3e5fc, 0x004d40, 1.2);
    this.scene.add(this.hemiLight);

    // 3. General Ambient fill light so shadows are never pitch black
    const amb = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(amb);
  }

  initGameObjects() {
    this.sound = new SoundController();
    this.ocean = new Ocean(this.scene);
    this.archipelago = new Archipelago(this.scene);

    // Player Ship (Jackdaw - 3D Pirate Galleon Asset)
    this.playerShip = new Ship(this.scene, this.ocean, true, 'ship-pirate-large.glb');
    this.playerShip.position.set(0, 0, 0);

    // Combat System
    this.combat = new CombatSystem(this.scene, this.ocean, this.sound);

    // Royal Navy Enemies stationed across the archipelago
    this.enemies = [
      new EnemyShip(this.scene, this.ocean, this.combat, new THREE.Vector3(45, 0, -55), 'HMS Defiance'),
      new EnemyShip(this.scene, this.ocean, this.combat, new THREE.Vector3(-120, 0, -20), 'HMS Vanguard'),
      new EnemyShip(this.scene, this.ocean, this.combat, new THREE.Vector3(80, 0, 95), 'HMS Intrepid')
    ];
    this.enemyShip = this.enemies[0]; // backwards compatibility
    this.lockedEnemy = null;
    this.camLastUserDrag = 0;
    this.isMouseDragging = false;
  }

  initControls() {
    this.keys = {
      w: false, s: false, a: false, d: false,
      q: false, e: false
    };

    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (this.keys.hasOwnProperty(key)) this.keys[key] = true;

      if (key === 'arrowleft') this.keys.a = true;
      if (key === 'arrowright') this.keys.d = true;

      if (key === ' ' || key === 'enter') {
        const splashModal = document.getElementById('splash-modal');
        if (splashModal && !splashModal.classList.contains('hidden')) {
          splashModal.classList.add('hidden');
          this.sound.init();
        }
      }
      if (key === 'w' || key === 'arrowup') {
        const splashModal = document.getElementById('splash-modal');
        if (splashModal && !splashModal.classList.contains('hidden')) {
          splashModal.classList.add('hidden');
          this.sound.init();
        }
        this.changeSail(Math.min(2, this.playerShip.sailState + 1));
      } else if (key === 's' || key === 'arrowdown') {
        this.changeSail(Math.max(0, this.playerShip.sailState - 1));
      } else if (key === 'q') {
        this.fireBroadside('port');
      } else if (key === 'e') {
        this.fireBroadside('starboard');
      }
    });

    window.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      if (this.keys.hasOwnProperty(key)) this.keys[key] = false;

      if (key === 'arrowleft') this.keys.a = false;
      if (key === 'arrowright') this.keys.d = false;
    });

    // Mouse drag to orbit camera around ship
    let isDragging = false;
    let prevMouseX = 0;
    let prevMouseY = 0;

    window.addEventListener('mousedown', (e) => {
      if (e.target.closest('#hud-top') || e.target.closest('#hud-bottom') || e.target.closest('#mute-btn')) return;
      isDragging = true;
      this.isMouseDragging = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
      this.camLastUserDrag = performance.now();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - prevMouseX;
      const dy = e.clientY - prevMouseY;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;

      this.camOrbit.angleH -= dx * 0.006;
      this.camOrbit.angleV = Math.max(0.06, Math.min(0.68, this.camOrbit.angleV + dy * 0.004));
      this.camLastUserDrag = performance.now();
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
      this.isMouseDragging = false;
      this.camLastUserDrag = performance.now();
    });
    window.addEventListener('wheel', (e) => {
      this.camOrbit.userZoom = Math.max(-15, Math.min(30, (this.camOrbit.userZoom || 0) + e.deltaY * 0.04));
    });
  }

  initUI() {
    const startBtn = document.getElementById('start-btn');
    const splashModal = document.getElementById('splash-modal');
    startBtn.addEventListener('click', () => {
      splashModal.classList.add('hidden');
      this.sound.init();
    });

    const muteBtn = document.getElementById('mute-btn');
    muteBtn.addEventListener('click', () => {
      const isMuted = this.sound.toggleMute();
      muteBtn.textContent = isMuted ? '🔇 Audio: OFF' : '🔊 Audio: ON';
    });

    [0, 1, 2].forEach((state) => {
      const btn = document.getElementById(`btn-sail-${state}`);
      if (btn) btn.addEventListener('click', () => this.changeSail(state));
    });

    const btnPort = document.getElementById('btn-fire-port');
    const btnStbd = document.getElementById('btn-fire-starboard');

    if (btnPort) {
      btnPort.addEventListener('click', () => this.fireBroadside('port'));
      btnPort.addEventListener('mouseenter', () => this.combat.updateAimArc(this.playerShip, 'port'));
      btnPort.addEventListener('mouseleave', () => this.combat.hideAimArc());
    }

    if (btnStbd) {
      btnStbd.addEventListener('click', () => this.fireBroadside('starboard'));
      btnStbd.addEventListener('mouseenter', () => this.combat.updateAimArc(this.playerShip, 'starboard'));
      btnStbd.addEventListener('mouseleave', () => this.combat.hideAimArc());
    }

    // Steering Helm Wheel
    const helm = document.getElementById('helm-wheel');
    if (helm) {
      let isSteering = false;
      let helmStartAngle = 0;
      let currentWheelRot = 0;

      const getCenterDist = (e) => {
        const rect = helm.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return Math.atan2(clientY - cy, clientX - cx);
      };

      const startSteer = (e) => {
        isSteering = true;
        this.isSteeringWheelActive = true;
        helmStartAngle = getCenterDist(e) - currentWheelRot;
      };

      const moveSteer = (e) => {
        if (!isSteering) return;
        const currentAngle = getCenterDist(e);
        currentWheelRot = currentAngle - helmStartAngle;
        currentWheelRot = Math.max(-Math.PI * 0.8, Math.min(Math.PI * 0.8, currentWheelRot));
        helm.style.transform = `rotate(${currentWheelRot}rad)`;
        this.playerShip.rudder = currentWheelRot / (Math.PI * 0.8);
      };

      const endSteer = () => {
        isSteering = false;
        const reset = () => {
          if (isSteering) return;
          currentWheelRot *= 0.82;
          if (Math.abs(currentWheelRot) < 0.02) {
            currentWheelRot = 0;
            this.playerShip.rudder = 0;
            this.isSteeringWheelActive = false;
            helm.style.transform = 'rotate(0rad)';
          } else {
            this.playerShip.rudder = currentWheelRot / (Math.PI * 0.8);
            helm.style.transform = `rotate(${currentWheelRot}rad)`;
            requestAnimationFrame(reset);
          }
        };
        reset();
      };

      helm.addEventListener('mousedown', startSteer);
      window.addEventListener('mousemove', moveSteer);
      window.addEventListener('mouseup', endSteer);
      helm.addEventListener('touchstart', startSteer, { passive: true });
      window.addEventListener('touchmove', moveSteer, { passive: true });
      window.addEventListener('touchend', endSteer);
    }

    this.minimapCanvas = document.getElementById('minimap-canvas');
    if (this.minimapCanvas) {
      this.minimapCtx = this.minimapCanvas.getContext('2d');
    }
  }

  changeSail(newState) {
    const clamped = Math.max(0, Math.min(2, newState));
    if (clamped !== this.playerShip.sailState) {
      this.playerShip.setSailState(clamped);
      this.sound.playBell();

      [0, 1, 2].forEach((state) => {
        const btn = document.getElementById(`btn-sail-${state}`);
        const notch = document.getElementById(`notch-${state}`);
        if (btn) {
          if (state === clamped) btn.classList.add('selected');
          else btn.classList.remove('selected');
        }
        if (notch) {
          if (state === clamped) notch.classList.add('active');
          else notch.classList.remove('active');
        }
      });
    }
  }

  fireBroadside(side) {
    if (this.cooldowns[side] > 0) return;
    this.cooldowns[side] = this.maxCooldown;
    this.prevCooldowns[side] = this.maxCooldown;

    const ring = document.getElementById(`ring-${side}`);
    const timer = document.getElementById(`timer-${side}`);
    const btn = document.getElementById(`btn-fire-${side}`);
    if (ring) ring.style.strokeDashoffset = 282.74;
    if (timer) timer.textContent = this.maxCooldown.toFixed(1) + 's';
    if (btn) {
      btn.classList.remove('reload-ready-anim');
      btn.classList.add('reloading');
    }

    const targetShips = this.lockedEnemy ? this.lockedEnemy.ship : this.enemies.map(e => e.ship);
    this.combat.fireBroadside(this.playerShip, targetShips, side);
  }

  updateCamera(delta, immediate = false) {
    const shipPos = this.playerShip.position;
    const shipHeave = this.playerShip.heave;

    // Safety checks against any NaN
    if (isNaN(shipPos.x) || isNaN(shipPos.z) || isNaN(shipHeave)) return;

    // Retrieve target preset based on current sail state (Furled = 0, Half = 1, Full = 2)
    const preset = SAIL_CAMERA_PRESETS[this.playerShip.sailState] || SAIL_CAMERA_PRESETS[0];
    const targetDist = Math.max(18, Math.min(110, preset.distance + (this.camOrbit.userZoom || 0)));
    const targetHeight = preset.height;
    const targetFov = preset.fov;
    const targetLookHeight = preset.lookHeight;

    if (immediate) {
      this.camOrbit.distance = targetDist;
      this.camOrbit.height = targetHeight;
      this.camOrbit.fov = targetFov;
      this.camOrbit.lookHeight = targetLookHeight;
    } else {
      // Smooth, cinematic interpolation between sail zoom states
      const zoomLerp = Math.min(delta * 2.6, 0.14);
      this.camOrbit.distance = THREE.MathUtils.lerp(this.camOrbit.distance, targetDist, zoomLerp);
      this.camOrbit.height = THREE.MathUtils.lerp(this.camOrbit.height, targetHeight, zoomLerp);
      this.camOrbit.fov = THREE.MathUtils.lerp(this.camOrbit.fov, targetFov, zoomLerp);
      this.camOrbit.lookHeight = THREE.MathUtils.lerp(this.camOrbit.lookHeight || 3.2, targetLookHeight, zoomLerp);
    }

    // Dynamic FOV update
    if (Math.abs(this.camera.fov - this.camOrbit.fov) > 0.02) {
      this.camera.fov = this.camOrbit.fov;
      this.camera.updateProjectionMatrix();
    }

    // Auto-Lock Camera Tracking when an Enemy is Alerted
    const activeEnemy = (this.lockedEnemy && !this.lockedEnemy.ship.isSinking) ? this.lockedEnemy : null;
    let desiredLookTarget;

    if (activeEnemy) {
      const toEnemy = activeEnemy.ship.position.clone().sub(shipPos);
      const enemyDist = Math.max(1, toEnemy.length());
      const enemyBearing = Math.atan2(toEnemy.x, -toEnemy.z);

      // Check if user is actively dragging or recently released mouse
      const isUserDragging = this.isMouseDragging || (performance.now() - this.camLastUserDrag < 700);

      if (!isUserDragging) {
        // Shortest-arc angular difference between current angle and enemy bearing
        let angleDiff = enemyBearing - this.camOrbit.angleH;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

        const lockSpeed = Math.min(delta * 3.2, 0.12);
        this.camOrbit.angleH += angleDiff * lockSpeed;

        // Settle vertical pitch toward an optimal naval broadside view angle (~0.22 rad)
        this.camOrbit.angleV = THREE.MathUtils.lerp(this.camOrbit.angleV, 0.22, Math.min(delta * 2.0, 0.06));
      }

      // Blend camera look target slightly toward enemy for dramatic framing of both ships
      const blend = Math.min(0.24, 12.0 / Math.max(20, enemyDist));
      desiredLookTarget = shipPos.clone().lerp(activeEnemy.ship.position, blend);
      desiredLookTarget.y = shipHeave + (this.camOrbit.lookHeight || 3.2);
    } else {
      desiredLookTarget = new THREE.Vector3(
        shipPos.x,
        shipHeave + (this.camOrbit.lookHeight || 3.2),
        shipPos.z
      );
    }

    const camAngle = Math.PI + this.camOrbit.angleH;
    const dist = this.camOrbit.distance;
    const height = dist * Math.sin(this.camOrbit.angleV) + this.camOrbit.height;
    const horizDist = dist * Math.cos(this.camOrbit.angleV);

    const desiredCamPos = new THREE.Vector3(
      shipPos.x + Math.sin(camAngle) * horizDist,
      shipHeave + height,
      shipPos.z - Math.cos(camAngle) * horizDist
    );

    if (!this.camLookTarget) {
      this.camLookTarget = desiredLookTarget.clone();
    }

    if (immediate) {
      this.camera.position.copy(desiredCamPos);
      this.camLookTarget.copy(desiredLookTarget);
    } else {
      const lerpSpeed = Math.min(delta * 14.0, 0.8);
      this.camera.position.lerp(desiredCamPos, lerpSpeed);
      this.camLookTarget.lerp(desiredLookTarget, lerpSpeed);
    }

    this.camera.lookAt(this.camLookTarget);
  }

  updateControls(delta) {
    const wheel = document.getElementById('helm-wheel');
    if (this.keys.a) {
      // Steer Port / Left
      this.playerShip.rudder = THREE.MathUtils.lerp(this.playerShip.rudder, -1.0, delta * 7.0);
    } else if (this.keys.d) {
      // Steer Starboard / Right
      this.playerShip.rudder = THREE.MathUtils.lerp(this.playerShip.rudder, 1.0, delta * 7.0);
    } else if (!this.isSteeringWheelActive) {
      // Return helm to neutral
      this.playerShip.rudder = THREE.MathUtils.lerp(this.playerShip.rudder, 0, delta * 6.0);
    }

    if (wheel) {
      wheel.style.transform = `rotate(${this.playerShip.rudder * 0.85}rad)`;
    }
  }

  updateHUD(delta) {
    const hpFill = document.getElementById('hp-fill');
    const hpVal = document.getElementById('hp-val');
    if (hpFill && hpVal) {
      const hpPct = Math.max(0, this.playerShip.health / this.playerShip.maxHealth);
      hpFill.style.width = `${hpPct * 100}%`;
      hpVal.textContent = Math.round(this.playerShip.health);
    }

    const speedVal = document.getElementById('speed-val');
    if (speedVal) {
      const curSpeed = (typeof this.playerShip.speed === 'number' && !isNaN(this.playerShip.speed)) ? this.playerShip.speed : 0;
      const knots = (curSpeed * 1.3).toFixed(1);
      speedVal.textContent = knots;
    }

    // Compass & Wind Indicator
    const needle = document.getElementById('wind-needle');
    if (needle) {
      const forward = this.playerShip.getForwardVector();
      const angleToWind = Math.atan2(
        forward.x * this.wind.direction.z - forward.z * this.wind.direction.x,
        forward.x * this.wind.direction.x + forward.z * this.wind.direction.z
      );
      needle.style.transform = `rotate(${angleToWind}rad)`;

      const windAlign = forward.dot(this.wind.direction);
      const windStatus = document.getElementById('wind-status');
      if (windStatus) {
        if (windAlign > 0.35) {
          windStatus.textContent = 'Favorable (Tailwind)';
          windStatus.style.color = '#81c784';
        } else if (windAlign < -0.35) {
          windStatus.textContent = 'Headwind (Tacking)';
          windStatus.style.color = '#ef5350';
        } else {
          windStatus.textContent = 'Crosswind';
          windStatus.style.color = '#ffca28';
        }
      }
    }

    // Cooldowns & Round Reload Timers
    const ringCircumference = 282.74; // 2 * Math.PI * 45
    ['port', 'starboard'].forEach((side) => {
      const prevCd = this.prevCooldowns[side];
      const curCd = this.cooldowns[side];

      if (curCd > 0) {
        this.cooldowns[side] = Math.max(0, curCd - delta);
      }

      const newCd = this.cooldowns[side];
      const ring = document.getElementById(`ring-${side}`);
      const timer = document.getElementById(`timer-${side}`);
      const btn = document.getElementById(`btn-fire-${side}`);

      if (newCd > 0) {
        const progress = Math.min(1, Math.max(0, (this.maxCooldown - newCd) / this.maxCooldown));
        const offset = ringCircumference * (1 - progress);
        if (ring) ring.style.strokeDashoffset = offset;
        if (timer) timer.textContent = newCd.toFixed(1) + 's';
        if (btn) btn.classList.add('reloading');
      } else {
        if (ring) ring.style.strokeDashoffset = '0';
        if (timer) timer.textContent = 'READY';
        if (btn) {
          btn.classList.remove('reloading');
          if (prevCd > 0) {
            btn.classList.remove('reload-ready-anim');
            void btn.offsetWidth;
            btn.classList.add('reload-ready-anim');
            if (this.sound && this.sound.playReloadReady) {
              this.sound.playReloadReady();
            }
          }
        }
      }

      this.prevCooldowns[side] = newCd;
    });

    // Enemy Target Health Bar & Alert Indicator
    const enemyCard = document.getElementById('enemy-status-card');
    const enemyNameEl = document.getElementById('enemy-ship-name');
    const enemyDistEl = document.getElementById('enemy-dist-val');
    const enemyHpValEl = document.getElementById('enemy-hp-val');
    const enemyHpFillEl = document.getElementById('enemy-hp-fill');
    const enemyBadgeEl = document.getElementById('enemy-badge-val');
    const enemyDiamondEl = document.getElementById('enemy-diamond-icon');

    if (enemyCard) {
      if (this.lockedEnemy && !this.lockedEnemy.ship.isSinking) {
        enemyCard.classList.add('visible');
        if (enemyNameEl) enemyNameEl.textContent = this.lockedEnemy.name;
        if (enemyDistEl) {
          const dist = Math.round(this.playerShip.position.distanceTo(this.lockedEnemy.ship.position));
          enemyDistEl.textContent = dist;
        }
        if (enemyHpValEl && enemyHpFillEl) {
          const hpPct = Math.max(0, this.lockedEnemy.ship.health / this.lockedEnemy.ship.maxHealth);
          enemyHpFillEl.style.width = `${hpPct * 100}%`;
          enemyHpValEl.textContent = Math.round(this.lockedEnemy.ship.health);
        }
        if (enemyBadgeEl) {
          enemyBadgeEl.textContent = 'ALERTED';
          enemyBadgeEl.classList.remove('sinking');
        }
        if (enemyDiamondEl) {
          enemyDiamondEl.style.color = '#ff1744';
        }
      } else if (this.lockedEnemy && this.lockedEnemy.ship.isSinking) {
        enemyCard.classList.add('visible');
        if (enemyHpFillEl) enemyHpFillEl.style.width = '0%';
        if (enemyHpValEl) enemyHpValEl.textContent = '0';
        if (enemyBadgeEl) {
          enemyBadgeEl.textContent = 'SINKING';
          enemyBadgeEl.classList.add('sinking');
        }
      } else {
        enemyCard.classList.remove('visible');
      }
    }

    // Mini-map
    if (this.minimapCtx) {
      this.renderMiniMap();
    }
  }

  renderMiniMap() {
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const scale = 0.22;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(this.playerShip.heading);

    // Islands
    this.archipelago.islands.forEach((isl) => {
      const relX = (isl.pos.x - this.playerShip.position.x) * scale;
      const relZ = (isl.pos.y - this.playerShip.position.z) * scale;

      ctx.beginPath();
      ctx.arc(relX, relZ, isl.radius * scale, 0, Math.PI * 2);
      ctx.fillStyle = '#689f38';
      ctx.fill();
      ctx.strokeStyle = '#d7ccc8';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Enemies
    this.enemies.forEach((enemy) => {
      if (enemy.ship.isSinking) return;
      const eRelX = (enemy.ship.position.x - this.playerShip.position.x) * scale;
      const eRelZ = (enemy.ship.position.z - this.playerShip.position.z) * scale;

      if (enemy === this.lockedEnemy) {
        // Pulsing alert ring around locked enemy
        const pulseR = 6.5 + Math.sin(performance.now() * 0.008) * 1.8;
        ctx.beginPath();
        ctx.arc(eRelX, eRelZ, pulseR, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 23, 68, 0.85)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Red alert diamond
        ctx.save();
        ctx.translate(eRelX, eRelZ);
        ctx.rotate(Math.PI * 0.25);
        ctx.fillStyle = '#ff1744';
        ctx.fillRect(-3.5, -3.5, 7, 7);
        ctx.strokeStyle = '#ffd54f';
        ctx.lineWidth = 1;
        ctx.strokeRect(-3.5, -3.5, 7, 7);
        ctx.restore();
      } else if (enemy.standoff) {
        // Dim grey dot for standoff enemy (backing away)
        ctx.beginPath();
        ctx.arc(eRelX, eRelZ, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#78909c';
        ctx.fill();
      } else {
        // Amber dot for patrolling enemy
        ctx.beginPath();
        ctx.arc(eRelX, eRelZ, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffb300';
        ctx.fill();
      }
    });

    // Player
    ctx.restore();
    ctx.save();
    ctx.translate(w / 2, h / 2);

    ctx.fillStyle = '#ffd54f';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 7);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-5.5, 7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3e2723';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }

  updateEnemies(delta) {
    const playerPos = this.playerShip.position;

    // 1. Check if currently locked enemy is sunken or has fled far away
    if (this.lockedEnemy) {
      if (this.lockedEnemy.ship.isSinking) {
        this.lockedEnemy.isAlerted = false;
        this.lockedEnemy.isLockedTarget = false;
        this.lockedEnemy = null;
      } else {
        const dist = playerPos.distanceTo(this.lockedEnemy.ship.position);
        if (dist > 250) {
          this.lockedEnemy.isAlerted = false;
          this.lockedEnemy.isLockedTarget = false;
          this.lockedEnemy = null;
        }
      }
    }

    // 2. If no enemy currently alerted/locked, engage the closest unsunk enemy within alert range (135m)
    if (!this.lockedEnemy) {
      let closestEnemy = null;
      let closestDist = Infinity;

      for (const enemy of this.enemies) {
        if (enemy.ship.isSinking) continue;
        const dist = playerPos.distanceTo(enemy.ship.position);
        if (dist < 135 && dist < closestDist) {
          closestDist = dist;
          closestEnemy = enemy;
        }
      }

      if (closestEnemy) {
        this.lockedEnemy = closestEnemy;
        this.lockedEnemy.isAlerted = true;
        this.lockedEnemy.isLockedTarget = true;
        this.lockedEnemy.standoff = false;
      }
    }

    // 3. Strict 1-on-1 Rule:
    // Only 1 enemy ship engages at a time! All other enemy ships must stand off, hold perimeter, and back away
    for (const enemy of this.enemies) {
      if (enemy === this.lockedEnemy) {
        enemy.isAlerted = true;
        enemy.isLockedTarget = true;
        enemy.standoff = false;
      } else {
        enemy.isAlerted = false;
        enemy.isLockedTarget = false;
        enemy.standoff = (this.lockedEnemy !== null);
      }
      enemy.update(delta, this.wind, this.playerShip);
    }

    // 4. Update legacy reference & combat audio mode
    this.enemyShip = this.lockedEnemy || this.enemies[0];
    this.sound.setCombatMode(this.lockedEnemy !== null && !this.lockedEnemy.ship.isSinking);
  }

  animate(currentTime) {
    requestAnimationFrame(this.animate);
    const now = currentTime || performance.now();
    const delta = Math.min((now - this.lastTime) / 1000, 0.08);
    this.lastTime = now;

    // 1. Process player inputs first
    this.updateControls(delta);

    // 2. Update physical simulation
    this.ocean.update(delta, this.playerShip.position);
    this.playerShip.update(delta, this.wind);
    this.updateEnemies(delta);
    this.combat.update(delta);

    // 3. Camera & HUD
    if (this.isFirstFrame) {
      console.log('⛵ [AC Pirates] First frame rendered! Ship pos:', this.playerShip.position);
    }
    this.updateCamera(delta, this.isFirstFrame);
    this.isFirstFrame = false;
    this.updateHUD(delta);

    // 4. Render
    this.renderer.render(this.scene, this.camera);
  }
}

function bootGame() {
  if (window.__gameInstance) return;
  console.log('⛵ [AC Pirates] Booting game engine...');
  window.__gameInstance = new Game();
  console.log('⛵ [AC Pirates] Game engine initialized successfully!');
  if (typeof window !== 'undefined' && window.location.search.includes('autostart')) {
    const modal = document.getElementById('splash-modal');
    if (modal) modal.classList.add('hidden');
    if (window.__gameInstance.sound) {
      window.__gameInstance.sound.init();
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootGame);
} else {
  bootGame();
}

