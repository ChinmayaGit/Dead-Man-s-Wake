import * as THREE from 'three';

export class CollisionSystem {
  constructor(scene, archipelago, soundController, combatSystem, callbacks = {}) {
    this.scene = scene;
    this.archipelago = archipelago;
    this.sound = soundController;
    this.combat = combatSystem;
    this.onCameraShake = callbacks.onCameraShake || null;
    this.onPlayerDamage = callbacks.onPlayerDamage || null;
    this.onEnemyDamage = callbacks.onEnemyDamage || null;
    this.playerDamageMultiplier = 1.0;
    this.enemyDamageMultiplier = 1.0;

    // Cooldown trackers to avoid multi-frame damage spam (key -> cooldown remaining)
    this.cooldowns = new Map();
  }

  setDifficultyMultipliers(playerMult = 1.0, enemyMult = 1.0) {
    this.playerDamageMultiplier = playerMult;
    this.enemyDamageMultiplier = enemyMult;
  }

  update(delta, playerShip, enemies, remoteShip = null) {
    // Tick down all cooldowns
    for (const [key, time] of this.cooldowns.entries()) {
      const nextTime = time - delta;
      if (nextTime <= 0) {
        this.cooldowns.delete(key);
      } else {
        this.cooldowns.set(key, nextTime);
      }
    }

    // 1. Check Player vs Islands
    if (!playerShip.isSinking) {
      this.checkShipIslandCollision(playerShip, true);
    }

    // 2. Check Enemies vs Islands
    for (const enemy of enemies) {
      if (!enemy.ship.isSinking) {
        this.checkShipIslandCollision(enemy.ship, false);
      }
    }

    // Check Remote Ship vs Islands in Multiplayer
    if (remoteShip && !remoteShip.isSinking) {
      this.checkShipIslandCollision(remoteShip, false);
    }

    // 3. Check Player vs Enemies (Ship-to-Ship & Front Ramming)
    if (!playerShip.isSinking) {
      for (const enemy of enemies) {
        if (!enemy.ship.isSinking) {
          this.checkShipToShipCollision(playerShip, enemy);
        }
      }

      // Check Player vs Remote Peer in Multiplayer (PvP Ramming Duel!)
      if (remoteShip && !remoteShip.isSinking) {
        this.checkShipToShipCollision(playerShip, { ship: remoteShip, name: 'Rival Captain' });
      }
    }

    // 4. Check Enemy vs Enemy separation (prevent overlapping)
    for (let i = 0; i < enemies.length; i++) {
      for (let j = i + 1; j < enemies.length; j++) {
        if (!enemies[i].ship.isSinking && !enemies[j].ship.isSinking) {
          this.checkEnemyEnemySeparation(enemies[i].ship, enemies[j].ship);
        }
      }
    }
  }

  isOnCooldown(key) {
    return this.cooldowns.has(key) && this.cooldowns.get(key) > 0;
  }

  setCooldown(key, duration) {
    this.cooldowns.set(key, duration);
  }

  // -------------------------------------------------------------
  // Island Collision
  // -------------------------------------------------------------
  checkShipIslandCollision(ship, isPlayer) {
    const forward = ship.getForwardVector();
    const bowPos = ship.position.clone().addScaledVector(forward, 7.5);
    const sternPos = ship.position.clone().addScaledVector(forward, -7.5);

    this.archipelago.islands.forEach((isl, index) => {
      const toCenterX = ship.position.x - isl.pos.x;
      const toCenterZ = ship.position.z - isl.pos.y;
      const centerDist = Math.hypot(toCenterX, toCenterZ);

      const bowDist = Math.hypot(bowPos.x - isl.pos.x, bowPos.z - isl.pos.y);
      const sternDist = Math.hypot(sternPos.x - isl.pos.x, sternPos.z - isl.pos.y);

      // Effective island shore buffer: island radius + ship collision boundary
      const shoreRadius = isl.radius + 3.5;
      const minCenterDist = shoreRadius + 5.0;

      // Check if bow, center, or stern penetrates shore
      if (centerDist < minCenterDist || bowDist < shoreRadius || sternDist < shoreRadius) {
        // Physical repulsion vector from island center towards ship
        const normDist = centerDist > 0.001 ? centerDist : 1.0;
        const normX = toCenterX / normDist;
        const normZ = toCenterZ / normDist;

        // Push ship out of the island landmass
        if (centerDist < minCenterDist) {
          const penetration = minCenterDist - centerDist;
          ship.position.x += normX * penetration;
          ship.position.z += normZ * penetration;
        }

        // Vector pointing directly from ship towards island center
        const toIsland = new THREE.Vector3(-normX, 0, -normZ);
        const frontAlignment = forward.dot(toIsland); // 1.0 = direct head-on collision from front

        const shipSpeed = Math.max(0, ship.speed || 0);
        const isFrontHit = frontAlignment > 0.20 && shipSpeed > 1.6;

        const cdKey = `island_${isPlayer ? 'player' : 'enemy'}_${index}`;

        if (isFrontHit && !this.isOnCooldown(cdKey)) {
          this.setCooldown(cdKey, 1.25);

          // Front-impact damage proportional to sailing speed and head-on alignment
          const speedFactor = Math.min(24.0, shipSpeed);
          const damage = Math.round(14 + speedFactor * 1.9 * Math.max(0.4, frontAlignment));

          ship.takeDamage(damage);

          // Spawn wood splinter explosion and splash at the ship's bow
          const impactY = ship.heave + 1.8;
          const impactPos = new THREE.Vector3(bowPos.x, impactY, bowPos.z);
          this.combat.spawnSplinterExplosion(impactPos);
          this.combat.spawnSplinterExplosion(impactPos.clone().add(new THREE.Vector3(0, 1.2, 0)));
          this.combat.spawnWaterSplash(impactPos);

          // Sound effects & visual impact
          if (this.sound && this.sound.playRammingCrash) {
            this.sound.playRammingCrash();
          }

          // Elastic rebound: kick speed backwards and drop sail state
          ship.speed = -Math.min(3.6, shipSpeed * 0.42);
          if (ship.sailState === 2) {
            ship.setSailState(1); // Knock sails from Full to Half on crash
          }

          if (isPlayer) {
            if (this.onCameraShake) this.onCameraShake(0.95, 0.45);
            if (this.onPlayerDamage) this.onPlayerDamage(damage);
          }
        } else {
          // Glancing side scrape against shore rocks: friction deceleration
          ship.speed = Math.max(0, shipSpeed * 0.88);
        }
      }
    });
  }

