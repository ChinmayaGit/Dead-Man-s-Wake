import * as THREE from 'three';
import { Ship } from './ship.js';

export class EnemyShip {
  constructor(scene, ocean, combatSystem, initialPos) {
    this.scene = scene;
    this.ocean = ocean;
    this.combat = combatSystem;

    // Load Royal Navy Frigate 3D GLB model
    this.ship = new Ship(scene, ocean, false, 'ship-large.glb');
    this.ship.position.copy(initialPos);
    this.ship.heading = Math.PI * 0.75;
    this.ship.setSailState(1);

    // AI state
    this.state = 'PATROL';
    this.fireCooldown = 4.0;
    this.targetPlayer = null;
    this.patrolCenter = initialPos.clone();
    this.patrolAngle = 0;

    // 3D Health Bar Sprite
    this.healthBar = this.createHealthBarSprite();
    this.scene.add(this.healthBar);
  }

  createHealthBarSprite() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 32;
    this.hpCanvas = canvas;
    this.hpCtx = canvas.getContext('2d');
    this.updateHealthBarCanvas();

    const texture = new THREE.CanvasTexture(canvas);
    this.hpTexture = texture;
    const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(12, 1.5, 1);
    return sprite;
  }

  updateHealthBarCanvas() {
    const ctx = this.hpCtx;
    if (!ctx) return;
    ctx.clearRect(0, 0, 256, 32);

    // Background border
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, 256, 32);

    // Health Fill
    const pct = Math.max(0, this.ship.health / this.ship.maxHealth);
    ctx.fillStyle = pct > 0.4 ? '#e53935' : '#b71c1c';
    ctx.fillRect(4, 4, (256 - 8) * pct, 24);

    // Label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Royal Navy Frigate: ${Math.round(this.ship.health)}%`, 128, 22);

    if (this.hpTexture) this.hpTexture.needsUpdate = true;
  }

  update(delta, wind, playerShip) {
    this.targetPlayer = playerShip;
    this.fireCooldown -= delta;

    if (this.ship.isSinking) {
      this.ship.update(delta, wind);
      this.healthBar.visible = false;
      return;
    }

    this.healthBar.position.set(
      this.ship.position.x,
      this.ship.heave + 15.0,
      this.ship.position.z
    );

    const toPlayer = playerShip.position.clone().sub(this.ship.position);
    const dist = toPlayer.length();

    if (dist < 140) {
      if (dist > 50) {
        this.state = 'ENGAGE';
        this.ship.setSailState(2);
        const targetAngle = Math.atan2(-toPlayer.x, -toPlayer.z);
        this.steerTowards(targetAngle, delta);
      } else {
        this.state = 'BROADSIDE';
        this.ship.setSailState(1);

        const angleToPlayer = Math.atan2(-toPlayer.x, -toPlayer.z);
        const broadsideAngle = angleToPlayer + Math.PI * 0.5;
        this.steerTowards(broadsideAngle, delta);

        if (this.fireCooldown <= 0 && dist < 65) {
          this.fireAtPlayer(playerShip);
          this.fireCooldown = 4.5 + Math.random() * 2.0;
        }
      }
    } else {
      this.state = 'PATROL';
      this.ship.setSailState(1);
      this.patrolAngle += delta * 0.15;
      const targetPos = this.patrolCenter.clone().add(new THREE.Vector3(
        Math.cos(this.patrolAngle) * 45,
        0,
        Math.sin(this.patrolAngle) * 45
      ));
      const toTarget = targetPos.sub(this.ship.position);
      const targetAngle = Math.atan2(-toTarget.x, -toTarget.z);
      this.steerTowards(targetAngle, delta);
    }

    const prevHp = this.ship.health;
    this.ship.update(delta, wind);

    if (this.ship.health !== prevHp) {
      this.updateHealthBarCanvas();
    }
  }

  steerTowards(targetHeading, delta) {
    let diff = targetHeading - this.ship.heading;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;

    // Turning Port (increasing heading) requires negative rudder
    // Turning Starboard (decreasing heading) requires positive rudder
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
