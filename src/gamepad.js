import * as THREE from 'three';

export class GamepadController {
  constructor(game) {
    this.game = game;
    this.activeGamepadIndex = null;
    this.connected = false;
    this.gamepadName = '';

    // Debounce trackers for single-press buttons (prevent rapid repeating triggers)
    this.prevButtons = new Map();
    this.stickSailDebounce = 0;

    // Deadzone for analog sticks
    this.stickDeadzone = 0.18;

    // Camera orbit sensitivity
    this.camOrbitSpeed = 2.4;

    this.initEvents();
  }

  initEvents() {
    window.addEventListener('gamepadconnected', (e) => {
      this.activeGamepadIndex = e.gamepad.index;
      this.connected = true;
      this.gamepadName = this.formatGamepadName(e.gamepad.id);
      console.log(`🎮 [Gamepad] Connected at index ${e.gamepad.index}: ${e.gamepad.id}`);
      if (this.game && this.game.showToast) {
        this.game.showToast(`🎮 Controller Connected: ${this.gamepadName}`);
      }
      this.vibrate(100, 0.4, 0.4);
    });

    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.activeGamepadIndex === e.gamepad.index) {
        console.log(`🎮 [Gamepad] Disconnected: ${e.gamepad.id}`);
        this.activeGamepadIndex = null;
        this.connected = false;
        if (this.game && this.game.showToast) {
          this.game.showToast('🎮 Controller Disconnected');
        }
      }
    });
  }

  formatGamepadName(rawId) {
    const lower = rawId.toLowerCase();
    if (lower.includes('xbox') || lower.includes('x-box') || lower.includes('microsoft')) {
      return 'Xbox Controller';
    }
    if (lower.includes('dualsense') || lower.includes('ps5') || lower.includes('0ce6')) {
      return 'PlayStation DualSense (PS5)';
    }
    if (lower.includes('dualshock') || lower.includes('ps4') || lower.includes('sony') || lower.includes('05c4')) {
      return 'PlayStation DualShock (PS4)';
    }
    if (lower.includes('switch') || lower.includes('pro controller')) {
      return 'Nintendo Switch Pro Controller';
    }
    return rawId.split('(')[0].trim() || 'Gamepad Controller';
  }

  getGamepad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const gamepads = navigator.getGamepads();
    if (this.activeGamepadIndex !== null && gamepads[this.activeGamepadIndex]) {
      return gamepads[this.activeGamepadIndex];
    }
    // Fallback to first available connected gamepad
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i] && gamepads[i].connected) {
        this.activeGamepadIndex = i;
        this.connected = true;
        this.gamepadName = this.formatGamepadName(gamepads[i].id);
        return gamepads[i];
      }
    }
    this.connected = false;
    return null;
  }

  isButtonPressed(gp, index) {
    if (!gp || !gp.buttons || !gp.buttons[index]) return false;
    const btn = gp.buttons[index];
    return typeof btn === 'object' ? btn.pressed : btn > 0.5;
  }

  getButtonValue(gp, index) {
    if (!gp || !gp.buttons || !gp.buttons[index]) return 0;
    const btn = gp.buttons[index];
    return typeof btn === 'object' ? btn.value : (btn ? 1 : 0);
  }

  wasJustPressed(gp, index) {
    const isPressed = this.isButtonPressed(gp, index);
    const wasPressed = !!this.prevButtons.get(index);
    this.prevButtons.set(index, isPressed);
    return isPressed && !wasPressed;
  }

  vibrate(duration = 200, weak = 0.5, strong = 0.5) {
    const gp = this.getGamepad();
    if (!gp || !gp.vibrationActuator) return;
    try {
      gp.vibrationActuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration: duration,
        weakMagnitude: Math.min(1.0, Math.max(0, weak)),
        strongMagnitude: Math.min(1.0, Math.max(0, strong))
      }).catch(() => {});
    } catch (e) {}
  }

  update(delta) {
    const gp = this.getGamepad();
    if (!gp || !this.game || !this.game.playerShip) return;

    // -------------------------------------------------------------
    // Menu / Settings / Pause Toggle: Start / Options (btn 9)
    // -------------------------------------------------------------
    if (this.wasJustPressed(gp, 9)) {
      const settingsModal = document.getElementById('settings-modal');
      if (settingsModal) {
        if (settingsModal.classList.contains('hidden')) {
          if (typeof this.game.openSettings === 'function') {
            this.game.openSettings();
          } else {
            settingsModal.classList.remove('hidden');
          }
        } else {
          if (typeof this.game.closeSettings === 'function') {
            this.game.closeSettings();
          } else {
            settingsModal.classList.add('hidden');
          }
        }
      }
    }

    // Cancel / Back Button: B (Xbox) / Circle (PlayStation) (btn 1)
    if (this.wasJustPressed(gp, 1)) {
      const settingsModal = document.getElementById('settings-modal');
      if (settingsModal && !settingsModal.classList.contains('hidden')) {
        if (typeof this.game.closeSettings === 'function') {
          this.game.closeSettings();
        } else {
          settingsModal.classList.add('hidden');
        }
        return;
      }
      const infoGuideModal = document.getElementById('info-guide-modal');
      if (infoGuideModal && !infoGuideModal.classList.contains('hidden')) {
        infoGuideModal.classList.add('hidden');
        this.game.lastTime = performance.now();
        return;
      }
    }

    // When game is paused or HUD customizer is active, do NOT process ship controls
    if (this.game.isCustomizingHUD) return;
    if (typeof this.game.isGamePaused === 'function' && this.game.isGamePaused()) return;

    const ship = this.game.playerShip;

    // -------------------------------------------------------------
    // 1. Steering (Left Stick X & D-Pad Left/Right)
    // -------------------------------------------------------------
    let steerInput = 0;
    const stickX = gp.axes && gp.axes.length > 0 ? gp.axes[0] : 0;
    if (Math.abs(stickX) > this.stickDeadzone) {
      steerInput = stickX;
    } else {
      // D-Pad Left / Right
      const dpadLeft = this.isButtonPressed(gp, 14);
      const dpadRight = this.isButtonPressed(gp, 15);
      if (dpadLeft && !dpadRight) steerInput = -1.0;
      else if (dpadRight && !dpadLeft) steerInput = 1.0;
    }

    // Apply rudder smoothly if gamepad is providing input
    if (Math.abs(steerInput) > 0.05) {
      ship.rudder = THREE.MathUtils.lerp(ship.rudder, steerInput, delta * 6.0);
      if (this.game.steeringWheelRotation !== undefined) {
        this.game.steeringWheelRotation = -ship.rudder * Math.PI * 1.5;
      }
    }

    // -------------------------------------------------------------
    // 2. Sail Rigging (Speed / Sail State)
    // Up: D-Pad Up (btn 12) or Left Stick Up (axis 1 < -0.6)
    // Down: D-Pad Down (btn 13) or Left Stick Down (axis 1 > 0.6)
    // -------------------------------------------------------------
    if (this.stickSailDebounce > 0) {
      this.stickSailDebounce -= delta;
    }

    const dpadUp = this.wasJustPressed(gp, 12);
    const dpadDown = this.wasJustPressed(gp, 13);
    const stickY = gp.axes && gp.axes.length > 1 ? gp.axes[1] : 0;

    if (dpadUp) {
      this.game.changeSail(Math.min(2, ship.sailState + 1));
      this.vibrate(80, 0.3, 0.2);
    } else if (dpadDown) {
      this.game.changeSail(Math.max(0, ship.sailState - 1));
      this.vibrate(80, 0.3, 0.2);
    } else if (this.stickSailDebounce <= 0) {
      if (stickY < -0.72) {
        this.game.changeSail(Math.min(2, ship.sailState + 1));
        this.stickSailDebounce = 0.35;
        this.vibrate(80, 0.3, 0.2);
      } else if (stickY > 0.72) {
        this.game.changeSail(Math.max(0, ship.sailState - 1));
        this.stickSailDebounce = 0.35;
        this.vibrate(80, 0.3, 0.2);
      }
    }

    // -------------------------------------------------------------
    // 3. Broadside Cannons
    // Port (Left): Left Trigger (btn 6) or X / Square (btn 2)
    // Starboard (Right): Right Trigger (btn 7) or B / Circle (btn 1)
    // -------------------------------------------------------------
    const leftTrigger = this.getButtonValue(gp, 6) > 0.5 || this.wasJustPressed(gp, 2);
    const rightTrigger = this.getButtonValue(gp, 7) > 0.5 || this.wasJustPressed(gp, 1);

    if (leftTrigger && this.game.cooldowns.port <= 0) {
      this.game.fireBroadside('port');
      this.vibrate(220, 0.8, 0.6);
    }
    if (rightTrigger && this.game.cooldowns.starboard <= 0) {
      this.game.fireBroadside('starboard');
      this.vibrate(220, 0.8, 0.6);
    }

    // -------------------------------------------------------------
    // 4. Tactical Dodges (Bumpers)
    // Forward Surge: Right Bumper (btn 5)
    // Reverse Brake: Left Bumper (btn 4)
    // -------------------------------------------------------------
    if (this.wasJustPressed(gp, 5)) {
      this.game.triggerDodge(1);
      this.vibrate(150, 0.5, 0.7);
    }
    if (this.wasJustPressed(gp, 4)) {
      this.game.triggerDodge(-1);
      this.vibrate(150, 0.5, 0.7);
    }

    // -------------------------------------------------------------
    // 5. Target Lock Toggle: Y / Triangle (btn 3) or R3 (btn 11) or A / Cross (btn 0)
    // -------------------------------------------------------------
    if (this.wasJustPressed(gp, 3) || this.wasJustPressed(gp, 11)) {
      this.game.toggleTargetLock();
      this.vibrate(90, 0.4, 0.3);
    }

    // -------------------------------------------------------------
    // 6. Camera Orbit (Right Stick X & Y)
    // -------------------------------------------------------------
    if (gp.axes && gp.axes.length >= 4) {
      const rightX = gp.axes[2];
      const rightY = gp.axes[3];

      if (Math.abs(rightX) > this.stickDeadzone) {
        if (this.game.camOrbit) {
          this.game.camOrbit.angleH += rightX * this.camOrbitSpeed * delta;
          this.game.camLastUserDrag = performance.now();
        } else if (this.game.camHeading !== undefined) {
          this.game.camHeading += rightX * this.camOrbitSpeed * delta;
        }
      }
      if (Math.abs(rightY) > this.stickDeadzone) {
        if (this.game.camOrbit) {
          this.game.camOrbit.angleV = THREE.MathUtils.clamp(
            this.game.camOrbit.angleV - rightY * delta * 1.5,
            0.04,
            0.85
          );
          this.game.camLastUserDrag = performance.now();
        }
      }
    }
  }
}