  // -------------------------------------------------------------
  // Ship-to-Ship Collision & Ramming Mechanics
  // -------------------------------------------------------------
  checkShipToShipCollision(playerShip, enemy) {
    const enemyShip = enemy.ship;
    const deltaX = enemyShip.position.x - playerShip.position.x;
    const deltaZ = enemyShip.position.z - playerShip.position.z;
    const dist = Math.hypot(deltaX, deltaZ);

    // Collision threshold: Ships are ~15m long, 5.5m wide; effective circle radius ~5.8m each
    const minSeparation = 11.8;

    if (dist < minSeparation) {
      // Overlap resolution: push both ships apart equally along collision axis
      const overlap = minSeparation - dist;
      const normDist = dist > 0.001 ? dist : 1.0;
      const normX = deltaX / normDist;
      const normZ = deltaZ / normDist;

      playerShip.position.x -= normX * overlap * 0.5;
      playerShip.position.z -= normZ * overlap * 0.5;
      enemyShip.position.x += normX * overlap * 0.5;
      enemyShip.position.z += normZ * overlap * 0.5;

      const cdKey = `ship_ram_${enemy.name}`;

      if (!this.isOnCooldown(cdKey)) {
        this.setCooldown(cdKey, 1.2);

        const playerForward = playerShip.getForwardVector();
        const enemyForward = enemyShip.getForwardVector();
        const toEnemyVec = new THREE.Vector3(normX, 0, normZ);
        const toPlayerVec = toEnemyVec.clone().negate();

        // Check if player is hitting enemy from front (Ramming prow impact)
        const playerFrontRam = playerForward.dot(toEnemyVec) > 0.38;
        // Check if enemy is hitting player from front
        const enemyFrontRam = enemyForward.dot(toPlayerVec) > 0.38;

        const playerSpeed = Math.max(0, playerShip.speed || 0);
        const enemySpeed = Math.max(0, enemyShip.speed || 0);

        // Contact midpoint in 3D world space
        const contactPos = playerShip.position.clone().add(enemyShip.position).multiplyScalar(0.5);
        contactPos.y = Math.max(playerShip.heave, enemyShip.heave) + 1.8;

        if (playerFrontRam && !enemyFrontRam && playerSpeed > 1.2) {
          // ========================================================
          // PLAYER RAMS ENEMY SHIP WITH BOW (Front Ramming Attack!)
          // ========================================================
          // Massive ramming strike dealt to enemy ship (28 to 55 damage!)
          const enemyRamDmg = Math.round((28 + playerSpeed * 2.2) * (this.playerDamageMultiplier || 1.0));
          // Attacker's reinforced prow absorbs impact: zero recoil damage to attacker
          const playerRecoilDmg = 0;

          enemyShip.takeDamage(enemyRamDmg);
          if (this.onEnemyDamage) {
            this.onEnemyDamage(enemyShip, enemyRamDmg, true);
          }
          if (this.combat && this.combat.spawnDamageNumber) {
            this.combat.spawnDamageNumber(contactPos, enemyRamDmg, 5);
          }

          // Impact physics: rebound player slightly and disrupt enemy velocity
          playerShip.speed = -Math.min(2.5, playerSpeed * 0.25);
          enemyShip.speed = Math.max(0, enemySpeed * 0.3);

          // Spurt wood splinters, debris and water surge
          this.combat.spawnSplinterExplosion(contactPos);
          this.combat.spawnSplinterExplosion(contactPos.clone().add(new THREE.Vector3(0, 1.2, 0)));
          this.combat.spawnWaterSplash(contactPos);

          if (this.sound && this.sound.playRammingCrash) {
            this.sound.playRammingCrash();
          }

          if (this.onCameraShake) this.onCameraShake(1.2, 0.5);

        } else if (playerFrontRam && enemyFrontRam && (playerSpeed > 1.2 || enemySpeed > 1.2)) {
          // ========================================================
          // HEAD-ON COLLISION (Both Ships Ram Each Other Bow-to-Bow!)
          // ========================================================
          const sharedSpeed = Math.max(playerSpeed, enemySpeed);
          const pDmg = Math.round((18 + sharedSpeed * 1.6) * (this.enemyDamageMultiplier || 1.0));
          const eDmg = Math.round((18 + sharedSpeed * 1.6) * (this.playerDamageMultiplier || 1.0));

          playerShip.takeDamage(pDmg);
          enemyShip.takeDamage(eDmg);

          if (this.onEnemyDamage) {
            this.onEnemyDamage(enemyShip, eDmg, true);
          }
          if (this.onPlayerDamage) this.onPlayerDamage(pDmg);
          if (this.combat && this.combat.spawnDamageNumber) {
            this.combat.spawnDamageNumber(contactPos, eDmg, 5);
          }

          playerShip.speed = -Math.min(2.8, playerSpeed * 0.3);
          enemyShip.speed = -Math.min(2.8, enemySpeed * 0.3);

          this.combat.spawnSplinterExplosion(contactPos);
          this.combat.spawnWaterSplash(contactPos);

          if (this.sound && this.sound.playRammingCrash) {
            this.sound.playRammingCrash();
          }
          if (this.onCameraShake) this.onCameraShake(1.3, 0.6);

        } else if (!playerFrontRam && enemyFrontRam && enemySpeed > 1.4) {
          // ========================================================
          // ENEMY RAMS PLAYER FROM FRONT
          // ========================================================
          const playerDamage = Math.round((22 + enemySpeed * 1.8) * (this.enemyDamageMultiplier || 1.0));

          playerShip.takeDamage(playerDamage);
          // Note: Defending ship takes damage; never send damage back to the attacker over network

          enemyShip.speed = -Math.min(2.5, enemySpeed * 0.3);

          this.combat.spawnSplinterExplosion(contactPos);
          this.combat.spawnWaterSplash(contactPos);

          if (this.sound && this.sound.playRammingCrash) {
            this.sound.playRammingCrash();
          }

          if (this.onCameraShake) this.onCameraShake(1.1, 0.5);
          if (this.onPlayerDamage) this.onPlayerDamage(playerDamage);

        } else {
          // ========================================================
          // SIDESWIPE / MUTUAL SHIP COLLISION
          // ========================================================
          const relSpeed = Math.max(playerSpeed, enemySpeed);
          if (relSpeed > 1.4) {
            if (playerSpeed >= enemySpeed) {
              // Player was faster and sideswiped enemy: deal damage to enemy, 0 damage to player
              const sideEnemyDmg = Math.round((10 + playerSpeed * 1.4) * (this.playerDamageMultiplier || 1.0));
              enemyShip.takeDamage(sideEnemyDmg);

              if (this.onEnemyDamage) {
                this.onEnemyDamage(enemyShip, sideEnemyDmg, false);
              }
              if (this.combat && this.combat.spawnDamageNumber) {
                this.combat.spawnDamageNumber(contactPos, sideEnemyDmg, 5);
              }
            } else {
              // Enemy was faster and sideswiped player
              const sidePlayerDmg = Math.round((8 + enemySpeed * 1.0) * (this.enemyDamageMultiplier || 1.0));
              playerShip.takeDamage(sidePlayerDmg);
              if (this.onPlayerDamage) this.onPlayerDamage(sidePlayerDmg);
            }

            this.combat.spawnSplinterExplosion(contactPos);
            this.combat.spawnWaterSplash(contactPos);

            if (this.sound && this.sound.playHullImpact) {
              this.sound.playHullImpact();
            }

            if (this.onCameraShake) this.onCameraShake(0.65, 0.35);
          }

          playerShip.speed *= 0.82;
          enemyShip.speed *= 0.82;
        }
      }
    }
  }

  // -------------------------------------------------------------
  // Enemy-to-Enemy Separation (avoid clipping together)
  // -------------------------------------------------------------
  checkEnemyEnemySeparation(shipA, shipB) {
    const deltaX = shipB.position.x - shipA.position.x;
    const deltaZ = shipB.position.z - shipA.position.z;
    const dist = Math.hypot(deltaX, deltaZ);
    const minSeparation = 11.5;

    if (dist < minSeparation) {
      const overlap = minSeparation - dist;
      const normDist = dist > 0.001 ? dist : 1.0;
      const normX = deltaX / normDist;
      const normZ = deltaZ / normDist;

      shipA.position.x -= normX * overlap * 0.5;
      shipA.position.z -= normZ * overlap * 0.5;
      shipB.position.x += normX * overlap * 0.5;
      shipB.position.z += normZ * overlap * 0.5;

      shipA.speed *= 0.85;
      shipB.speed *= 0.85;
    }
  }
}
