import * as THREE from 'three';
import { Ship } from './ship.js';

export class EnemyShip {
  constructor(scene, ocean, combatSystem, initialPos, name = 'HMS Defiance', maxHealth = 280, shipClass = 'Frigate') {
    this.scene = scene;
    this.ocean = ocean;
    this.combat = combatSystem;
    this.name = name;
    this.shipClass = shipClass;

    // Load Royal Navy Frigate 3D GLB model with authentic naval warship health pool
    this.ship = new Ship(scene, ocean, false, 'ship-large.glb', maxHealth);
    this.ship.position.copy(initialPos);
    this.ship.heading = Math.PI * 0.75;
    this.ship.setSailState(1);

    // AI & Combat Alert State
    this.state = 'PATROL'; // 'PATROL', 'ENGAGE', 'BROADSIDE', 'STANDOFF'
    this.isAlerted = false;
    this.isLockedTarget = false;
    this.standoff = false;
    this.fireCooldown = 3.2 + Math.random() * 2.0;
    this.targetPlayer = null;
    this.patrolCenter = initialPos.clone();
    this.patrolAngle = Math.random() * Math.PI * 2;
    this.tacticalSide = (Math.random() > 0.5) ? 1 : -1;

    // 3D Threat Diamond Billboard Sprite floating above the mast
    this.threatSprite = this.createThreatDiamondSprite();
    this.scene.add(this.threatSprite);
  }

  createThreatDiamondSprite() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    this.diamondCanvas = canvas;
    this.diamondCtx = canvas.getContext('2d');
    this.currentDiamondMode = null;
    this.renderDiamondCanvas(false, false);

