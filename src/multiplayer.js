import * as THREE from 'three';
import { Peer } from 'peerjs';
import { Ship } from './ship.js';

export class MultiplayerManager {
  constructor(game) {
    this.game = game;
    this.peer = null;
    this.conn = null;
    this.role = null; // 'host' or 'client'
    this.roomCode = '';
    this.isConnected = false;
    this.remoteShip = null;
    this.remoteNameTag = null;
    this.remoteTargetPos = new THREE.Vector3();
    this.sendInterval = null;
    this.callbacks = {
      onStatus: null,
      onConnect: null,
      onDisconnect: null
    };
  }

  generateRoomCode() {
    // 5-character alphanumeric room code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  getPeerConfig() {
    return {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    };
  }

  hostGame(onCodeGenerated) {
    this.disconnect();
    this.role = 'host';
    if (this.game && this.game.hideAllBotEnemies) {
      this.game.hideAllBotEnemies();
    }
    const rawCode = this.generateRoomCode();
    this.roomCode = rawCode;
    const peerId = `dmw-${rawCode.toLowerCase()}`;

    if (this.callbacks.onStatus) {
      this.callbacks.onStatus('Connecting to peer server...', 'info');
    }

    try {
      this.peer = new Peer(peerId, this.getPeerConfig());
    } catch (err) {
      console.warn('Custom peer ID failed, falling back to auto ID:', err);
      this.peer = new Peer(this.getPeerConfig());
    }

    this.peer.on('open', (id) => {
      console.log('⚓ [P2P Host] Registered with ID:', id);
      if (onCodeGenerated) onCodeGenerated(this.roomCode);
      if (this.callbacks.onStatus) {
        this.callbacks.onStatus(`Room Code: ${this.roomCode}. Waiting for crewmate to join...`, 'waiting');
      }
    });

    this.peer.on('connection', (conn) => {
      console.log('⚓ [P2P Host] Incoming peer connection from:', conn.peer);
      this.conn = conn;
      this.setupConnection();
    });

    this.peer.on('error', (err) => {
      console.error('❌ [P2P Host] Error:', err);
      if (this.callbacks.onStatus) {
        this.callbacks.onStatus(`Connection error: ${err.message || err.type}`, 'error');
      }
    });
  }

  joinGame(code) {
    this.disconnect();
    this.role = 'client';
    if (this.game && this.game.hideAllBotEnemies) {
      this.game.hideAllBotEnemies();
    }
    const cleanCode = code.trim().toUpperCase();
    this.roomCode = cleanCode;
    const targetPeerId = `dmw-${cleanCode.toLowerCase()}`;

    if (this.callbacks.onStatus) {
      this.callbacks.onStatus(`Searching for fleet ${cleanCode}...`, 'info');
    }

    this.peer = new Peer(this.getPeerConfig());

    this.peer.on('open', (id) => {
      console.log('⚓ [P2P Client] Connected to signaling with ID:', id, 'Connecting to:', targetPeerId);
      const conn = this.peer.connect(targetPeerId, { reliable: true });
      this.conn = conn;
      this.setupConnection();
    });

    this.peer.on('error', (err) => {
      console.error('❌ [P2P Client] Error:', err);
      if (this.callbacks.onStatus) {
        this.callbacks.onStatus(`Failed to join ${cleanCode}: ${err.type || 'Room not found'}`, 'error');
      }
    });
  }

  setupConnection() {
    if (!this.conn) return;

    this.conn.on('open', () => {
      console.log('🎉 [P2P] WebRTC DataChannel open!');
      this.isConnected = true;

      // Spawn remote ship
      this.spawnRemoteShip();

      // Handshake: exchange info & sync difficulty
      const handshake = {
        type: 'handshake',
        role: this.role,
        roomCode: this.roomCode,
        difficulty: this.game.difficulty || 'medium',
        timestamp: Date.now()
      };
      this.send(handshake);

      // Start 20Hz state synchronization
      this.startStateSync();

      if (this.callbacks.onConnect) {
        this.callbacks.onConnect(this.role, this.roomCode);
      }
      if (this.callbacks.onStatus) {
        this.callbacks.onStatus('Connected! Setting sail together! ⚔️', 'success');
      }
    });

    this.conn.on('data', (data) => {
      this.handleIncomingMessage(data);
    });

    this.conn.on('close', () => {
      console.log('⚓ [P2P] Connection closed');
      this.handlePeerDisconnected();
    });

    this.conn.on('error', (err) => {
      console.error('❌ [P2P] Connection error:', err);
      this.handlePeerDisconnected();
    });
  }

  send(data) {
    if (this.conn && this.conn.open) {
      try {
        this.conn.send(data);
      } catch (e) {
        console.warn('Failed to send P2P packet:', e);
      }
    }
  }

