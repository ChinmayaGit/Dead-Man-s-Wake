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
    this.onIslandWarning = callbacks.onIslandWarning || null;
    this.playerDamageMultiplier = 1.0;
    this.enemyDamageMultiplier = 1.0;

    // Cooldown trackers to avoid multi-frame damage spam (key -> cooldown remaining)
    this.cooldowns = new Map();

    // Ram Strike Arming State: Ships must go back / disengage (dist >= 21m) before another hit can deal damage
    this.ramArmedPairs = new Map();
    this.islandRamArmed = new Map();
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
    const bowPos = ship.position.clone().addScaledVector(forward, 6.5);
    const sternPos = ship.position.clone().addScaledVector(forward, -6.5);

    this.archipelago.islands.forEach((isl, index) => {
      const toCenterX = ship.position.x - isl.pos.x;
      const toCenterZ = ship.position.z - isl.pos.y;
      const centerDist = Math.hypot(toCenterX, toCenterZ);

      const bowDist = Math.hypot(bowPos.x - isl.pos.x, bowPos.z - isl.pos.y);
      const sternDist = Math.hypot(sternPos.x - isl.pos.x, sternPos.z - isl.pos.y);

      // Visible golden sand beach shoreline radius
      const shoreRadius = isl.radius * 0.96;
      const islandKey = `island_${isPlayer ? 'player' : 'enemy'}_${index}`;

      // When ship backs away from the island into open water, re-arm crash damage!
      if (centerDist > shoreRadius + 14.0) {
        this.islandRamArmed.set(islandKey, true);
      }

      // Check exact hull penetration against visible sand
      const bowPen = shoreRadius - bowDist;
      const sternPen = shoreRadius - sternDist;
      const centerPen = (shoreRadius + 2.0) - centerDist;
      const maxPen = Math.max(bowPen, sternPen, centerPen);

      // Only repel when ship bow or hull physically touches the visible sand!
      if (maxPen > 0) {
        // Physical repulsion vector from island center towards ship
        const normDist = centerDist > 0.001 ? centerDist : 1.0;
        const normX = toCenterX / normDist;
        const normZ = toCenterZ / normDist;

        // Push ship out of the sand by exact penetration distance
        ship.position.x += normX * maxPen;
        ship.position.z += normZ * maxPen;

        // Vector pointing directly from ship towards island center
        const toIsland = new THREE.Vector3(-normX, 0, -normZ);
        const frontAlignment = forward.dot(toIsland); // 1.0 = direct head-on collision from front

        const shipSpeed = Math.max(0, ship.speed || 0);
        // Only trigger front-impact crash damage if armed and sailing with significant speed (>= 3.8 m/s)
        const isArmed = this.islandRamArmed.get(islandKey) !== false;
        const isFrontHit = isArmed && frontAlignment > 0.22 && shipSpeed >= 3.8;

        const cdKey = `island_${isPlayer ? 'player' : 'enemy'}_${index}`;

        if (isFrontHit && !this.isOnCooldown(cdKey)) {
          this.setCooldown(cdKey, 1.8);
          // Disarm island crash: ship must back away to open water before taking crash damage again!
          this.islandRamArmed.set(islandKey, false);

          // Front-impact damage proportional to sailing speed, strictly capped at 30% of target max health
          const shipMaxHealth = ship.maxHealth || 100;
          const maxIslandDmg = Math.round(shipMaxHealth * 0.30);
          const minIslandDmg = Math.max(1, Math.round(shipMaxHealth * 0.10));
          const excessSpeed = Math.max(0, shipSpeed - 3.8);
          const speedRatio = Math.min(1.0, (excessSpeed / 9.0) * Math.max(0.4, frontAlignment));
          const rawDamage = Math.round(minIslandDmg + (maxIslandDmg - minIslandDmg) * speedRatio);
          const damage = Math.min(maxIslandDmg, Math.max(minIslandDmg, rawDamage));

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

          // Elastic rebound: kick speed backwards and push hull into open water
          ship.speed = -Math.min(4.2, Math.max(2.8, shipSpeed * 0.5));
          ship.position.x += normX * 3.5;
          ship.position.z += normZ * 3.5;
          if (ship.sailState === 2) {
            ship.setSailState(1); // Knock sails from Full to Half on crash
          }

          if (isPlayer) {
            if (this.onCameraShake) this.onCameraShake(0.95, 0.45);
            if (this.onPlayerDamage) this.onPlayerDamage(damage);
            if (this.onIslandWarning) this.onIslandWarning(isl.name || 'Island', index);
          }
        } else {
          // Glancing side scrape or touching shore rocks: friction deceleration, 0 crash damage
          ship.speed = Math.max(0, shipSpeed * 0.85);
          if (isPlayer && shipSpeed > 2.0 && !this.isOnCooldown(`scrape_${index}`)) {
            this.setCooldown(`scrape_${index}`, 2.0);
            if (this.onIslandWarning) this.onIslandWarning(isl.name || 'Island', index, true);
          }
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
    const disengageDistance = 26.0; // Distance ship must go back / separate to re-arm ramming attack

    const pairKey = `ship_ram_${enemy.name || 'target'}`;

    // When ships back away / disengage beyond 26m, re-arm the ramming strike!
    if (dist >= disengageDistance) {
      this.ramArmedPairs.set(pairKey, true);
    }

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

      // Check if ram is armed (initial state is armed until a hit occurs)
      const isArmed = this.ramArmedPairs.get(pairKey) !== false;

      if (isArmed && playerFrontRam && !enemyFrontRam && playerSpeed >= 3.8 && !this.isOnCooldown(pairKey)) {
        // ========================================================
        // PLAYER RAMS ENEMY SHIP WITH BOW (Front Ramming Attack!)
        // ========================================================
        this.setCooldown(pairKey, 2.5);
        // Disarm ramming strike: Player MUST go back / disengage to dist >= 26m before ramming again!
        this.ramArmedPairs.set(pairKey, false);

        // Front hit damage strictly capped at 30% of target ship's max health (e.g. 500 HP -> max 150)
        const targetMaxHp = enemyShip.maxHealth || 100;
        const maxRamDmg = Math.round(targetMaxHp * 0.30);
        const minRamDmg = Math.max(1, Math.round(targetMaxHp * 0.12));
        const excessSpeed = Math.max(0, playerSpeed - 3.8);
        const speedRatio = Math.min(1.0, excessSpeed / 9.0);
        const rawDmg = Math.round((minRamDmg + (maxRamDmg - minRamDmg) * speedRatio) * (this.playerDamageMultiplier || 1.0));
        const enemyRamDmg = Math.min(maxRamDmg, Math.max(minRamDmg, rawDmg));
        // Attacker's reinforced prow absorbs impact: zero recoil damage to attacker
        const playerRecoilDmg = 0;

        enemyShip.takeDamage(enemyRamDmg);
        if (this.onEnemyDamage) {
          this.onEnemyDamage(enemyShip, enemyRamDmg, true);
        }
        if (this.combat && this.combat.spawnDamageNumber) {
          this.combat.spawnDamageNumber(contactPos, enemyRamDmg, 5);
        }

        // Decisive physical recoil bounce: push rammer backwards so ships begin separating
        playerShip.speed = -Math.min(5.0, Math.max(3.2, playerSpeed * 0.5));
        playerShip.position.x -= normX * 4.5;
        playerShip.position.z -= normZ * 4.5;
        enemyShip.speed = Math.max(0, enemySpeed * 0.2);
        if (playerShip.sailState === 2) {
          playerShip.setSailState(1); // Knock sails down on violent ram
        }

        // Spurt wood splinters, debris and water surge
        this.combat.spawnSplinterExplosion(contactPos);
        this.combat.spawnSplinterExplosion(contactPos.clone().add(new THREE.Vector3(0, 1.2, 0)));
        this.combat.spawnWaterSplash(contactPos);

        if (this.sound && this.sound.playRammingCrash) {
          this.sound.playRammingCrash();
        }

        if (this.onCameraShake) this.onCameraShake(1.2, 0.5);

      } else if (isArmed && playerFrontRam && enemyFrontRam && (playerSpeed >= 3.8 || enemySpeed >= 3.8) && !this.isOnCooldown(pairKey)) {
        // ========================================================
        // HEAD-ON COLLISION (Both Ships Ram Each Other Bow-to-Bow!)
        // ========================================================
        this.setCooldown(pairKey, 2.5);
        this.ramArmedPairs.set(pairKey, false);

        // Both ships take damage strictly capped at 30% of their respective max health
        const pMaxHp = playerShip.maxHealth || 100;
        const eMaxHp = enemyShip.maxHealth || 100;
        const pMaxDmg = Math.round(pMaxHp * 0.30);
        const pMinDmg = Math.max(1, Math.round(pMaxHp * 0.12));
        const eMaxDmg = Math.round(eMaxHp * 0.30);
        const eMinDmg = Math.max(1, Math.round(eMaxHp * 0.12));

        const sharedSpeed = Math.max(playerSpeed, enemySpeed);
        const excessSpeed = Math.max(0, sharedSpeed - 3.8);
        const speedRatio = Math.min(1.0, excessSpeed / 9.0);

        const rawPDmg = Math.round((pMinDmg + (pMaxDmg - pMinDmg) * speedRatio) * (this.enemyDamageMultiplier || 1.0));
        const rawEDmg = Math.round((eMinDmg + (eMaxDmg - eMinDmg) * speedRatio) * (this.playerDamageMultiplier || 1.0));

        const pDmg = Math.min(pMaxDmg, Math.max(pMinDmg, rawPDmg));
        const eDmg = Math.min(eMaxDmg, Math.max(eMinDmg, rawEDmg));

        playerShip.takeDamage(pDmg);
        enemyShip.takeDamage(eDmg);

        if (this.onEnemyDamage) {
          this.onEnemyDamage(enemyShip, eDmg, true);
        }
        if (this.onPlayerDamage) this.onPlayerDamage(pDmg);
        if (this.combat && this.combat.spawnDamageNumber) {
          this.combat.spawnDamageNumber(contactPos, eDmg, 5);
        }

        // Push both ships apart backwards
        playerShip.speed = -Math.min(4.5, Math.max(3.0, playerSpeed * 0.45));
        enemyShip.speed = -Math.min(4.5, Math.max(3.0, enemySpeed * 0.45));
        playerShip.position.x -= normX * 3.5;
        playerShip.position.z -= normZ * 3.5;
        enemyShip.position.x += normX * 3.5;
        enemyShip.position.z += normZ * 3.5;

        this.combat.spawnSplinterExplosion(contactPos);
        this.combat.spawnWaterSplash(contactPos);

        if (this.sound && this.sound.playRammingCrash) {
          this.sound.playRammingCrash();
        }
        if (this.onCameraShake) this.onCameraShake(1.3, 0.55);

      } else if (isArmed && !playerFrontRam && enemyFrontRam && enemySpeed >= 3.8 && !this.isOnCooldown(pairKey)) {
        // ========================================================
        // ENEMY RAMS PLAYER FROM FRONT
        // ========================================================
        this.setCooldown(pairKey, 2.5);
        this.ramArmedPairs.set(pairKey, false);

        // Front hit damage strictly capped at 30% of player's max health (e.g. 100 HP -> max 30)
        const pMaxHp = playerShip.maxHealth || 100;
        const pMaxDmg = Math.round(pMaxHp * 0.30);
        const pMinDmg = Math.max(1, Math.round(pMaxHp * 0.12));
        const excessSpeed = Math.max(0, enemySpeed - 3.8);
        const speedRatio = Math.min(1.0, excessSpeed / 9.0);
        const rawPlayerDamage = Math.round((pMinDmg + (pMaxDmg - pMinDmg) * speedRatio) * (this.enemyDamageMultiplier || 1.0));
        const playerDamage = Math.min(pMaxDmg, Math.max(pMinDmg, rawPlayerDamage));

        playerShip.takeDamage(playerDamage);
        enemyShip.speed = -Math.min(4.5, Math.max(3.0, enemySpeed * 0.45));
        enemyShip.position.x += normX * 4.5;
        enemyShip.position.z += normZ * 4.5;

        this.combat.spawnSplinterExplosion(contactPos);
        this.combat.spawnWaterSplash(contactPos);

        if (this.sound && this.sound.playRammingCrash) {
          this.sound.playRammingCrash();
        }

        if (this.onCameraShake) this.onCameraShake(1.1, 0.45);
        if (this.onPlayerDamage) this.onPlayerDamage(playerDamage);

      } else {
        // Continuous contact, slow bumps or grinding (< 3.8 m/s or disarmed before backing away): 0 damage!
        // Ships gently push apart and slide with smooth friction dampening without repeated hits
        playerShip.speed *= 0.85;
        enemyShip.speed *= 0.85;
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