    const texture = new THREE.CanvasTexture(canvas);
    this.diamondTexture = texture;
    const mat = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true
    });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 999;
    sprite.scale.set(5.5, 5.5, 1);
    return sprite;
  }

  renderDiamondCanvas(alerted, standoff) {
    const mode = alerted ? 'alerted' : (standoff ? 'standoff' : 'patrol');
    if (this.currentDiamondMode === mode) return;
    this.currentDiamondMode = mode;

    const ctx = this.diamondCtx;
    if (!ctx) return;

    ctx.clearRect(0, 0, 128, 128);

    const cx = 64;
    const cy = 64;
    const size = 36;

    let fillGrad = ctx.createLinearGradient(cx - size, cy - size, cx + size, cy + size);
    let strokeColor = '#ffffff';
    let glowColor = 'rgba(255, 23, 68, 0.85)';

    if (alerted) {
      fillGrad.addColorStop(0, '#ff1744');
      fillGrad.addColorStop(0.5, '#d50000');
      fillGrad.addColorStop(1, '#880e4f');
      strokeColor = '#ffffff';
      glowColor = 'rgba(255, 23, 68, 0.95)';
    } else if (standoff) {
      fillGrad.addColorStop(0, '#ffa726');
      fillGrad.addColorStop(0.5, '#f57c00');
      fillGrad.addColorStop(1, '#e65100');
      strokeColor = '#fff3e0';
      glowColor = 'rgba(255, 167, 38, 0.7)';
    } else {
      fillGrad.addColorStop(0, '#ffca28');
      fillGrad.addColorStop(0.5, '#ffb300');
      fillGrad.addColorStop(1, '#ff8f00');
      strokeColor = '#ffffff';
      glowColor = 'rgba(255, 179, 0, 0.6)';
    }

    ctx.save();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 14;

    ctx.beginPath();
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx + size * 0.72, cy);
    ctx.lineTo(cx, cy + size);
    ctx.lineTo(cx - size * 0.72, cy);
    ctx.closePath();

    ctx.fillStyle = fillGrad;
    ctx.fill();

    ctx.lineWidth = 4;
    ctx.strokeStyle = strokeColor;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.restore();

    if (this.diamondTexture) {
      this.diamondTexture.needsUpdate = true;
    }
  }

  update(delta, wind, playerShip) {
    this.targetPlayer = playerShip;
    this.fireCooldown -= delta;

    if (this.ship.isSinking) {
      this.ship.update(delta, wind);
      if (this.threatSprite) this.threatSprite.visible = false;
      return;
    }

    // Position threat diamond directly above ship's main mast
    if (this.threatSprite) {
      this.threatSprite.visible = true;
      this.threatSprite.position.set(
        this.ship.position.x,
        this.ship.heave + 15.5,
        this.ship.position.z
      );

      // Render correct diamond visual state
      this.renderDiamondCanvas(this.isAlerted, this.standoff);

      // Pulsing scale animation when alerted
      if (this.isAlerted) {
        const pulse = 6.8 * (1.0 + Math.sin(performance.now() * 0.008) * 0.16);
        this.threatSprite.scale.set(pulse, pulse, 1);
      } else {
        this.threatSprite.scale.set(5.2, 5.2, 1);
      }
    }

    const toPlayer = playerShip.position.clone().sub(this.ship.position);
    const dist = toPlayer.length();

    // 1-on-1 COMBAT LOGIC:
    // If another enemy ship is already engaged, this ship must STAND OFF and back away!
    if (this.standoff) {
      this.state = 'STANDOFF';
      this.isAlerted = false;

      // Steer away from player to maintain reserve perimeter (160m+)
      if (dist < 180) {
        this.ship.setSailState(1);
        const steerAwayAngle = Math.atan2(toPlayer.x, toPlayer.z);
        this.steerTowards(steerAwayAngle, delta);
      } else {
        this.ship.setSailState(0); // Hold position at perimeter
      }
    } else if (this.isLockedTarget) {
      // ACTIVE ENGAGED COMBAT TARGET
      this.isAlerted = true;
      const hpPct = this.ship.health / this.ship.maxHealth;

      if (dist > 70) {
        // Intercept and chase player at Full Sail
        this.state = 'ENGAGE';
        this.ship.setSailState(2);
        const targetAngle = Math.atan2(-toPlayer.x, -toPlayer.z);
        this.steerTowards(targetAngle, delta);

        // Long-range harassing fire if player is in line-of-fire
        if (this.fireCooldown <= 0 && dist < 115) {
          this.fireAtPlayer(playerShip);
          this.fireCooldown = (hpPct < 0.45 ? 2.8 : 3.8) + Math.random() * 1.5;
        }
      } else {
        // Close-quarters tactical maneuvering
        this.state = 'BROADSIDE';
        // If heavily damaged, enemy accelerates to maintain ramming threat or evasive speed
        this.ship.setSailState(hpPct < 0.45 ? 2 : 1);

        const right = this.ship.getRightVector();
        const toPlayerNorm = toPlayer.clone().normalize();
        const sideDot = right.dot(toPlayerNorm);

        // Turn towards the side offering easiest broadside bearing
        const preferredOffset = (sideDot >= 0 ? 1 : -1) * (Math.PI * 0.46);
        const angleToPlayer = Math.atan2(-toPlayer.x, -toPlayer.z);
        const broadsideAngle = angleToPlayer + preferredOffset;

        this.steerTowards(broadsideAngle, delta);

        if (this.fireCooldown <= 0 && dist < 115) {
          this.fireAtPlayer(playerShip);
          const baseCooldown = (hpPct < 0.45 ? 2.5 : 3.4);
          this.fireCooldown = baseCooldown + Math.random() * 1.6;
        }
      }
    } else {
      // Peaceful patrol around patrolCenter
      this.state = 'PATROL';
      this.isAlerted = false;
      this.ship.setSailState(1);
      this.patrolAngle += delta * 0.12;
      const targetPos = this.patrolCenter.clone().add(new THREE.Vector3(
        Math.cos(this.patrolAngle) * 50,
        0,
        Math.sin(this.patrolAngle) * 50
      ));
      const toTarget = targetPos.sub(this.ship.position);
      const targetAngle = Math.atan2(-toTarget.x, -toTarget.z);
      this.steerTowards(targetAngle, delta);
    }

    this.ship.update(delta, wind);
  }

  steerTowards(targetHeading, delta) {
    let diff = targetHeading - this.ship.heading;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;

    const steer = -Math.max(-1.0, Math.min(1.0, diff * 1.6));
    this.ship.rudder = THREE.MathUtils.lerp(this.ship.rudder, steer, delta * 3.2);
  }

  fireAtPlayer(playerShip) {
    const right = this.ship.getRightVector();
    const toPlayer = playerShip.position.clone().sub(this.ship.position);
    const dist = toPlayer.length();
    const toPlayerNorm = toPlayer.clone().normalize();

    const side = right.dot(toPlayerNorm) > 0 ? 'starboard' : 'port';

    // Ballistic charge calculation so enemy cannonballs accurately reach player across 40m - 120m!
    const charge = THREE.MathUtils.clamp((dist - 35) / 95, 0.08, 1.0);
    this.combat.fireBroadside(this.ship, playerShip, side, charge);
  }
}