  sendShipState() {
    if (!this.isConnected || !this.game || !this.game.playerShip) return;

    const p = this.game.playerShip;
    const statePacket = {
      type: 'state',
      x: Number(p.position.x.toFixed(2)),
      y: Number(p.position.y.toFixed(2)),
      z: Number(p.position.z.toFixed(2)),
      rotY: Number(p.heading.toFixed(3)),
      roll: Number(p.roll.toFixed(3)),
      pitch: Number(p.pitch.toFixed(3)),
      heave: Number(p.heave.toFixed(3)),
      speed: Number(p.speed.toFixed(2)),
      rudder: Number(p.rudder.toFixed(2)),
      sailState: p.sailState,
      health: p.health,
      maxHealth: p.maxHealth,
      sinking: p.isSinking
    };
    this.send(statePacket);
  }

  startStateSync() {
    if (this.sendInterval) clearInterval(this.sendInterval);
    // 20Hz sync (every 50ms)
    this.sendInterval = setInterval(() => {
      this.sendShipState();
    }, 50);
  }

  handleIncomingMessage(data) {
    if (!data || !data.type) return;

    if (data.type === 'handshake') {
      console.log('🤝 [P2P Handshake received]:', data);
      if (data.difficulty) {
        this.game.setDifficulty(data.difficulty, false);
      }
    } else if (data.type === 'state') {
      if (!this.remoteShip) {
        this.spawnRemoteShip();
      }
      this.updateRemoteShipState(data);
    } else if (data.type === 'fire') {
      // Remote player fired broadside cannons
      this.handleRemoteFire(data);
    } else if (data.type === 'hit') {
      // Direct cannon or ramming hit notice
      if (this.game && this.game.playerShip) {
        this.game.playerShip.takeDamage(data.damage || 15);
        this.game.triggerCameraShake(data.isRam ? 1.25 : 0.8, 0.45);
        this.game.triggerDamageFeedback(data.damage || 15);
        if (this.game.sound) {
          if (data.isRam && this.game.sound.playRammingCrash) {
            this.game.sound.playRammingCrash();
          } else if (this.game.sound.playHullImpact) {
            this.game.sound.playHullImpact();
          }
        }
      }
    } else if (data.type === 'emote') {
      this.showEmoteBanner(data.icon, data.text);
    } else if (data.type === 'start_pvp_battle') {
      console.log('⚔️ [P2P] Peer requested start PvP battle');
      if (this.game) {
        this.game.startMultiplayerBattle(false);
      }
    } else if (data.type === 'pvp_defeat_notify') {
      console.log('🏆 [P2P] Peer reported defeat -> Local Victory!');
      if (this.remoteShip) {
        this.remoteShip.health = 0;
        this.remoteShip.isSinking = true;
      }
      if (this.game) {
        this.game.handlePvPBattleEnd('victory');
      }
    } else if (data.type === 'pvp_victory_notify') {
      console.log('☠️ [P2P] Peer reported victory -> Local Defeat!');
      if (this.game && this.game.playerShip) {
        this.game.playerShip.health = 0;
        this.game.playerShip.isSinking = true;
      }
      if (this.game) {
        this.game.handlePvPBattleEnd('defeat');
      }
    } else if (data.type === 'pvp_rematch_request') {
      console.log('⚔️ [P2P] Peer requested Rematch');
      if (this.game) {
        this.game.handleRematchRequestedByPeer();
      }
    } else if (data.type === 'pvp_rematch_start') {
      console.log('⚔️ [P2P] Peer confirmed Rematch Start');
      if (this.game) {
        this.game.restartPvPBattle(false);
      }
    }
  }

  spawnRemoteShip() {
    if (this.remoteShip) return;
    if (this.game && this.game.hideAllBotEnemies) {
      this.game.hideAllBotEnemies();
    }
    console.log('⛵ [P2P] Spawning Remote Rival Player Ship into duel arena...');
    // Remote ship uses 'ship-pirate-large.glb' with 100 HP for fair flagship duel
    this.remoteShip = new Ship(this.game.scene, this.game.ocean, false, 'ship-pirate-large.glb', 100);
    this.remoteShip.isRemotePlayer = true;
    this.remoteShip.name = (this.role === 'host') ? 'Challenger (P2P)' : 'Host Fleet (P2P)';

    // Initial duel arena placement:
    // Host starts at (0, 0, -45) facing South; Client at (0, 0, 45) facing North
    const spawnZ = (this.role === 'host') ? 45 : -45;
    const spawnHeading = (this.role === 'host') ? Math.PI : 0;
    this.remoteShip.position.set(0, 0, spawnZ);
    this.remoteShip.heading = spawnHeading;
    this.remoteTargetPos.copy(this.remoteShip.position);

    // Create 3D Nameplate & Health Bar above remote ship
    this.createNameTag();

    // Register with Game instance
    this.game.remoteShip = this.remoteShip;
  }

  createNameTag() {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 90;
    const ctx = canvas.getContext('2d');

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(10, 3, 1);
    sprite.position.set(0, 12, 0);

    this.remoteShip.group.add(sprite);
    this.remoteNameTag = { sprite, texture, canvas, ctx };
    this.updateNameTag(100, 100);
  }

