import * as THREE from 'three';
import { Ship } from './ship.js';

export class EnemyShip {
  constructor(scene, ocean, combatSystem, initialPos, name = 'HMS Defiance') {
    this.scene = scene;
    this.ocean = ocean;
    this.combat = combatSystem;
    this.name = name;

    // Load Royal Navy Frigate 3D GLB model
    this.ship = new Ship(scene, ocean, false, 'ship-large.glb');
    this.ship.position.copy(initialPos);
    this.ship.heading = Math.PI * 0.75;
    this.ship.setSailState(1);

    // AI & Combat Alert State
    this.state = 'PATROL'; // 'PATROL', 'ENGAGE', 'BROADSIDE', 'STANDOFF'
    this.isAlerted = false;
    this.isLockedTarget = false;
    this.standoff = false;
    this.fireCooldown = 3.5 + Math.random() * 2.0;
    this.targetPlayer = null;
    this.patrolCenter = initialPos.clone();
    this.patrolAngle = Math.random() * Math.PI * 2;

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
    const r = 40;

    if (alerted) {
      // 1. Vibrant Crimson Alert Diamond with Golden Rim
      ctx.shadowColor = '#ff1744';
      ctx.shadowBlur = 16;

      // Outer diamond
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fillStyle = '#b71c1c';
      ctx.fill();

      // Inner glowing diamond
      ctx.shadowBlur = 0;
      ctx.beginPath();
      const ir = r * 0.78;
      ctx.moveTo(cx, cy - ir);
      ctx.lineTo(cx + ir, cy);
      ctx.lineTo(cx, cy + ir);
      ctx.lineTo(cx - ir, cy);
      ctx.closePath();
      ctx.fillStyle = '#ff1744';
      ctx.fill();

      // Golden border
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#ffd54f';
      ctx.stroke();

      // Threat Exclamation Symbol
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 36px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', cx, cy + 1);
    } else if (standoff) {
      // 2. Standoff Mode (Subtle Dim Steel Grey - Backing off)
      ctx.beginPath();
      const ir = r * 0.65;
      ctx.moveTo(cx, cy - ir);
      ctx.lineTo(cx + ir, cy);
      ctx.lineTo(cx, cy + ir);
      ctx.lineTo(cx - ir, cy);
      ctx.closePath();
      ctx.fillStyle = 'rgba(60, 60, 60, 0.65)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#90a4ae';
      ctx.stroke();
    } else {
      // 3. Patrol Mode (Warm Amber Diamond)
      ctx.beginPath();
      const ir = r * 0.68;
      ctx.moveTo(cx, cy - ir);
      ctx.lineTo(cx + ir, cy);
      ctx.lineTo(cx, cy + ir);
      ctx.lineTo(cx - ir, cy);
      ctx.closePath();
      ctx.fillStyle = 'rgba(180, 110, 10, 0.45)';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffb300';
      ctx.stroke();
    }

    if (this.diamondTexture) this.diamondTexture.needsUpdate = true;
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

      if (dist > 48) {
        this.state = 'ENGAGE';
        this.ship.setSailState(2); // Full sail to pursue and intercept
        const targetAngle = Math.atan2(-toPlayer.x, -toPlayer.z);
        this.steerTowards(targetAngle, delta);
      } else {
        this.state = 'BROADSIDE';
        this.ship.setSailState(1); // Half sail for tighter combat maneuvering

        // Broadside angle perpendicular to player
        const angleToPlayer = Math.atan2(-toPlayer.x, -toPlayer.z);
        const broadsideAngle = angleToPlayer + Math.PI * 0.5;
        this.steerTowards(broadsideAngle, delta);

        if (this.fireCooldown <= 0 && dist < 65) {
          this.fireAtPlayer(playerShip);
          this.fireCooldown = 4.2 + Math.random() * 2.0;
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

    const steer = -Math.max(-1.0, Math.min(1.0, diff * 1.5));
    this.ship.rudder = THREE.MathUtils.lerp(this.ship.rudder, steer, delta * 3.0);
  }

  fireAtPlayer(playerShip) {
    const right = this.ship.getRightVector();
    const toPlayer = playerShip.position.clone().sub(this.ship.position).normalize();

    const side = right.dot(toPlayer) > 0 ? 'starboard' : 'port';
    this.combat.fireBroadside(this.ship, playerShip, side);
  }
}
