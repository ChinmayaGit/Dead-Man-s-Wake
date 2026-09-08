import * as THREE from 'three';
import { Ocean } from './ocean.js';
import { Ship } from './ship.js';
import { CombatSystem } from './combat.js';
import { EnemyShip } from './enemy.js';
import { Archipelago } from './islands.js';
import { SoundController } from './audio.js';
import { CollisionSystem } from './collision.js';
import { MultiplayerManager } from './multiplayer.js';

// Camera Chase and Zoom Presets based on Sail State (Dead-Man-s-Wake)
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

    // Camera Shake state
    this.cameraShake = { intensity: 0, duration: 0 };

    // Hold-to-Charge Broadside Aiming System (Long Range & Narrowing Yellow Sector)
    this.broadsideCharge = {
      active: false,
      side: null,
      chargeTime: 0,
      maxChargeTime: 1.35
    };

    // Sunk Enemy Salvage & Loot System
    this.playerGold = 0;
    this.activeSalvageEnemy = null;
    this.salvageQueue = [];
    this.floatingCrates = [];

    // Nautical Difficulty System (easy, medium, hard)
    this.difficulty = 'medium';

    this.initScene();
    this.initLights();
    this.initGameObjects();

    // P2P Multiplayer (WebRTC)
    this.multiplayer = new MultiplayerManager(this);

    this.initControls();
    this.initUI();
    this.initDifficulty();
    this.initMobileControls();
    this.initFullscreen();
    this.initCustomizer();
    this.initMultiplayerUI();

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

    // Player Flagship (Dead-Man-s-Wake - 3D Pirate Galleon Asset)
    this.playerShip = new Ship(this.scene, this.ocean, true, 'ship-pirate-large.glb');
    this.playerShip.position.set(0, 0, 0);

    // Combat System
    this.combat = new CombatSystem(this.scene, this.ocean, this.sound);
    this.combat.onShipHit = (hitShip, damage, hitDist) => {
      const hitEnemy = this.enemies.find(e => e.ship === hitShip);
      if (hitEnemy) {
        if (!this.lockedEnemy || this.lockedEnemy.ship.isSinking) {
          this.lockedEnemy = hitEnemy;
          this.lockedEnemy.isAlerted = true;
          this.lockedEnemy.isLockedTarget = true;
          this.lockedEnemy.standoff = false;
        }
      } else if (hitShip === this.playerShip) {
        // Player ship hit by enemy cannon fire!
        this.triggerCameraShake(0.7, 0.35);
        this.triggerDamageFeedback(damage);
        if (this.sound && this.sound.playHullImpact) {
          this.sound.playHullImpact();
        }
      }
    };

    // Royal Navy Enemies stationed across the archipelago (Tiered Toughness & Authentic Warship Health)
    this.enemies = [
      new EnemyShip(this.scene, this.ocean, this.combat, new THREE.Vector3(45, 0, -55), 'HMS Defiance', 280, 'Frigate'),
      new EnemyShip(this.scene, this.ocean, this.combat, new THREE.Vector3(-120, 0, -20), 'HMS Vanguard', 380, 'Heavy Frigate'),
      new EnemyShip(this.scene, this.ocean, this.combat, new THREE.Vector3(80, 0, 95), 'HMS Intrepid', 500, 'Flagship')
    ];
    this.enemyShip = this.enemies[0]; // backwards compatibility
    this.lockedEnemy = null;
    this.camLastUserDrag = 0;
    this.isMouseDragging = false;

    // Collision & Ramming System (Islands, Ship-to-Ship, Front Impact Damage)
    this.collision = new CollisionSystem(this.scene, this.archipelago, this.sound, this.combat, {
      onCameraShake: (intensity, duration) => this.triggerCameraShake(intensity, duration),
      onPlayerDamage: (dmg) => this.triggerDamageFeedback(dmg)
    });
  }

  triggerCameraShake(intensity = 0.85, duration = 0.45) {
    this.cameraShake.intensity = Math.max(this.cameraShake.intensity, intensity);
    this.cameraShake.duration = Math.max(this.cameraShake.duration, duration);
  }

  triggerDamageFeedback(amount) {
    const vignette = document.getElementById('damage-vignette');
    if (vignette) {
      vignette.classList.add('active');
      setTimeout(() => vignette.classList.remove('active'), 280);
    }
    const statusCard = document.getElementById('status-card');
    if (statusCard) {
      statusCard.style.borderColor = '#ff1744';
      statusCard.style.transform = 'scale(0.98)';
      setTimeout(() => {
        statusCard.style.borderColor = '#a68449';
        statusCard.style.transform = 'none';
      }, 300);
    }
  }

  startBroadsideCharge(side) {
    if (this.cooldowns[side] > 0 || this.playerShip.isSinking) return;
    this.broadsideCharge.active = true;
    this.broadsideCharge.side = side;
    this.broadsideCharge.chargeTime = 0;

    const btn = document.getElementById(`btn-fire-${side}`);
    if (btn) {
      btn.classList.remove('reloading');
      btn.classList.add('charging');
    }

    this.combat.updateAimSector(this.playerShip, side, 0, this.enemies);
  }

  releaseBroadsideCharge(side) {
    if (!this.broadsideCharge.active || this.broadsideCharge.side !== side) return;
    const charge = Math.min(1.0, this.broadsideCharge.chargeTime / this.broadsideCharge.maxChargeTime);
    this.broadsideCharge.active = false;
    this.broadsideCharge.side = null;

    const btn = document.getElementById(`btn-fire-${side}`);
    if (btn) btn.classList.remove('charging');

    this.combat.hideAimSector();
    this.fireBroadside(side, charge);
  }

  cancelBroadsideCharge() {
    if (this.broadsideCharge.active && this.broadsideCharge.side) {
      const btn = document.getElementById(`btn-fire-${this.broadsideCharge.side}`);
      if (btn) btn.classList.remove('charging');
    }
    this.broadsideCharge.active = false;
    this.broadsideCharge.side = null;
    this.combat.hideAimSector();
  }

  initControls() {
    this.keys = {
      w: false, s: false, a: false, d: false,
      q: false, e: false,
      q_held: false, e_held: false
    };

    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (this.keys.hasOwnProperty(key)) this.keys[key] = true;

      if (key === 'arrowleft') this.keys.a = true;
      if (key === 'arrowright') this.keys.d = true;

      // Salvage / Loot Modal shortcuts
      if (this.activeSalvageEnemy) {
        if (key === '1' || key === 'r') {
          e.preventDefault();
          this.handleSalvageChoice('recovery');
          return;
        }
        if (key === '2' || key === 'l') {
          e.preventDefault();
          this.handleSalvageChoice('loot');
          return;
        }
      }

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
        if (!this.keys.q_held) {
          this.keys.q_held = true;
          this.startBroadsideCharge('port');
        }
      } else if (key === 'e') {
        if (!this.keys.e_held) {
          this.keys.e_held = true;
          this.startBroadsideCharge('starboard');
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      if (this.keys.hasOwnProperty(key)) this.keys[key] = false;

      if (key === 'q') {
        this.keys.q_held = false;
        this.releaseBroadsideCharge('port');
      } else if (key === 'e') {
        this.keys.e_held = false;
        this.releaseBroadsideCharge('starboard');
      }

      if (key === 'arrowleft') this.keys.a = false;
      if (key === 'arrowright') this.keys.d = false;
    });

    // Mouse & Touch drag to orbit camera around ship
    let isDragging = false;
    let prevMouseX = 0;
    let prevMouseY = 0;

    const isUIElement = (target) => {
      return !!(
        target.closest('#hud-top') ||
        target.closest('#hud-bottom') ||
        target.closest('#hud-top-right-tools') ||
        target.closest('#mobile-controls-container') ||
        target.closest('#hud-customizer-bar') ||
        target.closest('.modal-overlay') ||
        target.closest('#splash-modal') ||
        target.closest('#salvage-modal')
      );
    };

    window.addEventListener('mousedown', (e) => {
      if (isUIElement(e.target)) return;
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

    // Touch drag & pinch-to-zoom for mobile camera
    let touchDistanceStart = 0;
    let isTouchDraggingCam = false;
    let prevTouchX = 0;
    let prevTouchY = 0;

    window.addEventListener('touchstart', (e) => {
      if (isUIElement(e.target)) return;
      if (e.touches.length === 1) {
        isTouchDraggingCam = true;
        prevTouchX = e.touches[0].clientX;
        prevTouchY = e.touches[0].clientY;
        this.camLastUserDrag = performance.now();
      } else if (e.touches.length === 2) {
        isTouchDraggingCam = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchDistanceStart = Math.hypot(dx, dy);
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && isTouchDraggingCam) {
        const dx = e.touches[0].clientX - prevTouchX;
        const dy = e.touches[0].clientY - prevTouchY;
        prevTouchX = e.touches[0].clientX;
        prevTouchY = e.touches[0].clientY;

        this.camOrbit.angleH -= dx * 0.008;
        this.camOrbit.angleV = Math.max(0.06, Math.min(0.68, this.camOrbit.angleV + dy * 0.005));
        this.camLastUserDrag = performance.now();
      } else if (e.touches.length === 2 && touchDistanceStart > 0) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const pinchDelta = touchDistanceStart - dist;
        this.camOrbit.userZoom = Math.max(-15, Math.min(30, (this.camOrbit.userZoom || 0) + pinchDelta * 0.12));
        touchDistanceStart = dist;
      }
    }, { passive: true });

    window.addEventListener('touchend', () => {
      isTouchDraggingCam = false;
      touchDistanceStart = 0;
    });
  }

  initUI() {
    // 1. Main Menu Navigation: "Set Sails", "Multiplayer", "Settings"
    const btnSetSails = document.getElementById('btn-menu-set-sails');
    const btnMenuMultiplayer = document.getElementById('btn-menu-multiplayer');
    const btnMenuSettings = document.getElementById('btn-menu-settings');
    const menuMainView = document.getElementById('menu-main-view');
    const menuDifficultyView = document.getElementById('menu-difficulty-view');
    const btnDiffBack = document.getElementById('btn-difficulty-back');
    const splashModal = document.getElementById('splash-modal');
    const settingsModal = document.getElementById('settings-modal');
    const multiplayerModal = document.getElementById('multiplayer-modal');

    if (btnSetSails) {
      btnSetSails.addEventListener('click', () => {
        if (menuMainView) menuMainView.classList.add('hidden');
        if (menuDifficultyView) menuDifficultyView.classList.remove('hidden');
      });
    }

    if (btnDiffBack) {
      btnDiffBack.addEventListener('click', () => {
        if (menuDifficultyView) menuDifficultyView.classList.add('hidden');
        if (menuMainView) menuMainView.classList.remove('hidden');
      });
    }

    // Difficulty selection cards & buttons
    const diffCards = document.querySelectorAll('.difficulty-card, .diff-select-btn');
    diffCards.forEach((elem) => {
      elem.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = elem.classList.contains('difficulty-card') ? elem : elem.closest('.difficulty-card');
        const diff = card ? card.getAttribute('data-difficulty') : elem.getAttribute('data-difficulty');
        if (diff) {
          this.setDifficulty(diff);
          if (splashModal) splashModal.classList.add('hidden');
          this.sound.init();
        }
      });
    });

    // Settings Modal
    const btnSettingsHud = document.getElementById('btn-settings-hud');
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const openSettings = () => {
      if (settingsModal) settingsModal.classList.remove('hidden');
    };
    if (btnMenuSettings) btnMenuSettings.addEventListener('click', openSettings);
    if (btnSettingsHud) btnSettingsHud.addEventListener('click', openSettings);
    if (btnCloseSettings) btnCloseSettings.addEventListener('click', () => {
      if (settingsModal) settingsModal.classList.add('hidden');
    });

    // Multiplayer Modal
    const btnMultiplayerHud = document.getElementById('btn-multiplayer-hud');
    const btnCloseMultiplayer = document.getElementById('btn-close-multiplayer');
    const openMultiplayer = () => {
      if (multiplayerModal) multiplayerModal.classList.remove('hidden');
    };
    if (btnMenuMultiplayer) btnMenuMultiplayer.addEventListener('click', openMultiplayer);
    if (btnMultiplayerHud) btnMultiplayerHud.addEventListener('click', openMultiplayer);
    if (btnCloseMultiplayer) btnCloseMultiplayer.addEventListener('click', () => {
      if (multiplayerModal) multiplayerModal.classList.add('hidden');
    });

    // Audio button in top tools
    const muteBtn = document.getElementById('mute-btn');
    const settingsAudioBtn = document.getElementById('btn-settings-audio');
    const toggleSound = () => {
      const isMuted = this.sound.toggleMute();
      const txt = isMuted ? '🔇 Audio: OFF' : '🔊 Audio: ON';
      if (muteBtn) muteBtn.textContent = txt;
      if (settingsAudioBtn) settingsAudioBtn.textContent = txt;
    };
    if (muteBtn) muteBtn.addEventListener('click', toggleSound);
    if (settingsAudioBtn) settingsAudioBtn.addEventListener('click', toggleSound);

    [0, 1, 2].forEach((state) => {
      const btn = document.getElementById(`btn-sail-${state}`);
      if (btn) btn.addEventListener('click', () => this.changeSail(state));
    });

    const btnPort = document.getElementById('btn-fire-port');
    const btnStbd = document.getElementById('btn-fire-starboard');

    if (btnPort) {
      btnPort.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.startBroadsideCharge('port');
      });
      btnPort.addEventListener('mouseup', (e) => {
        e.stopPropagation();
        this.releaseBroadsideCharge('port');
      });
      btnPort.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        this.startBroadsideCharge('port');
      }, { passive: true });
      btnPort.addEventListener('touchend', (e) => {
        e.stopPropagation();
        this.releaseBroadsideCharge('port');
      });
    }

    if (btnStbd) {
      btnStbd.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.startBroadsideCharge('starboard');
      });
      btnStbd.addEventListener('mouseup', (e) => {
        e.stopPropagation();
        this.releaseBroadsideCharge('starboard');
      });
      btnStbd.addEventListener('touchstart', (e) => {
        e.stopPropagation();
        this.startBroadsideCharge('starboard');
      }, { passive: true });
      btnStbd.addEventListener('touchend', (e) => {
        e.stopPropagation();
        this.releaseBroadsideCharge('starboard');
      });
    }

    window.addEventListener('mouseup', () => {
      if (this.broadsideCharge && this.broadsideCharge.active) {
        this.releaseBroadsideCharge(this.broadsideCharge.side);
      }
    });
    window.addEventListener('touchend', () => {
      if (this.broadsideCharge && this.broadsideCharge.active) {
        this.releaseBroadsideCharge(this.broadsideCharge.side);
      }
    });

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

    // Salvage & Loot Modal Buttons
    const salvageRecoveryBtn = document.getElementById('btn-salvage-recovery');
    const salvageLootBtn = document.getElementById('btn-salvage-loot');
    if (salvageRecoveryBtn) {
      salvageRecoveryBtn.addEventListener('click', () => {
        this.handleSalvageChoice('recovery');
      });
    }
    if (salvageLootBtn) {
      salvageLootBtn.addEventListener('click', () => {
        this.handleSalvageChoice('loot');
      });
    }
  }

  initDifficulty() {
    this.setDifficulty('medium', false);
  }

  setDifficulty(diff, notifyMultiplayer = true) {
    this.difficulty = diff || 'medium';
    const settings = {
      easy: { playerMult: 1.5, enemyMult: 0.6, label: 'EASY' },
      medium: { playerMult: 1.0, enemyMult: 1.0, label: 'MED' },
      hard: { playerMult: 0.8, enemyMult: 1.5, label: 'HARD' }
    };
    const s = settings[this.difficulty] || settings.medium;
    if (this.combat) {
      this.combat.setDifficultyMultipliers(s.playerMult, s.enemyMult);
    }
    if (this.collision) {
      this.collision.setDifficultyMultipliers(s.playerMult, s.enemyMult);
    }
    const badge = document.getElementById('diff-badge-indicator');
    if (badge) {
      badge.textContent = s.label;
      if (this.difficulty === 'easy') {
        badge.style.color = '#81c784';
        badge.style.borderColor = '#4caf50';
      } else if (this.difficulty === 'hard') {
        badge.style.color = '#ff8a80';
        badge.style.borderColor = '#f44336';
      } else {
        badge.style.color = '#ffd54f';
        badge.style.borderColor = '#ffb300';
      }
    }
    document.querySelectorAll('.difficulty-card').forEach((c) => {
      if (c.getAttribute('data-difficulty') === this.difficulty) {
        c.classList.add('selected');
      } else {
        c.classList.remove('selected');
      }
    });
    if (notifyMultiplayer && this.multiplayer && this.multiplayer.isConnected && this.multiplayer.role === 'host') {
      this.multiplayer.send({ type: 'handshake', difficulty: this.difficulty });
    }
  }

  initMobileControls() {
    this.mobileSteer = 0;
    const isTouchDevice = ('ontouchstart' in window || navigator.maxTouchPoints > 0);
    const saved = localStorage.getItem('deadmanswake_mobile_controls');
    const defaultEnabled = saved !== null ? (saved === 'true') : isTouchDevice;
    this.setMobileControls(defaultEnabled);

    const toggleBtn = document.getElementById('btn-toggle-mobile-keys');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        this.setMobileControls(!this.mobileControlsEnabled);
      });
    }

    const btnLeft = document.getElementById('mbtn-steer-left');
    const btnRight = document.getElementById('mbtn-steer-right');
    const btnCenter = document.getElementById('mbtn-steer-center');

    const bindTouchButton = (btn, steerVal) => {
      if (!btn) return;
      const start = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.mobileSteer = steerVal;
        btn.classList.add('active');
      };
      const end = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.mobileSteer === steerVal) {
          this.mobileSteer = 0;
        }
        btn.classList.remove('active');
      };
      btn.addEventListener('mousedown', start);
      btn.addEventListener('mouseup', end);
      btn.addEventListener('mouseleave', end);
      btn.addEventListener('touchstart', start, { passive: false });
      btn.addEventListener('touchend', end, { passive: false });
    };

    bindTouchButton(btnLeft, -1.0);
    bindTouchButton(btnRight, 1.0);

    if (btnCenter) {
      const centerRudder = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.mobileSteer = 0;
        this.playerShip.rudder = 0;
        const helm = document.getElementById('helm-wheel');
        if (helm) helm.style.transform = 'rotate(0rad)';
      };
      btnCenter.addEventListener('click', centerRudder);
      btnCenter.addEventListener('touchstart', centerRudder, { passive: false });
    }

    // Mobile Target Lock button
    const btnLock = document.getElementById('mbtn-lock-target');
    if (btnLock) {
      btnLock.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const availableTargets = this.enemies.filter(en => !en.ship.isSinking);
        if (availableTargets.length > 0) {
          let nextIndex = 0;
          if (this.lockedEnemy) {
            const curIndex = availableTargets.indexOf(this.lockedEnemy);
            nextIndex = (curIndex + 1) % availableTargets.length;
            this.lockedEnemy.isLockedTarget = false;
          }
          this.lockedEnemy = availableTargets[nextIndex];
          this.lockedEnemy.isAlerted = true;
          this.lockedEnemy.isLockedTarget = true;
          this.lockedEnemy.standoff = false;
        }
      });
    }

    // Mobile Broadside Volley button
    const btnVolley = document.getElementById('mbtn-fire-broadside');
    if (btnVolley) {
      btnVolley.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.cooldowns.port <= 0) {
          this.fireBroadside('port', 0.5);
        } else if (this.cooldowns.starboard <= 0) {
          this.fireBroadside('starboard', 0.5);
        }
      });
    }
  }

  setMobileControls(enabled) {
    this.mobileControlsEnabled = !!enabled;
    document.body.classList.toggle('mobile-controls-active', this.mobileControlsEnabled);
    localStorage.setItem('deadmanswake_mobile_controls', this.mobileControlsEnabled ? 'true' : 'false');
    const toggleBtn = document.getElementById('btn-toggle-mobile-keys');
    if (toggleBtn) {
      toggleBtn.textContent = this.mobileControlsEnabled ? 'ON' : 'OFF';
      if (this.mobileControlsEnabled) toggleBtn.classList.add('active');
      else toggleBtn.classList.remove('active');
    }
  }

  initFullscreen() {
    const fsBtn = document.getElementById('btn-toggle-fullscreen');
    if (!fsBtn) return;

    const updateFsText = () => {
      fsBtn.textContent = document.fullscreenElement ? '⛶ Exit Fullscreen' : '⛶ Enter Fullscreen';
    };

    fsBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
      }
    });

    document.addEventListener('fullscreenchange', updateFsText);
  }

  initCustomizer() {
    this.isCustomizingHUD = false;
    const customizableWidgets = [
      'sail-lever-panel',
      'combat-panel',
      'helm-container',
      'mobile-controls-container',
      'status-card'
    ];

    // Load saved layout
    let savedLayout = null;
    try {
      savedLayout = JSON.parse(localStorage.getItem('deadmanswake_hud_layout'));
    } catch (e) {}

    customizableWidgets.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;

      // Apply saved position & scale
      if (savedLayout && savedLayout[id]) {
        const item = savedLayout[id];
        if (item.left) el.style.left = item.left;
        if (item.top) el.style.top = item.top;
        if (item.bottom) el.style.bottom = item.bottom;
        if (item.right) el.style.right = item.right;
        if (item.scale) {
          el.dataset.hudScale = item.scale;
          el.style.transform = `scale(${item.scale})`;
          el.style.transformOrigin = 'center center';
        }
      }

      // Add edit controls header
      const widgetTitle = el.getAttribute('data-widget-title') || id;
      const ctrlBar = document.createElement('div');
      ctrlBar.className = 'widget-edit-controls';
      ctrlBar.innerHTML = `
        <span>${widgetTitle}</span>
        <button class="widget-scale-btn minus" title="Shrink button">-</button>
        <button class="widget-scale-btn plus" title="Enlarge button">+</button>
        <span class="scale-label">${Math.round((parseFloat(el.dataset.hudScale) || 1.0) * 100)}%</span>
      `;
      el.appendChild(ctrlBar);

      // Handle scale buttons
      const minusBtn = ctrlBar.querySelector('.minus');
      const plusBtn = ctrlBar.querySelector('.plus');
      const label = ctrlBar.querySelector('.scale-label');

      const adjustScale = (delta) => {
        let currentScale = parseFloat(el.dataset.hudScale) || 1.0;
        currentScale = Math.max(0.6, Math.min(1.7, currentScale + delta));
        currentScale = Math.round(currentScale * 10) / 10;
        el.dataset.hudScale = currentScale;
        el.style.transform = `scale(${currentScale})`;
        el.style.transformOrigin = 'center center';
        label.textContent = `${Math.round(currentScale * 100)}%`;
      };

      minusBtn.addEventListener('click', (e) => { e.stopPropagation(); adjustScale(-0.1); });
      minusBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); adjustScale(-0.1); }, { passive: true });
      plusBtn.addEventListener('click', (e) => { e.stopPropagation(); adjustScale(0.1); });
      plusBtn.addEventListener('touchstart', (e) => { e.stopPropagation(); adjustScale(0.1); }, { passive: true });

      // Dragging logic
      let isDraggingWidget = false;
      let startMouseX = 0, startMouseY = 0;
      let startLeft = 0, startTop = 0;

      const onPointerDown = (e) => {
        if (!this.isCustomizingHUD) return;
        if (e.target.closest('.widget-scale-btn')) return;
        e.preventDefault();
        e.stopPropagation();

        isDraggingWidget = true;
        const pt = e.touches ? e.touches[0] : e;
        startMouseX = pt.clientX;
        startMouseY = pt.clientY;

        const rect = el.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;

        // Switch to fixed positioning during custom drag
        el.style.position = 'fixed';
        el.style.bottom = 'auto';
        el.style.right = 'auto';
        el.style.left = `${startLeft}px`;
        el.style.top = `${startTop}px`;
      };

      const onPointerMove = (e) => {
        if (!isDraggingWidget || !this.isCustomizingHUD) return;
        e.preventDefault();
        const pt = e.touches ? e.touches[0] : e;
        const dx = pt.clientX - startMouseX;
        const dy = pt.clientY - startMouseY;
        el.style.left = `${Math.max(10, Math.min(window.innerWidth - 80, startLeft + dx))}px`;
        el.style.top = `${Math.max(10, Math.min(window.innerHeight - 80, startTop + dy))}px`;
      };

      const onPointerUp = () => {
        isDraggingWidget = false;
      };

      el.addEventListener('mousedown', onPointerDown);
      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', onPointerUp);
      el.addEventListener('touchstart', onPointerDown, { passive: false });
      window.addEventListener('touchmove', onPointerMove, { passive: false });
      window.addEventListener('touchend', onPointerUp);
    });

    // Customizer toolbar buttons
    const openBtn = document.getElementById('btn-open-customizer');
    const bar = document.getElementById('hud-customizer-bar');
    const saveBtn = document.getElementById('btn-custom-save');
    const resetBtn = document.getElementById('btn-custom-reset');
    const closeBtn = document.getElementById('btn-custom-close');

    if (openBtn) {
      openBtn.addEventListener('click', () => {
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) settingsModal.classList.add('hidden');
        this.isCustomizingHUD = true;
        document.body.classList.add('hud-editing');
        if (bar) bar.classList.remove('hidden');
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const layout = {};
        customizableWidgets.forEach(id => {
          const el = document.getElementById(id);
          if (el) {
            layout[id] = {
              left: el.style.left,
              top: el.style.top,
              bottom: el.style.bottom,
              right: el.style.right,
              scale: parseFloat(el.dataset.hudScale) || 1.0
            };
          }
        });
        localStorage.setItem('deadmanswake_hud_layout', JSON.stringify(layout));
        this.isCustomizingHUD = false;
        document.body.classList.remove('hud-editing');
        if (bar) bar.classList.add('hidden');
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        localStorage.removeItem('deadmanswake_hud_layout');
        customizableWidgets.forEach(id => {
          const el = document.getElementById(id);
          if (el) {
            el.style.position = '';
            el.style.left = '';
            el.style.top = '';
            el.style.bottom = '';
            el.style.right = '';
            el.style.transform = '';
            el.dataset.hudScale = '1.0';
            const lbl = el.querySelector('.scale-label');
            if (lbl) lbl.textContent = '100%';
          }
        });
        this.isCustomizingHUD = false;
        document.body.classList.remove('hud-editing');
        if (bar) bar.classList.add('hidden');
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.isCustomizingHUD = false;
        document.body.classList.remove('hud-editing');
        if (bar) bar.classList.add('hidden');
      });
    }
  }

  initMultiplayerUI() {
    const modal = document.getElementById('multiplayer-modal');
    const tabHost = document.getElementById('tab-host');
    const tabJoin = document.getElementById('tab-join');
    const hostPanel = document.getElementById('mp-host-panel');
    const joinPanel = document.getElementById('mp-join-panel');
    const connPanel = document.getElementById('mp-connected-panel');

    const btnCreateHost = document.getElementById('btn-create-host');
    const hostIdle = document.getElementById('mp-host-idle');
    const hostActive = document.getElementById('mp-host-active');
    const hostCodeVal = document.getElementById('host-code-val');
    const copyBtn = document.getElementById('btn-copy-code');
    const btnSubmitJoin = document.getElementById('btn-submit-join');
    const joinInput = document.getElementById('join-room-input');
    const joinStatus = document.getElementById('mp-join-status');
    const btnStartMp = document.getElementById('btn-start-multiplayer-game');

    // Emote buttons
    const btnEmoteAhoy = document.getElementById('btn-p2p-emote-ahoy');
    const btnEmoteAttack = document.getElementById('btn-p2p-emote-attack');
    const btnEmoteFollow = document.getElementById('btn-p2p-emote-follow');

    if (btnEmoteAhoy) btnEmoteAhoy.addEventListener('click', () => this.multiplayer.sendEmote('☠️', 'Ahoy, Matey!'));
    if (btnEmoteAttack) btnEmoteAttack.addEventListener('click', () => this.multiplayer.sendEmote('⚔️', 'Prepare Broadside!'));
    if (btnEmoteFollow) btnEmoteFollow.addEventListener('click', () => this.multiplayer.sendEmote('🌊', 'Form Fleet & Follow!'));

    if (tabHost) {
      tabHost.addEventListener('click', () => {
        tabHost.classList.add('active');
        if (tabJoin) tabJoin.classList.remove('active');
        if (hostPanel) hostPanel.classList.remove('hidden');
        if (joinPanel) joinPanel.classList.add('hidden');
      });
    }

    if (tabJoin) {
      tabJoin.addEventListener('click', () => {
        tabJoin.classList.add('active');
        if (tabHost) tabHost.classList.remove('active');
        if (joinPanel) joinPanel.classList.remove('hidden');
        if (hostPanel) hostPanel.classList.add('hidden');
      });
    }

    if (btnCreateHost) {
      btnCreateHost.addEventListener('click', () => {
        this.multiplayer.hostGame((code) => {
          if (hostIdle) hostIdle.classList.add('hidden');
          if (hostActive) hostActive.classList.remove('hidden');
          if (hostCodeVal) hostCodeVal.textContent = code;
        });
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const code = hostCodeVal ? hostCodeVal.textContent : '';
        if (code && navigator.clipboard) {
          navigator.clipboard.writeText(code).then(() => {
            copyBtn.textContent = '✅ Copied!';
            setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
          });
        }
      });
    }

    if (btnSubmitJoin && joinInput) {
      btnSubmitJoin.addEventListener('click', () => {
        const code = joinInput.value.trim();
        if (!code) {
          if (joinStatus) {
            joinStatus.className = 'mp-status-msg error';
            joinStatus.textContent = 'Please enter a valid 5-letter Room Code';
          }
          return;
        }
        if (joinStatus) {
          joinStatus.className = 'mp-status-msg info';
          joinStatus.textContent = `Connecting to room ${code.toUpperCase()}...`;
        }
        this.multiplayer.joinGame(code);
      });
    }

    this.multiplayer.callbacks.onStatus = (msg, type) => {
      if (joinStatus) {
        joinStatus.className = `mp-status-msg ${type || 'info'}`;
        joinStatus.textContent = msg;
      }
      const hostStatus = document.getElementById('mp-host-status');
      if (hostStatus) hostStatus.textContent = msg;
    };

    this.multiplayer.callbacks.onConnect = (role, code) => {
      if (hostPanel) hostPanel.classList.add('hidden');
      if (joinPanel) joinPanel.classList.add('hidden');
      if (connPanel) connPanel.classList.remove('hidden');
      const p2pHud = document.getElementById('p2p-hud-widget');
      if (p2pHud) p2pHud.classList.remove('hidden');
      const p2pCrewStatus = document.getElementById('p2p-crew-status');
      if (p2pCrewStatus) p2pCrewStatus.textContent = `Crew (${code}): Connected`;
    };

    this.multiplayer.callbacks.onDisconnect = () => {
      const p2pHud = document.getElementById('p2p-hud-widget');
      if (p2pHud) p2pHud.classList.add('hidden');
    };

    if (btnStartMp) {
      btnStartMp.addEventListener('click', () => {
        if (modal) modal.classList.add('hidden');
        const splash = document.getElementById('splash-modal');
        if (splash) splash.classList.add('hidden');
        this.sound.init();
      });
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

  fireBroadside(side, charge = 0) {
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
      btn.classList.remove('charging');
      btn.classList.add('reloading');
    }

    const targetShips = [...this.enemies.map(e => e.ship)];
    if (this.multiplayer && this.multiplayer.remoteShip && !this.multiplayer.remoteShip.isSinking) {
      targetShips.push(this.multiplayer.remoteShip);
    }
    this.combat.fireBroadside(this.playerShip, targetShips, side, charge);

    if (this.multiplayer) {
      this.multiplayer.notifyBroadsideFired(side, charge);
    }
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

    // Dynamic Camera Shake upon collision / ramming impact
    if (this.cameraShake && this.cameraShake.intensity > 0) {
      const s = this.cameraShake.intensity;
      this.camera.position.x += (Math.random() - 0.5) * 2.2 * s;
      this.camera.position.y += (Math.random() - 0.5) * 1.6 * s;
      this.camera.position.z += (Math.random() - 0.5) * 2.2 * s;
      this.cameraShake.intensity = Math.max(0, this.cameraShake.intensity - delta * 2.6);
      this.cameraShake.duration = Math.max(0, this.cameraShake.duration - delta);
    }

    this.camera.lookAt(this.camLookTarget);
  }

  updateControls(delta) {
    const wheel = document.getElementById('helm-wheel');
    if (this.mobileSteer !== 0 && this.mobileSteer !== undefined) {
      this.playerShip.rudder = THREE.MathUtils.lerp(this.playerShip.rudder, this.mobileSteer, delta * 7.0);
    } else if (this.keys.a) {
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
        if (enemyNameEl) enemyNameEl.textContent = `${this.lockedEnemy.name} • ${this.lockedEnemy.shipClass || 'Frigate'}`;
        if (enemyDistEl) {
          const dist = Math.round(this.playerShip.position.distanceTo(this.lockedEnemy.ship.position));
          enemyDistEl.textContent = dist;
        }
        if (enemyHpValEl && enemyHpFillEl) {
          const curHp = Math.max(0, Math.round(this.lockedEnemy.ship.health));
          const maxHp = this.lockedEnemy.ship.maxHealth;
          const hpPct = Math.max(0, this.lockedEnemy.ship.health / maxHp);
          enemyHpFillEl.style.width = `${hpPct * 100}%`;
          enemyHpValEl.textContent = `${curHp}/${maxHp} (${Math.round(hpPct * 100)}%)`;
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

    // Remote Peer Ship (P2P Multiplayer)
    if (this.multiplayer && this.multiplayer.remoteShip && !this.multiplayer.remoteShip.isSinking) {
      const rRelX = (this.multiplayer.remoteShip.position.x - this.playerShip.position.x) * scale;
      const rRelZ = (this.multiplayer.remoteShip.position.z - this.playerShip.position.z) * scale;
      ctx.beginPath();
      ctx.arc(rRelX, rRelZ, 5.0, 0, Math.PI * 2);
      ctx.fillStyle = '#00e5ff';
      ctx.fill();
      ctx.strokeStyle = '#ffd54f';
      ctx.lineWidth = 1.5;
      ctx.stroke();
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

  // Trigger interactive Salvage / Loot choice when an enemy warship is sunk
  triggerSalvagePrompt(enemy) {
    if (!enemy) return;
    if (this.activeSalvageEnemy) {
      this.salvageQueue.push(enemy);
      return;
    }

    this.activeSalvageEnemy = enemy;
    const modal = document.getElementById('salvage-modal');
    const title = document.getElementById('salvage-enemy-title');
    if (title) {
      title.textContent = `${enemy.name || 'Enemy Warship'} Sunk!`;
    }
    if (modal) {
      modal.classList.remove('hidden');
    }

    if (this.sound && this.sound.playBell) {
      this.sound.playBell();
    }
  }

  // Handle player's choice: 'recovery' (+50 HP repair) or 'loot' (+350 Gold doubloons)
  handleSalvageChoice(choice) {
    const enemy = this.activeSalvageEnemy;
    if (!enemy) return;

    const modal = document.getElementById('salvage-modal');
    if (modal) {
      modal.classList.add('hidden');
    }

    const enemyPos = (enemy.ship && enemy.ship.position) ? enemy.ship.position.clone() : this.playerShip.position.clone();

    if (choice === 'recovery') {
      // 1. Help Recovery: restore +50 HP to player ship
      const healAmount = 50;
      this.playerShip.health = Math.min(this.playerShip.maxHealth, this.playerShip.health + healAmount);
      if (this.sound && this.sound.playShipRepair) {
        this.sound.playShipRepair();
      }
      this.combat.spawnFloatingReward(this.playerShip.position, '+50 HP', 'REPAIRED!', '#00e676');

      // Visual pulse on player health status card
      const hpCard = document.getElementById('status-card');
      if (hpCard) {
        hpCard.style.boxShadow = '0 0 25px #00e676, inset 0 0 15px rgba(0, 230, 118, 0.4)';
        setTimeout(() => {
          hpCard.style.boxShadow = '';
        }, 1000);
      }
    } else if (choice === 'loot') {
      // 2. Loot Cargo: award +350 Gold doubloons
      const goldAmount = 350;
      this.playerGold += goldAmount;
      if (this.sound && this.sound.playCoinLoot) {
        this.sound.playCoinLoot();
      }
      this.combat.spawnFloatingReward(this.playerShip.position, '+350 GOLD', 'PLUNDERED!', '#ffd700');

      // Update Gold HUD counter & trigger flash animation
      const goldEl = document.getElementById('gold-val');
      if (goldEl) {
        goldEl.textContent = this.playerGold;
        goldEl.classList.remove('gold-flash');
        void goldEl.offsetWidth; // trigger reflow
        goldEl.classList.add('gold-flash');
      }
    }

    // Spawn floating wooden wreckage crates and rum barrels bobbing at enemy sinking site
    this.spawnWreckageDebris(enemyPos);

    this.activeSalvageEnemy = null;

    // If another enemy warship sunk during this interaction, prompt it after brief pause
    if (this.salvageQueue && this.salvageQueue.length > 0) {
      const nextEnemy = this.salvageQueue.shift();
      setTimeout(() => {
        this.triggerSalvagePrompt(nextEnemy);
      }, 450);
    }
  }

  spawnWreckageDebris(pos) {
    const crateGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0x8d6e63,
      roughness: 0.85
    });

    const barrelGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.25, 8);
    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0x5d4037,
      roughness: 0.8
    });

    for (let i = 0; i < 5; i++) {
      const isBarrel = (i % 2 === 1);
      const mesh = new THREE.Mesh(isBarrel ? barrelGeo : crateGeo, isBarrel ? barrelMat : crateMat);
      const offsetX = (Math.random() - 0.5) * 16;
      const offsetZ = (Math.random() - 0.5) * 16;
      mesh.position.set(pos.x + offsetX, 0, pos.z + offsetZ);
      mesh.rotation.set(Math.random() * 0.4, Math.random() * Math.PI, Math.random() * 0.4);
      this.scene.add(mesh);

      this.floatingCrates.push({
        mesh,
        originX: mesh.position.x,
        originZ: mesh.position.z,
        rotSpeed: (Math.random() - 0.5) * 0.8,
        life: 0,
        maxLife: 30.0
      });
    }
  }

  updateEnemies(delta) {
    const playerPos = this.playerShip.position;

    // 0. Check for newly sunken enemy ships to trigger Salvage & Plunder choice
    for (const enemy of this.enemies) {
      if (enemy && enemy.ship && enemy.ship.isSinking && !enemy.hasPromptedSalvage) {
        enemy.hasPromptedSalvage = true;
        this.triggerSalvagePrompt(enemy);
      }
    }

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

    // Update Hold-to-Charge Broadside Aiming System (Narrowing Yellow Sector + Long Range Line)
    if (this.broadsideCharge && this.broadsideCharge.active) {
      const side = this.broadsideCharge.side;
      if (this.cooldowns[side] > 0 || this.playerShip.isSinking) {
        this.cancelBroadsideCharge();
      } else {
        this.broadsideCharge.chargeTime += delta;
        const charge = Math.min(1.0, this.broadsideCharge.chargeTime / this.broadsideCharge.maxChargeTime);
        const aimResult = this.combat.updateAimSector(this.playerShip, side, charge, this.enemies);

        // If an enemy comes on the yellow line, lock onto it so HUD health bar tracks it!
        if (aimResult && aimResult.lockedEnemy) {
          const enemyOnLine = aimResult.lockedEnemy;
          if (this.lockedEnemy !== enemyOnLine) {
            if (this.lockedEnemy) {
              this.lockedEnemy.isLockedTarget = false;
            }
            this.lockedEnemy = enemyOnLine;
            this.lockedEnemy.isAlerted = true;
            this.lockedEnemy.isLockedTarget = true;
            this.lockedEnemy.standoff = false;
          }
        }

        const ring = document.getElementById(`ring-${side}`);
        const timer = document.getElementById(`timer-${side}`);
        const currentRange = Math.round(THREE.MathUtils.lerp(45, 145, charge));

        if (ring) {
          const ringCircumference = 282.74;
          ring.style.strokeDashoffset = ringCircumference * (1 - charge);
        }
        if (timer) {
          if (aimResult && aimResult.lockedEnemy) {
            const enemyDist = Math.round(aimResult.closestLockedDist);
            timer.textContent = `${enemyDist}m LOCKED`;
          } else {
            timer.textContent = `${currentRange}m${charge >= 0.99 ? ' MAX' : ''}`;
          }
        }
      }
    }

    // 2. Update physical simulation
    this.ocean.update(delta, this.playerShip.position);
    this.playerShip.update(delta, this.wind);
    this.updateEnemies(delta);
    this.collision.update(delta, this.playerShip, this.enemies);
    this.combat.update(delta);

    // Update P2P multiplayer remote ship
    if (this.multiplayer) {
      this.multiplayer.update(delta);
    }

    // Update floating wreckage crates bobbing on ocean waves
    if (this.floatingCrates && this.floatingCrates.length > 0) {
      for (let i = this.floatingCrates.length - 1; i >= 0; i--) {
        const crate = this.floatingCrates[i];
        crate.life += delta;
        if (crate.life >= crate.maxLife) {
          this.scene.remove(crate.mesh);
          crate.mesh.geometry.dispose();
          this.floatingCrates.splice(i, 1);
        } else {
          const waveY = this.ocean.getWaveHeight(crate.originX, crate.originZ);
          crate.mesh.position.y = waveY + 0.25;
          crate.mesh.rotation.y += crate.rotSpeed * delta;
          if (crate.life > crate.maxLife - 3) {
            const fade = (crate.maxLife - crate.life) / 3;
            crate.mesh.scale.setScalar(Math.max(0.01, fade));
          }
        }
      }
    }

    // 3. Camera & HUD
    if (this.isFirstFrame) {
      console.log('⛵ [Dead-Man-s-Wake] First frame rendered! Ship pos:', this.playerShip.position);
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
  console.log('⛵ [Dead-Man-s-Wake] Booting game engine...');
  window.__gameInstance = new Game();
  window.game = window.__gameInstance;
  console.log('⛵ [Dead-Man-s-Wake] Game engine initialized successfully!');
  if (typeof window !== 'undefined') {
    if (window.location.search.includes('autostart')) {
      const modal = document.getElementById('splash-modal');
      if (modal) modal.classList.add('hidden');
      if (window.__gameInstance.sound) {
        window.__gameInstance.sound.init();
      }
    }
    if (window.location.search.includes('testSalvage')) {
      setTimeout(() => {
        if (window.game && window.game.enemies && window.game.enemies[0]) {
          const enemy = window.game.enemies[0];
          window.game.playerShip.health = 50;
          enemy.ship.takeDamage(100);
          console.log('🧪 [TEST] Enemy HMS Defiance sunk for salvage test!');
        }
      }, 1200);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootGame);
} else {
  bootGame();
}