  updateNameTag(hp, maxHp) {
    if (!this.remoteNameTag) return;
    const { canvas, ctx, texture } = this.remoteNameTag;
    ctx.clearRect(0, 0, 300, 90);

    // Background pill
    ctx.fillStyle = 'rgba(18, 12, 8, 0.88)';
    ctx.beginPath();
    ctx.roundRect(10, 8, 280, 74, 12);
    ctx.fill();

    // Border
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Name text
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#ffeb3b';
    ctx.textAlign = 'center';
    const displayName = (this.role === 'host') ? '⚔️ Challenger (P2P)' : '👑 Fleet Host (P2P)';
    ctx.fillText(displayName, 150, 36);

    // HP Bar background
    const pct = Math.max(0, Math.min(1, hp / maxHp));
    ctx.fillStyle = '#3e2723';
    ctx.fillRect(30, 48, 240, 16);

    // HP Bar fill
    ctx.fillStyle = pct > 0.45 ? '#4caf50' : (pct > 0.2 ? '#ff9800' : '#f44336');
    ctx.fillRect(30, 48, 240 * pct, 16);

    ctx.strokeStyle = '#a68449';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(30, 48, 240, 16);

    texture.needsUpdate = true;
  }

  updateRemoteShipState(data) {
    if (!this.remoteShip) return;

    this.remoteTargetPos.set(data.x, data.y, data.z);
    this.remoteShip.heading = data.rotY;
    this.remoteShip.roll = data.roll;
    this.remoteShip.pitch = data.pitch;
    this.remoteShip.heave = data.heave;
    this.remoteShip.speed = data.speed;
    this.remoteShip.rudder = data.rudder;

    if (data.sailState !== this.remoteShip.sailState) {
      this.remoteShip.setSailState(data.sailState);
    }

    if (data.health !== this.remoteShip.health) {
      this.remoteShip.health = data.health;
      this.updateNameTag(data.health, data.maxHealth || 120);
    }

    if (data.sinking && !this.remoteShip.isSinking) {
      this.remoteShip.takeDamage(9999);
    }
  }

  update(delta) {
    if (!this.remoteShip || this.remoteShip.isSinking) return;

    // Smooth position interpolation
    this.remoteShip.position.lerp(this.remoteTargetPos, Math.min(delta * 12, 0.45));
    this.remoteShip.updateGroupTransform();

    // Ocean waves buoyancy
    if (this.game.ocean) {
      const waveY = this.game.ocean.getWaveHeight(this.remoteShip.position.x, this.remoteShip.position.z);
      this.remoteShip.group.position.y = waveY + this.remoteShip.heave;
    }
  }

  notifyBroadsideFired(side, charge) {
    if (!this.isConnected) return;
    this.send({
      type: 'fire',
      side,
      charge
    });
  }

  notifyCannonHit(damage, isRam = false) {
    if (!this.isConnected) return;
    this.send({
      type: 'hit',
      damage,
      isRam
    });
  }

  sendEmote(icon, text) {
    if (!this.isConnected) return;
    this.send({
      type: 'emote',
      icon,
      text
    });
    this.showEmoteBanner(icon, `You: ${text}`);
  }

  showEmoteBanner(icon, text) {
    let banner = document.getElementById('p2p-emote-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'p2p-emote-banner';
      banner.style = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:rgba(20,12,8,0.92);border:2px solid #ffcc00;color:#fff;padding:10px 24px;border-radius:24px;font-size:16px;font-weight:bold;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.8);pointer-events:none;transition:opacity 0.4s ease;opacity:0;';
      document.body.appendChild(banner);
    }
    banner.innerHTML = `<span style="font-size:22px;margin-right:8px;">${icon}</span> ${text}`;
    banner.style.opacity = '1';
    clearTimeout(this._emoteTimer);
    this._emoteTimer = setTimeout(() => {
      banner.style.opacity = '0';
    }, 3200);
  }

  handleRemoteFire(data) {
    if (!this.remoteShip || !this.game || !this.game.combat) return;
    const side = data.side || 'port';
    const charge = data.charge || 0;
    console.log(`💥 [P2P] Remote ship firing ${side} broadside (charge ${charge})`);
    const targets = [this.game.playerShip, ...this.game.enemies.map(e => e.ship)];
    this.game.combat.fireBroadside(this.remoteShip, targets, side, charge, true);
  }

  handlePeerDisconnected() {
    this.isConnected = false;
    if (this.sendInterval) clearInterval(this.sendInterval);
    if (this.remoteShip) {
      this.game.scene.remove(this.remoteShip.group);
      this.remoteShip = null;
      this.game.remoteShip = null;
    }
    if (this.callbacks.onDisconnect) {
      this.callbacks.onDisconnect();
    }
    if (this.callbacks.onStatus) {
      this.callbacks.onStatus('Peer disconnected from fleet.', 'info');
    }
  }

  disconnect() {
    this.isConnected = false;
    if (this.sendInterval) {
      clearInterval(this.sendInterval);
      this.sendInterval = null;
    }
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    if (this.remoteShip) {
      this.game.scene.remove(this.remoteShip.group);
      this.remoteShip = null;
      this.game.remoteShip = null;
    }
  }
}
