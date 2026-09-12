import * as THREE from 'three';
import { Ship } from './ship.js';

export class EnemyShip {
  constructor(scene, ocean, combatSystem, initialPos, name = 'HMS Defiance', maxHealth = 200, shipClass = 'Frigate', modelName = 'ship-large.glb') {
    this.scene = scene;
    this.ocean = ocean;
    this.combat = combatSystem;
    this.name = name;
    this.shipClass = shipClass;

    // Load Royal Navy Frigate 3D GLB model with authentic naval warship health pool
    this.ship = new Ship(scene, ocean, false, modelName, maxHealth);
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

    // 3D Threat Diamond & Health Bar Billboard Sprite floating above the mast
    this.threatSprite = this.createThreatDiamondSprite();
    this.scene.add(this.threatSprite);
  }

  createThreatDiamondSprite() {
    const canvas = document.createElement('canvas');
    canvas.width = 280;
    canvas.height = 96;
    this.diamondCanvas = canvas;
    this.diamondCtx = canvas.getContext('2d');
    this.lastRenderedState = { mode: null, hp: -1, maxHp: -1 };
    this.renderOverheadCanvas(false, false);

    const texture = new THREE.CanvasTexture(canvas);
    this.diamondTexture = texture;
    const mat = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true
    });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 999;
    sprite.scale.set(10.5, 3.6, 1);
    return sprite;
  }

  renderOverheadCanvas(alerted, standoff) {
    const mode = alerted ? 'alerted' : (standoff ? 'standoff' : 'patrol');
    const curHp = Math.max(0, Math.round(this.ship.health));
    const maxHp = this.ship.maxHealth || 200;

    if (this.lastRenderedState &&
        this.lastRenderedState.mode === mode &&
        this.lastRenderedState.hp === curHp &&
        this.lastRenderedState.maxHp === maxHp) {
      return;
    }
    this.lastRenderedState = { mode, hp: curHp, maxHp };

    const ctx = this.diamondCtx;
    if (!ctx) return;

    ctx.clearRect(0, 0, 280, 96);

    // Pill background
    ctx.fillStyle = 'rgba(14, 10, 8, 0.90)';
    ctx.beginPath();
    ctx.roundRect(8, 6, 264, 84, 10);
    ctx.fill();

    // Border
    let borderColor = '#d4af37'; // gold
    if (alerted) borderColor = '#ff1744';
    else if (standoff) borderColor = '#ffa726';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Threat diamond icon on left
    const cx = 30;
    const cy = 30;
    const size = 11;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx + size * 0.75, cy);
    ctx.lineTo(cx, cy + size);
    ctx.lineTo(cx - size * 0.75, cy);
    ctx.closePath();
    ctx.fillStyle = alerted ? '#ff1744' : (standoff ? '#ffa726' : '#ffd54f');
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // Ship Name & Class
    ctx.font = 'bold 15px Georgia, serif';
    ctx.fillStyle = alerted ? '#ffcdd2' : '#fffde7';
    ctx.textAlign = 'left';
    const title = `${this.name} (${this.shipClass || 'Frigate'})`;
    ctx.fillText(title, 48, 34);

    // HP Bar background
    const barX = 18;
    const barY = 50;
    const barW = 244;
    const barH = 16;
    ctx.fillStyle = '#2b1713';
    ctx.fillRect(barX, barY, barW, barH);

    // HP Bar fill
    const pct = Math.max(0, Math.min(1.0, curHp / maxHp));
    ctx.fillStyle = pct > 0.45 ? '#4caf50' : (pct > 0.2 ? '#ff9800' : '#f44336');
    ctx.fillRect(barX, barY, barW * pct, barH);

    // HP Bar border
    ctx.strokeStyle = '#a68449';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(barX, barY, barW, barH);

    // HP Bar text
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(`${curHp} / ${maxHp} HP`, barX + barW * 0.5, barY + 12.5);

    if (this.diamondTexture) {
      this.diamondTexture.needsUpdate = true;
    }
  }

  // Alias for backward compatibility
  renderDiamondCanvas(alerted, standoff) {
    this.renderOverheadCanvas(alerted, standoff);
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

      // Pulsing scale animation when alerted (maintaining 280:96 aspect ratio)
      if (this.isAlerted) {
        const pulseMult = 1.0 + Math.sin(performance.now() * 0.008) * 0.12;
        this.threatSprite.scale.set(10.5 * pulseMult, 3.6 * pulseMult, 1);
      } else {
        this.threatSprite.scale.set(10.5, 3.6, 1);
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
