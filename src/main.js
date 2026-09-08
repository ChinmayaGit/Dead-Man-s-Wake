import * as THREE from 'three';
import { Ocean } from './ocean.js';
import { Ship } from './ship.js';
import { CombatSystem } from './combat.js';
import { EnemyShip } from './enemy.js';
import { Archipelago } from './islands.js';
import { SoundController } from './audio.js';

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
      55,
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

    // 3rd Person Camera Chase Config
    this.camOrbit = {
      distance: 30,
      height: 7.0,
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

    // Enemy Frigate positioned 55 units forward-right (clearly visible on start!)
    this.enemyShip = new EnemyShip(
      this.scene,
      this.ocean,
      this.combat,
      new THREE.Vector3(42, 0, -50)
    );
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
        this.changeSail(2); // Immediately drop Full Sail!
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
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - prevMouseX;
      const dy = e.clientY - prevMouseY;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;

      this.camOrbit.angleH -= dx * 0.006;
      this.camOrbit.angleV = Math.max(0.06, Math.min(0.68, this.camOrbit.angleV + dy * 0.004));
    });

    window.addEventListener('mouseup', () => { isDragging = false; });
    window.addEventListener('wheel', (e) => {
      this.camOrbit.distance = Math.max(18, Math.min(80, this.camOrbit.distance + e.deltaY * 0.04));
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
    this.combat.fireBroadside(this.playerShip, this.enemyShip.ship, side);
  }

  updateCamera(delta, immediate = false) {
    const shipPos = this.playerShip.position;
    const shipHeave = this.playerShip.heave;

    // Safety checks against any NaN
    if (isNaN(shipPos.x) || isNaN(shipPos.z) || isNaN(shipHeave)) return;

    // Camera angle is controlled ONLY by mouse drag, decoupled from ship steering
    const camAngle = Math.PI + this.camOrbit.angleH;
    const dist = this.camOrbit.distance;
    const height = dist * Math.sin(this.camOrbit.angleV) + this.camOrbit.height;
    const horizDist = dist * Math.cos(this.camOrbit.angleV);

    const desiredCamPos = new THREE.Vector3(
      shipPos.x + Math.sin(camAngle) * horizDist,
      shipHeave + height,
      shipPos.z - Math.cos(camAngle) * horizDist
    );

    // Look directly at ship center
    const desiredLookTarget = new THREE.Vector3(
      shipPos.x,
      shipHeave + 3.2,
      shipPos.z
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

    // Cooldowns
    ['port', 'starboard'].forEach((side) => {
      if (this.cooldowns[side] > 0) {
        this.cooldowns[side] = Math.max(0, this.cooldowns[side] - delta);
        const ring = document.getElementById(`cd-${side}`);
        if (ring) {
          const progress = this.cooldowns[side] / this.maxCooldown;
          ring.style.borderColor = `rgba(255, 87, 34, ${0.4 + progress * 0.6})`;
        }
      }
    });

    // Music
    const distToEnemy = this.playerShip.position.distanceTo(this.enemyShip.ship.position);
    this.sound.setCombatMode(distToEnemy < 100 && !this.enemyShip.ship.isSinking);

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

    // Enemy
    if (!this.enemyShip.ship.isSinking) {
      const eRelX = (this.enemyShip.ship.position.x - this.playerShip.position.x) * scale;
      const eRelZ = (this.enemyShip.ship.position.z - this.playerShip.position.z) * scale;

      ctx.beginPath();
      ctx.arc(eRelX, eRelZ, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff1744';
      ctx.fill();
    }

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
    this.enemyShip.update(delta, this.wind, this.playerShip);
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

