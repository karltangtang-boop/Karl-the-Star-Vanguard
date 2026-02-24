/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Trophy, 
  Shield, 
  Zap, 
  Gamepad2, 
  Info,
  Heart,
  Star,
  Skull,
  Target,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Constants & Types ---

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

type GameState = 'START' | 'PLAYING' | 'PAUSED' | 'GAMEOVER' | 'UPGRADE' | 'GUARDIAN_RESULT';

interface Achievement {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
  type?: 'SPARK' | 'SHOCKWAVE' | 'BOSS_EXPLOSION';
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  power: number;
  isEnemy?: boolean;
}

interface Enemy {
  id: number;
  x: number;
  y: number;
  type: 'BASIC' | 'FAST' | 'HEAVY' | 'ELITE' | 'BOSS';
  hp: number;
  maxHp: number;
  speed: number;
  score: number;
  width: number;
  height: number;
  lastShot?: number;
  phase?: number;
  moveDir?: number;
}

interface PowerUp {
  x: number;
  y: number;
  type: 'TRIPLE_SHOT' | 'SHIELD' | 'COIN';
  width: number;
  height: number;
  value?: number;
}

interface Upgrades {
  maxLives: number;
  tripleShotLevel: number; // 0: none, 1: temporary, 2: permanent
  fireRate: number;
  moveSpeed: number;
  bulletPower: number;
  armorStrength: number; // hits to lose life
}

// --- Audio System (Synthesized) ---
const playSound = (type: 'shoot' | 'explosion' | 'coin' | 'powerup' | 'hit') => {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;

  switch (type) {
    case 'shoot':
      osc.type = 'square';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
      break;
    case 'explosion':
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(100, now);
      osc.frequency.exponentialRampToValueAtTime(10, now + 0.3);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
      break;
    case 'coin':
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1000, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
      break;
    case 'powerup':
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.linearRampToValueAtTime(800, now + 0.2);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
      break;
    case 'hit':
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.linearRampToValueAtTime(50, now + 0.2);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
      break;
  }
};

// --- Helper Functions ---

const randomRange = (min: number, max: number) => Math.random() * (max - min) + min;

// --- Main Component ---

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Persistent State
  const [totalCoins, setTotalCoins] = useState(() => {
    const saved = localStorage.getItem('tina_coins');
    return saved ? parseInt(saved) : 0;
  });
  const [upgrades, setUpgrades] = useState<Upgrades>(() => {
    const saved = localStorage.getItem('karl_upgrades');
    return saved ? JSON.parse(saved) : {
      maxLives: 3,
      tripleShotLevel: 0,
      fireRate: 200,
      moveSpeed: 6,
      bulletPower: 1,
      armorStrength: 5
    };
  });

  // Game Session State
  const [gameState, setGameState] = useState<GameState>('START');
  const [isGuardianMode, setIsGuardianMode] = useState(false);
  const [escapedEnemies, setEscapedEnemies] = useState(0);
  const [score, setScore] = useState(0);
  const [sessionCoins, setSessionCoins] = useState(0);
  const [lives, setLives] = useState(3);
  const [playerHits, setPlayerHits] = useState(0);
  const [level, setLevel] = useState(1);
  const [achievements, setAchievements] = useState<Achievement[]>([
    { id: 'first_blood', title: '第一滴血', description: '击落第一架敌机', unlocked: false },
    { id: 'survivor', title: '生存者', description: '在单局游戏中生存超过60秒', unlocked: false },
    { id: 'ace_pilot', title: '王牌飞行员', description: '击落50架敌机', unlocked: false },
    { id: 'shield_master', title: '护盾大师', description: '拾取3次能量护盾', unlocked: false },
    { id: 'power_hungry', title: '火力全开', description: '拾取3次三向子弹', unlocked: false },
    { id: 'rich_man', title: '大富翁', description: '累计获得1000金币', unlocked: false },
    { id: 'untouchable', title: '不可触碰', description: '到达第5关且未失一血', unlocked: false },
    { id: 'boss_slayer', title: '巨兽猎人', description: '击败第一个BOSS', unlocked: false },
    { id: 'guardian_hero', title: '守护英雄', description: '在守护者模式中坚持超过3分钟', unlocked: false },
  ]);
  const [unlockedAchievement, setUnlockedAchievement] = useState<Achievement | null>(null);
  
  // Game Refs for Engine
  const engineRef = useRef({
    player: {
      x: CANVAS_WIDTH / 2,
      y: CANVAS_HEIGHT - 80,
      width: 40,
      height: 40,
      speed: 6,
      invulnerable: 0,
      shield: false,
      tripleShot: 0,
    },
    bullets: [] as Bullet[],
    enemyBullets: [] as Bullet[],
    enemies: [] as Enemy[],
    powerUps: [] as PowerUp[],
    particles: [] as Particle[],
    stars: [] as { x: number, y: number, size: number, speed: number }[],
    keys: {} as Record<string, boolean>,
    lastShot: 0,
    enemySpawnTimer: 0,
    powerUpSpawnTimer: 0,
    frameCount: 0,
    startTime: 0,
    enemiesKilled: 0,
    shieldsPicked: 0,
    tripleShotsPicked: 0,
    levelUpPending: false,
    warningTimer: 0,
    lostLifeThisRun: false,
    bossActive: false,
  });

  // Save persistent data
  useEffect(() => {
    localStorage.setItem('karl_coins', totalCoins.toString());
    localStorage.setItem('karl_upgrades', JSON.stringify(upgrades));
  }, [totalCoins, upgrades]);

  // --- Initialization ---

  useEffect(() => {
    // Initialize stars
    const stars = [];
    for (let i = 0; i < 100; i++) {
      stars.push({
        x: Math.random() * CANVAS_WIDTH,
        y: Math.random() * CANVAS_HEIGHT,
        size: Math.random() * 2,
        speed: randomRange(0.5, 2)
      });
    }
    engineRef.current.stars = stars;

    const handleKeyDown = (e: KeyboardEvent) => {
      engineRef.current.keys[e.code] = true;
      if (e.code === 'KeyP') {
        togglePause();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      engineRef.current.keys[e.code] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // --- Assets Loading ---
  const imagesRef = useRef<{ [key: string]: HTMLImageElement }>({});
  const [assetsLoaded, setAssetsLoaded] = useState(false);

  useEffect(() => {
    const assetList = {
      player: '/player.png',
      enemy_basic: '/enemy_basic.png',
      enemy_fast: '/enemy_fast.png',
      enemy_heavy: '/enemy_heavy.png',
      powerup_shield: '/powerup_shield.png',
      powerup_bolt: '/powerup_bolt.png',
    };

    let loadedCount = 0;
    const totalAssets = Object.keys(assetList).length;

    Object.entries(assetList).forEach(([key, src]) => {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        imagesRef.current[key] = img;
        loadedCount++;
        if (loadedCount === totalAssets) {
          setAssetsLoaded(true);
        }
      };
      img.onerror = () => {
        // If image fails to load, we'll still continue (fallback to vector drawing)
        console.warn(`Failed to load asset: ${src}`);
        loadedCount++;
        if (loadedCount === totalAssets) {
          setAssetsLoaded(true);
        }
      };
    });
  }, []);

  // --- Game Logic ---

  const startGame = (guardian = false) => {
    if (guardian) {
      if (totalCoins < 450) return;
      setTotalCoins(c => c - 450);
      setIsGuardianMode(true);
      setEscapedEnemies(0);
    } else {
      setIsGuardianMode(false);
    }

    setGameState('PLAYING');
    setScore(0);
    setSessionCoins(0);
    setLives(guardian ? 999999 : upgrades.maxLives);
    setPlayerHits(0);
    setLevel(1);
    engineRef.current.player = {
      x: CANVAS_WIDTH / 2,
      y: CANVAS_HEIGHT - 80,
      width: 40,
      height: 40,
      speed: upgrades.moveSpeed,
      invulnerable: 0,
      shield: false,
      tripleShot: upgrades.tripleShotLevel === 2 ? 999999 : 0,
    };
    engineRef.current.bullets = [];
    engineRef.current.enemyBullets = [];
    engineRef.current.enemies = [];
    engineRef.current.powerUps = [];
    engineRef.current.particles = [];
    engineRef.current.enemiesKilled = 0;
    engineRef.current.shieldsPicked = 0;
    engineRef.current.tripleShotsPicked = 0;
    engineRef.current.startTime = Date.now();
    engineRef.current.frameCount = 0;
    engineRef.current.lostLifeThisRun = false;
    engineRef.current.bossActive = false;
  };

  const togglePause = () => {
    setGameState(prev => {
      if (prev === 'PLAYING') return 'PAUSED';
      if (prev === 'PAUSED') return 'PLAYING';
      return prev;
    });
  };

  const unlockAchievement = useCallback((id: string) => {
    setAchievements(prev => {
      const index = prev.findIndex(a => a.id === id);
      if (index !== -1 && !prev[index].unlocked) {
        const newAchievements = [...prev];
        newAchievements[index] = { ...newAchievements[index], unlocked: true };
        setUnlockedAchievement(newAchievements[index]);
        setTimeout(() => setUnlockedAchievement(null), 3000);
        return newAchievements;
      }
      return prev;
    });
  }, []);

  const createExplosion = (x: number, y: number, color: string, count = 15, type: Particle['type'] = 'SPARK') => {
    if (type === 'SHOCKWAVE') {
      engineRef.current.particles.push({
        x, y, vx: 0, vy: 0, life: 1.0, color, size: 10, type: 'SHOCKWAVE'
      });
    } else if (type === 'BOSS_EXPLOSION') {
      for (let i = 0; i < 5; i++) {
        setTimeout(() => {
          createExplosion(x + randomRange(-50, 50), y + randomRange(-50, 50), color, 20, 'SHOCKWAVE');
        }, i * 200);
      }
    }
    for (let i = 0; i < count; i++) {
      engineRef.current.particles.push({
        x,
        y,
        vx: randomRange(-5, 5),
        vy: randomRange(-5, 5),
        life: 1.0,
        color,
        size: randomRange(2, 6),
        type: 'SPARK'
      });
    }
    playSound('explosion');
  };

  const spawnEnemy = () => {
    if (engineRef.current.bossActive) return;

    // Boss spawning every 10 levels
    if (level % 10 === 0 && engineRef.current.enemies.length === 0 && !engineRef.current.bossActive) {
      engineRef.current.bossActive = true;
      engineRef.current.enemies.push({
        id: Date.now(),
        x: CANVAS_WIDTH / 2,
        y: -100,
        type: 'BOSS',
        hp: 50 + (level * 10),
        maxHp: 50 + (level * 10),
        speed: 1,
        score: 5000,
        width: 150,
        height: 100,
        lastShot: 0,
        phase: 1,
        moveDir: 1
      });
      return;
    }

    const typeRoll = Math.random();
    let type: Enemy['type'] = 'BASIC';
    let hp = 1;
    let speed = 2 + (level * 0.2);
    let scoreVal = 100;
    let width = 40;
    let height = 40;

    if (level >= 3 && typeRoll > 0.9) {
      type = 'ELITE';
      hp = 2;
      speed = 2.5 + (level * 0.2);
      scoreVal = 500;
      width = 45;
      height = 45;
    } else if (typeRoll > 0.75) {
      type = 'HEAVY';
      hp = 3;
      speed = 1 + (level * 0.1);
      scoreVal = 300;
      width = 60;
      height = 50;
    } else if (typeRoll > 0.55) {
      type = 'FAST';
      hp = 1;
      speed = 4 + (level * 0.3);
      scoreVal = 200;
      width = 30;
      height = 30;
    }

    engineRef.current.enemies.push({
      id: Date.now() + Math.random(),
      x: randomRange(width, CANVAS_WIDTH - width),
      y: -height,
      type,
      hp,
      maxHp: hp,
      speed,
      score: scoreVal,
      width,
      height,
      lastShot: 0
    });
  };

  const spawnPowerUp = (x?: number, y?: number, forceType?: PowerUp['type']) => {
    const type: PowerUp['type'] = forceType || (Math.random() > 0.5 ? 'TRIPLE_SHOT' : 'SHIELD');
    engineRef.current.powerUps.push({
      x: x !== undefined ? x : randomRange(30, CANVAS_WIDTH - 30),
      y: y !== undefined ? y : -30,
      type,
      width: 30,
      height: 30,
      value: type === 'COIN' ? 10 : 0
    });
  };

  // --- Animation Loop ---

  useEffect(() => {
    if (gameState !== 'PLAYING') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const update = () => {
      const engine = engineRef.current;
      const player = engine.player;

      // 1. Player Movement
      if (engine.keys['ArrowLeft'] || engine.keys['KeyA']) player.x -= player.speed;
      if (engine.keys['ArrowRight'] || engine.keys['KeyD']) player.x += player.speed;
      if (engine.keys['ArrowUp'] || engine.keys['KeyW']) player.y -= player.speed;
      if (engine.keys['ArrowDown'] || engine.keys['KeyS']) player.y += player.speed;

      // Boundaries
      player.x = Math.max(player.width / 2, Math.min(CANVAS_WIDTH - player.width / 2, player.x));
      player.y = Math.max(player.height / 2, Math.min(CANVAS_HEIGHT - player.height / 2, player.y));

      // 2. Shooting
      const now = Date.now();
      if (engine.keys['Space'] && now - engine.lastShot > upgrades.fireRate) {
        if (player.tripleShot > 0) {
          engine.bullets.push({ x: player.x, y: player.y - 20, vx: 0, vy: -12, power: 1 });
          engine.bullets.push({ x: player.x, y: player.y - 20, vx: -3, vy: -11, power: 1 });
          engine.bullets.push({ x: player.x, y: player.y - 20, vx: 3, vy: -11, power: 1 });
          if (upgrades.tripleShotLevel < 2) player.tripleShot--;
        } else {
          engine.bullets.push({ x: player.x, y: player.y - 20, vx: 0, vy: -12, power: 1 });
        }
        engine.lastShot = now;
        playSound('shoot');
      }

      // 3. Update Bullets
      engine.bullets.forEach((b, i) => {
        b.x += b.vx;
        b.y += b.vy;
        if (b.y < -20 || b.x < -20 || b.x > CANVAS_WIDTH + 20) engine.bullets.splice(i, 1);
      });

      engine.enemyBullets.forEach((b, i) => {
        b.x += b.vx;
        b.y += b.vy;
        if (b.y > CANVAS_HEIGHT + 20) engine.enemyBullets.splice(i, 1);

        // Collision with player
        if (player.invulnerable <= 0) {
          const dx = player.x - b.x;
          const dy = player.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < player.width / 2) {
            engine.enemyBullets.splice(i, 1);
            if (player.shield) {
              player.shield = false;
              createExplosion(player.x, player.y, '#3b82f6', 10);
            } else if (!isGuardianMode) {
              setPlayerHits(h => {
                const newHits = h + 1;
                if (newHits >= upgrades.armorStrength) {
                  setLives(l => {
                    if (l <= 1) setGameState('GAMEOVER');
                    return l - 1;
                  });
                  engine.lostLifeThisRun = true;
                  createExplosion(player.x, player.y, '#ef4444', 30, 'SHOCKWAVE');
                  return 0;
                }
                playSound('hit');
                return newHits;
              });
            }
            player.invulnerable = 60;
          }
        }
      });

      // 4. Update Stars
      engine.stars.forEach(s => {
        s.y += s.speed;
        if (s.y > CANVAS_HEIGHT) s.y = -10;
      });

      // 5. Update Enemies
      engine.enemySpawnTimer++;
      const spawnRate = Math.max(15, 50 - level * 4);
      if (engine.enemySpawnTimer > spawnRate) {
        spawnEnemy();
        engine.enemySpawnTimer = 0;
      }

      engine.enemies.forEach((e, i) => {
        if (e.type === 'BOSS') {
          // Boss Movement
          if (e.y < 100) e.y += 1;
          e.x += (e.moveDir || 1) * 2;
          if (e.x < 100 || e.x > CANVAS_WIDTH - 100) e.moveDir = (e.moveDir || 1) * -1;

          // Boss Shooting
          if (now - (e.lastShot || 0) > 1000) {
            for (let j = -2; j <= 2; j++) {
              engine.enemyBullets.push({ x: e.x + j * 20, y: e.y + 40, vx: j * 1, vy: 6, power: 1, isEnemy: true });
            }
            e.lastShot = now;
          }
        } else {
          e.y += e.speed;
        }
        
        // Enemy Shooting (Elite or Level 3+)
        if (e.type === 'ELITE' || (level >= 3 && Math.random() < 0.01)) {
          if (now - (e.lastShot || 0) > 1500) {
            engine.enemyBullets.push({ x: e.x, y: e.y + 20, vx: 0, vy: 5, power: 1, isEnemy: true });
            e.lastShot = now;
          }
        }

        // Check collision with player
        if (player.invulnerable <= 0) {
          const dx = player.x - e.x;
          const dy = player.y - e.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < (player.width + e.width) / 2.5) {
            if (player.shield) {
              player.shield = false;
              createExplosion(player.x, player.y, '#3b82f6', 20);
            } else if (!isGuardianMode) {
              setLives(l => {
                if (l <= 1) setGameState('GAMEOVER');
                return l - 1;
              });
              engine.lostLifeThisRun = true;
              createExplosion(player.x, player.y, '#ef4444', 30, 'SHOCKWAVE');
            }
            player.invulnerable = 120;
            if (e.type !== 'BOSS') engine.enemies.splice(i, 1);
          }
        }

        // Check collision with bullets
        engine.bullets.forEach((b, bi) => {
          const dx = b.x - e.x;
          const dy = b.y - e.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < e.width / 2 + 5) {
            e.hp -= b.power * upgrades.bulletPower;
            engine.bullets.splice(bi, 1);
            if (e.hp <= 0) {
              setScore(s => s + e.score);
              engine.enemiesKilled++;
              
              if (e.type === 'BOSS') {
                engine.bossActive = false;
                createExplosion(e.x, e.y, '#a855f7', 50, 'BOSS_EXPLOSION');
                for (let j = 0; j < 10; j++) spawnPowerUp(e.x + randomRange(-50, 50), e.y + randomRange(-50, 50), 'COIN');
                unlockAchievement('boss_slayer');
              } else {
                createExplosion(e.x, e.y, e.type === 'HEAVY' ? '#f59e0b' : e.type === 'FAST' ? '#10b981' : '#ef4444', 20, e.type === 'HEAVY' ? 'SHOCKWAVE' : 'SPARK');
                // Spawn Coin
                if (Math.random() < 0.4) spawnPowerUp(e.x, e.y, 'COIN');
              }

              engine.enemies.splice(i, 1);

              // Achievements
              if (engine.enemiesKilled === 1) unlockAchievement('first_blood');
              if (engine.enemiesKilled === 50) unlockAchievement('ace_pilot');
            }
          }
        });

        // Escape check
        if (e.y > CANVAS_HEIGHT + e.height) {
          engine.enemies.splice(i, 1);
          if (isGuardianMode) {
            setEscapedEnemies(prev => {
              const next = prev + 1;
              if (next >= 40) {
                setGameState('GUARDIAN_RESULT');
              }
              return next;
            });
          }
        }
      });

      // 6. Update PowerUps
      engine.powerUpSpawnTimer++;
      if (engine.powerUpSpawnTimer > 600) {
        spawnPowerUp();
        engine.powerUpSpawnTimer = 0;
      }

      engine.powerUps.forEach((p, i) => {
        p.y += 2;
        
        // Shooting to collect
        engine.bullets.forEach((b, bi) => {
          const dx = b.x - p.x;
          const dy = b.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < (p.width + 10) / 2) {
            engine.bullets.splice(bi, 1);
            if (p.type === 'SHIELD') {
              player.shield = true;
              engine.shieldsPicked++;
              playSound('powerup');
              if (engine.shieldsPicked === 3) unlockAchievement('shield_master');
            } else if (p.type === 'TRIPLE_SHOT') {
              player.tripleShot += 30;
              engine.tripleShotsPicked++;
              playSound('powerup');
              if (engine.tripleShotsPicked === 3) unlockAchievement('power_hungry');
            } else if (p.type === 'COIN') {
              setSessionCoins(c => c + (p.value || 10));
              setTotalCoins(c => {
                const newTotal = c + (p.value || 10);
                if (newTotal >= 1000) unlockAchievement('rich_man');
                return newTotal;
              });
              playSound('coin');
            }
            engine.powerUps.splice(i, 1);
          }
        });

        if (p.y > CANVAS_HEIGHT + 50) engine.powerUps.splice(i, 1);
      });

      // 7. Update Particles
      engine.particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.type === 'SHOCKWAVE') {
          p.size += 2;
          p.life -= 0.04;
        } else {
          p.life -= 0.02;
        }
        if (p.life <= 0) engine.particles.splice(i, 1);
      });

      // 8. Level Up Logic
      if (score > level * 2000) {
        setLevel(l => {
          const nextLevel = l + 1;
          if (nextLevel === 5 && !engine.lostLifeThisRun) unlockAchievement('untouchable');
          return nextLevel;
        });
        engine.enemies = [];
        engine.enemyBullets = [];
        engine.levelUpPending = true;
        setTimeout(() => engine.levelUpPending = false, 2000);
      }

      // 9. Achievement: Survivor
      if (Date.now() - engine.startTime > 60000) {
        unlockAchievement('survivor');
      }

      if (player.invulnerable > 0) player.invulnerable--;
      if (engine.warningTimer > 0) engine.warningTimer--;
      engine.frameCount++;
    };

    const draw = () => {
      const engine = engineRef.current;
      const player = engine.player;
      const imgs = imagesRef.current;

      // Clear
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Draw Grid (Sci-fi feel)
      ctx.strokeStyle = 'rgba(14, 165, 233, 0.05)';
      ctx.lineWidth = 1;
      const gridSize = 50;
      const offset = (engine.frameCount % gridSize);
      for (let x = 0; x < CANVAS_WIDTH; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_HEIGHT);
        ctx.stroke();
      }
      for (let y = offset; y < CANVAS_HEIGHT; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_WIDTH, y);
        ctx.stroke();
      }

      // Draw Stars
      ctx.fillStyle = '#ffffff';
      engine.stars.forEach(s => {
        ctx.globalAlpha = s.speed / 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1.0;

      // Draw Particles
      engine.particles.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        if (p.type === 'SHOCKWAVE') {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.globalAlpha = 1.0;

      // Draw PowerUps
      engine.powerUps.forEach(p => {
        ctx.save();
        ctx.translate(p.x, p.y);
        
        if (p.type === 'COIN') {
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#fbbf24';
          ctx.fillStyle = '#fbbf24';
          ctx.beginPath();
          ctx.arc(0, 0, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#f59e0b';
          ctx.font = 'bold 12px Inter';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('$', 0, 0);
        } else {
          const img = p.type === 'SHIELD' ? imgs.powerup_shield : imgs.powerup_bolt;
          if (img && img.complete && img.naturalWidth !== 0) {
            ctx.drawImage(img, -p.width / 2, -p.height / 2, p.width, p.height);
          } else {
            ctx.shadowBlur = 15;
            ctx.shadowColor = p.type === 'SHIELD' ? '#3b82f6' : '#f59e0b';
            ctx.fillStyle = p.type === 'SHIELD' ? '#3b82f6' : '#f59e0b';
            ctx.beginPath();
            ctx.arc(0, 0, p.width / 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      });

      // Draw Bullets
      engine.bullets.forEach(b => {
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#60a5fa';
        ctx.fillStyle = '#60a5fa';
        ctx.fillRect(b.x - 2, b.y - 10, 4, 15);
      });

      engine.enemyBullets.forEach(b => {
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#ef4444';
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw Player
      if (player.invulnerable % 10 < 5) {
        ctx.save();
        ctx.translate(player.x, player.y);
        
        // Shield Effect
        if (player.shield) {
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, player.width * 0.8, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 0.2;
          ctx.fillStyle = '#3b82f6';
          ctx.fill();
          ctx.globalAlpha = 1.0;
        }

        if (imgs.player && imgs.player.complete && imgs.player.naturalWidth !== 0) {
          ctx.drawImage(imgs.player, -player.width / 2, -player.height / 2, player.width, player.height);
        } else {
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#3b82f6';
          ctx.fillStyle = '#f8fafc';
          ctx.beginPath();
          ctx.moveTo(0, -25);
          ctx.lineTo(-20, 15);
          ctx.lineTo(0, 5);
          ctx.lineTo(20, 15);
          ctx.closePath();
          ctx.fill();
        }

        // Engine Glow
        ctx.fillStyle = '#ef4444';
        const flicker = Math.sin(engine.frameCount * 0.5) * 5;
        ctx.beginPath();
        ctx.moveTo(-10, 15);
        ctx.lineTo(0, 25 + flicker);
        ctx.lineTo(10, 15);
        ctx.fill();

        ctx.restore();
      }

      // Draw Enemies
      engine.enemies.forEach(e => {
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.shadowBlur = 15;
        
        let img = null;
        if (e.type === 'BASIC') img = imgs.enemy_basic;
        else if (e.type === 'FAST') img = imgs.enemy_fast;
        else if (e.type === 'HEAVY') img = imgs.enemy_heavy;
        else if (e.type === 'ELITE') img = imgs.enemy_heavy; // Fallback

        if (img && img.complete && img.naturalWidth !== 0) {
          ctx.drawImage(img, -e.width / 2, -e.height / 2, e.width, e.height);
        } else {
          if (e.type === 'BASIC') {
            ctx.shadowColor = '#ef4444';
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.moveTo(0, 20);
            ctx.lineTo(-15, -15);
            ctx.lineTo(15, -15);
            ctx.closePath();
            ctx.fill();
          } else if (e.type === 'FAST') {
            ctx.shadowColor = '#10b981';
            ctx.fillStyle = '#10b981';
            ctx.beginPath();
            ctx.moveTo(0, 15);
            ctx.lineTo(-10, -10);
            ctx.lineTo(0, -5);
            ctx.lineTo(10, -10);
            ctx.closePath();
            ctx.fill();
          } else if (e.type === 'HEAVY' || e.type === 'ELITE') {
            ctx.shadowColor = e.type === 'ELITE' ? '#a855f7' : '#f59e0b';
            ctx.fillStyle = e.type === 'ELITE' ? '#a855f7' : '#f59e0b';
            ctx.fillRect(-e.width / 2, -e.height / 2, e.width, e.height);
            ctx.fillStyle = '#000';
            ctx.fillRect(-e.width / 4, -e.height / 4, e.width / 2, e.height / 2);
          } else if (e.type === 'BOSS') {
            ctx.shadowColor = '#a855f7';
            ctx.fillStyle = '#a855f7';
            ctx.beginPath();
            ctx.moveTo(0, 50);
            ctx.lineTo(-75, -50);
            ctx.lineTo(0, -20);
            ctx.lineTo(75, -50);
            ctx.closePath();
            ctx.fill();
            // Boss Eye
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(0, 0, 15, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(0, 0, 8, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // HP Bar
        if (e.hp < e.maxHp) {
          const barWidth = e.type === 'BOSS' ? 120 : 40;
          ctx.fillStyle = '#333';
          ctx.fillRect(-barWidth / 2, -e.height / 2 - 10, barWidth, 5);
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(-barWidth / 2, -e.height / 2 - 10, barWidth * (e.hp / e.maxHp), 5);
        }

        ctx.restore();
      });

      // UI Overlays
      if (engine.levelUpPending) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 48px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(`LEVEL ${level} UP!`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      }

      if (engine.warningTimer > 0) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
        ctx.fillRect(0, 0, CANVAS_WIDTH, 5);
        ctx.fillRect(0, CANVAS_HEIGHT - 5, CANVAS_WIDTH, 5);
        ctx.fillRect(0, 0, 5, CANVAS_HEIGHT);
        ctx.fillRect(CANVAS_WIDTH - 5, 0, 5, CANVAS_HEIGHT);
      }
    };

    const loop = () => {
      if (gameState === 'PLAYING') {
        update();
        draw();
        animationFrameId = requestAnimationFrame(loop);
      }
    };

    loop();

    return () => cancelAnimationFrame(animationFrameId);
  }, [gameState, level, score, unlockAchievement, upgrades]);

  // --- Touch Controls ---
  const handleTouchMove = (e: React.TouchEvent) => {
    if (gameState !== 'PLAYING') return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const touch = e.touches[0];
    const x = (touch.clientX - rect.left) * (CANVAS_WIDTH / rect.width);
    const y = (touch.clientY - rect.top) * (CANVAS_HEIGHT / rect.height);
    engineRef.current.player.x = x;
    engineRef.current.player.y = y - 50; // Offset for finger
    engineRef.current.keys['Space'] = true; // Auto shoot on touch
  };

  const handleTouchEnd = () => {
    engineRef.current.keys['Space'] = false;
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 font-sans selection:bg-sky-500/30 overflow-hidden flex flex-col lg:flex-row" ref={containerRef}>
      
      {/* Sidebar - Desktop Only */}
      <aside className="hidden lg:flex w-80 border-r border-white/10 bg-white/5 backdrop-blur-xl p-8 flex-col gap-8">
        <div className="space-y-4">
          <h2 className="text-xl font-bold flex items-center gap-2 text-sky-400">
            <Gamepad2 className="w-5 h-5" /> 操作指南
          </h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex flex-col items-center gap-1">
              <span className="text-xs text-slate-400">移动</span>
              <span className="font-mono font-bold">WASD / 方向键</span>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex flex-col items-center gap-1">
              <span className="text-xs text-slate-400">射击</span>
              <span className="font-mono font-bold">空格键</span>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex flex-col items-center gap-1">
              <span className="text-xs text-slate-400">暂停</span>
              <span className="font-mono font-bold">P键</span>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex flex-col items-center gap-1">
              <span className="text-xs text-slate-400">移动端</span>
              <span className="font-mono font-bold">滑动屏幕</span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-bold flex items-center gap-2 text-amber-400">
            <Zap className="w-5 h-5" /> 道具说明
          </h2>
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center shadow-[0_0_15px_rgba(245,158,11,0.5)]">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="font-bold">三向子弹</p>
                <p className="text-xs text-slate-400">大幅增强火力，持续30发</p>
              </div>
            </div>
            <div className="p-4 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-sky-500 flex items-center justify-center shadow-[0_0_15px_rgba(59,130,246,0.5)]">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="font-bold">能量护盾</p>
                <p className="text-xs text-slate-400">抵挡一次致命攻击</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-auto">
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3">
            <Info className="w-5 h-5 text-sky-400" />
            <p className="text-xs text-slate-400 leading-relaxed">
              敌机逃脱会扣除50分。关卡越高，敌机速度越快，出现频率越高。
            </p>
          </div>
        </div>
      </aside>

      {/* Main Game Area */}
      <main className="flex-1 relative flex flex-col items-center justify-center p-4">
        
        {/* HUD */}
        {gameState !== 'START' && gameState !== 'UPGRADE' && gameState !== 'GUARDIAN_RESULT' && (
          <div className="absolute top-8 left-8 right-8 flex justify-between items-start z-10 pointer-events-none">
            <div className="flex flex-col gap-2">
              <div className="px-6 py-3 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/10 flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-sky-400" />
                  <span className="text-2xl font-mono font-bold tracking-tighter">{score.toLocaleString()}</span>
                </div>
                {!isGuardianMode && (
                  <>
                    <div className="w-px h-6 bg-white/10" />
                    <div className="flex items-center gap-2">
                      <Star className="w-5 h-5 text-amber-400" />
                      <span className="text-xl font-bold">LV.{level}</span>
                    </div>
                  </>
                )}
                {isGuardianMode && (
                  <>
                    <div className="w-px h-6 bg-white/10" />
                    <div className="flex items-center gap-2">
                      <Skull className="w-5 h-5 text-rose-500" />
                      <span className="text-xl font-bold">{escapedEnemies}/40</span>
                    </div>
                  </>
                )}
                <div className="w-px h-6 bg-white/10" />
                <div className="flex items-center gap-2">
                  <span className="text-amber-400 font-bold">$</span>
                  <span className="text-xl font-mono font-bold">{sessionCoins}</span>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex gap-2">
                  {isGuardianMode ? (
                    <div className="px-4 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 text-xs font-bold">
                      GUARDIAN MODE: INFINITE HP
                    </div>
                  ) : (
                    Array.from({ length: upgrades.maxLives }).map((_, i) => (
                      <Heart 
                        key={i} 
                        className={`w-6 h-6 transition-all duration-300 ${i < lives ? 'text-rose-500 fill-rose-500' : 'text-slate-700'}`} 
                      />
                    ))
                  )}
                </div>
                {!isGuardianMode && (
                  <>
                    <div className="w-32 h-2 bg-white/10 rounded-full overflow-hidden border border-white/5">
                      <div 
                        className="h-full bg-rose-500 transition-all duration-300"
                        style={{ width: `${(playerHits / upgrades.armorStrength) * 100}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Armor Integrity</p>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <button 
                onClick={togglePause}
                className="p-3 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/10 hover:bg-white/10 transition-colors pointer-events-auto"
              >
                {gameState === 'PAUSED' ? <Play className="w-6 h-6" /> : <Pause className="w-6 h-6" />}
              </button>
              {engineRef.current.player.shield && (
                <div className="px-4 py-2 rounded-full bg-sky-500/20 border border-sky-500/50 text-sky-400 text-xs font-bold flex items-center gap-2 animate-pulse">
                  <Shield className="w-3 h-3" /> SHIELD ACTIVE
                </div>
              )}
              {engineRef.current.player.tripleShot > 0 && (
                <div className="px-4 py-2 rounded-full bg-amber-500/20 border border-amber-500/50 text-amber-400 text-xs font-bold flex items-center gap-2">
                  <Zap className="w-3 h-3" /> TRIPLE SHOT: {upgrades.tripleShotLevel === 2 ? 'PERMANENT' : engineRef.current.player.tripleShot}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Canvas Container */}
        <div className="relative w-full max-w-[800px] aspect-[4/3] rounded-3xl overflow-hidden border border-white/10 shadow-2xl shadow-sky-500/10 bg-black">
          <canvas 
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="w-full h-full cursor-none touch-none"
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          />

          {/* Overlays */}
          <AnimatePresence>
            {gameState === 'START' && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-12 text-center"
              >
                <motion.div
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  <h1 className="text-6xl font-black mb-4 tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-sky-400">
                    KARL星际先锋
                  </h1>
                  <p className="text-slate-400 mb-8 max-w-md mx-auto">
                    驾驶最先进的星际战机，在无尽的虚空中对抗来袭的敌军。升级你的武器，解锁成就，成为银河系的传奇。
                  </p>
                  
                  <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                    <button 
                      onClick={() => startGame(false)}
                      className="group relative px-12 py-5 rounded-full bg-sky-500 hover:bg-sky-400 text-white font-bold text-xl transition-all hover:scale-105 active:scale-95 shadow-[0_0_30px_rgba(14,165,233,0.4)]"
                    >
                      <span className="flex items-center gap-3">
                        <Play className="w-6 h-6 fill-current" /> 开始战斗
                      </span>
                    </button>
                    <button 
                      onClick={() => startGame(true)}
                      className="px-10 py-5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-xl transition-all flex items-center gap-3 border border-emerald-500/30 shadow-[0_0_30px_rgba(16,185,129,0.3)]"
                    >
                      <Shield className="w-6 h-6" /> 守护者模式 ($450)
                    </button>
                    <button 
                      onClick={() => setGameState('UPGRADE')}
                      className="px-10 py-5 rounded-full bg-white/10 hover:bg-white/20 text-white font-bold text-xl transition-all flex items-center gap-3 border border-white/10"
                    >
                      <Zap className="w-6 h-6 text-amber-400" /> 飞船升级
                    </button>
                  </div>

                  <div className="mt-8 flex items-center justify-center gap-2 text-amber-400 font-bold">
                    <span className="text-2xl">$</span>
                    <span className="text-3xl font-mono">{totalCoins.toLocaleString()}</span>
                  </div>
                </motion.div>
              </motion.div>
            )}

            {gameState === 'GUARDIAN_RESULT' && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center p-12"
              >
                <div className="w-full max-w-md text-center space-y-8">
                  <Shield className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
                  <h2 className="text-5xl font-black text-emerald-500 tracking-tighter">挑战结束</h2>
                  <p className="text-slate-400">防线已被突破，但你的表现令人印象深刻。</p>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-6 rounded-3xl bg-white/5 border border-white/10">
                      <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">击落敌机</p>
                      <p className="text-3xl font-mono font-bold text-sky-400">{engineRef.current.enemiesKilled}</p>
                    </div>
                    <div className="p-6 rounded-3xl bg-white/5 border border-white/10">
                      <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">获得奖励</p>
                      <p className="text-3xl font-mono font-bold text-amber-400">${Math.floor(engineRef.current.enemiesKilled * 5 + (Date.now() - engineRef.current.startTime) / 1000)}</p>
                    </div>
                  </div>

                  <button 
                    onClick={() => {
                      const reward = Math.floor(engineRef.current.enemiesKilled * 5 + (Date.now() - engineRef.current.startTime) / 1000);
                      setTotalCoins(c => c + reward);
                      setGameState('START');
                    }}
                    className="w-full px-8 py-5 rounded-2xl bg-sky-500 hover:bg-sky-400 text-white font-bold text-xl transition-all"
                  >
                    领取奖励并退出
                  </button>
                </div>
              </motion.div>
            )}

            {gameState === 'UPGRADE' && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center p-8"
              >
                <div className="w-full max-w-2xl bg-white/5 border border-white/10 rounded-3xl p-8 space-y-8 overflow-y-auto max-h-full">
                  <div className="flex justify-between items-center">
                    <h2 className="text-3xl font-black text-sky-400 tracking-tighter flex items-center gap-3">
                      <Zap className="w-8 h-8 text-amber-400" /> 飞船实验室
                    </h2>
                    <div className="flex items-center gap-2 text-amber-400 font-bold">
                      <span className="text-xl">$</span>
                      <span className="text-2xl font-mono">{totalCoins.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Max Lives Upgrade */}
                    <div className="p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-bold text-lg">强化装甲 (Lv.{upgrades.maxLives - 2})</p>
                          <p className="text-xs text-slate-400">增加初始生命值 (当前: {upgrades.maxLives})</p>
                        </div>
                        <Heart className="w-6 h-6 text-rose-500" />
                      </div>
                      <button 
                        disabled={totalCoins < (upgrades.maxLives * 200) || upgrades.maxLives >= 10}
                        onClick={() => {
                          setTotalCoins(c => c - (upgrades.maxLives * 200));
                          setUpgrades(u => ({ ...u, maxLives: u.maxLives + 1 }));
                          playSound('powerup');
                        }}
                        className="w-full py-3 rounded-xl bg-sky-500/20 text-sky-400 font-bold text-sm border border-sky-500/30 disabled:opacity-30 hover:bg-sky-500/30 transition-all"
                      >
                        {upgrades.maxLives >= 10 ? '已满级' : `升级 ($${upgrades.maxLives * 200})`}
                      </button>
                    </div>

                    {/* Bullet Power */}
                    <div className="p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-bold text-lg">火力增强 (Lv.{Math.round((upgrades.bulletPower - 1) / 0.5)})</p>
                          <p className="text-xs text-slate-400">提升子弹伤害 (当前: {upgrades.bulletPower.toFixed(1)}x)</p>
                        </div>
                        <Target className="w-6 h-6 text-rose-400" />
                      </div>
                      <button 
                        disabled={totalCoins < (Math.round(upgrades.bulletPower * 500)) || upgrades.bulletPower >= 5}
                        onClick={() => {
                          setTotalCoins(c => c - (Math.round(upgrades.bulletPower * 500)));
                          setUpgrades(u => ({ ...u, bulletPower: u.bulletPower + 0.5 }));
                          playSound('powerup');
                        }}
                        className="w-full py-3 rounded-xl bg-rose-500/20 text-rose-400 font-bold text-sm border border-rose-500/30 disabled:opacity-30 hover:bg-rose-500/30 transition-all"
                      >
                        {upgrades.bulletPower >= 5 ? '已满级' : `升级 ($${Math.round(upgrades.bulletPower * 500)})`}
                      </button>
                    </div>

                    {/* Armor Strength */}
                    <div className="p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-bold text-lg">抗性优化 (Lv.{upgrades.armorStrength - 4})</p>
                          <p className="text-xs text-slate-400">增加受击耐受度 (当前: {upgrades.armorStrength}次/血)</p>
                        </div>
                        <Shield className="w-6 h-6 text-sky-400" />
                      </div>
                      <button 
                        disabled={totalCoins < (upgrades.armorStrength * 150) || upgrades.armorStrength >= 15}
                        onClick={() => {
                          setTotalCoins(c => c - (upgrades.armorStrength * 150));
                          setUpgrades(u => ({ ...u, armorStrength: u.armorStrength + 1 }));
                          playSound('powerup');
                        }}
                        className="w-full py-3 rounded-xl bg-sky-500/20 text-sky-400 font-bold text-sm border border-sky-500/30 disabled:opacity-30 hover:bg-sky-500/30 transition-all"
                      >
                        {upgrades.armorStrength >= 15 ? '已满级' : `升级 ($${upgrades.armorStrength * 150})`}
                      </button>
                    </div>

                    {/* Permanent Triple Shot */}
                    <div className="p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-bold text-lg">三向火控</p>
                          <p className="text-xs text-slate-400">永久三向子弹系统</p>
                        </div>
                        <Zap className="w-6 h-6 text-amber-400" />
                      </div>
                      <button 
                        disabled={totalCoins < 2000 || upgrades.tripleShotLevel >= 2}
                        onClick={() => {
                          setTotalCoins(c => c - 2000);
                          setUpgrades(u => ({ ...u, tripleShotLevel: 2 }));
                          playSound('powerup');
                        }}
                        className="w-full py-3 rounded-xl bg-amber-500/20 text-amber-400 font-bold text-sm border border-amber-500/30 disabled:opacity-30 hover:bg-amber-500/30 transition-all"
                      >
                        {upgrades.tripleShotLevel >= 2 ? '已解锁' : '解锁 ($2000)'}
                      </button>
                    </div>

                    {/* Fire Rate */}
                    <div className="p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-bold text-lg">射速优化 (Lv.{Math.round((200 - upgrades.fireRate) / 20)})</p>
                          <p className="text-xs text-slate-400">缩短射击间隔 (当前: {upgrades.fireRate}ms)</p>
                        </div>
                        <Target className="w-6 h-6 text-emerald-400" />
                      </div>
                      <button 
                        disabled={totalCoins < (800 + (200 - upgrades.fireRate) * 10) || upgrades.fireRate <= 60}
                        onClick={() => {
                          setTotalCoins(c => c - (800 + (200 - upgrades.fireRate) * 10));
                          setUpgrades(u => ({ ...u, fireRate: u.fireRate - 20 }));
                          playSound('powerup');
                        }}
                        className="w-full py-3 rounded-xl bg-emerald-500/20 text-emerald-400 font-bold text-sm border border-emerald-500/30 disabled:opacity-30 hover:bg-emerald-500/30 transition-all"
                      >
                        {upgrades.fireRate <= 60 ? '已满级' : `升级 ($${800 + (200 - upgrades.fireRate) * 10})`}
                      </button>
                    </div>

                    {/* Speed */}
                    <div className="p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-bold text-lg">引擎过载 (Lv.{upgrades.moveSpeed - 5})</p>
                          <p className="text-xs text-slate-400">提升飞行移动速度 (当前: {upgrades.moveSpeed})</p>
                        </div>
                        <Star className="w-6 h-6 text-sky-400" />
                      </div>
                      <button 
                        disabled={totalCoins < (upgrades.moveSpeed * 100) || upgrades.moveSpeed >= 15}
                        onClick={() => {
                          setTotalCoins(c => c - (upgrades.moveSpeed * 100));
                          setUpgrades(u => ({ ...u, moveSpeed: u.moveSpeed + 1 }));
                          playSound('powerup');
                        }}
                        className="w-full py-3 rounded-xl bg-sky-500/20 text-sky-400 font-bold text-sm border border-sky-500/30 disabled:opacity-30 hover:bg-sky-500/30 transition-all"
                      >
                        {upgrades.moveSpeed >= 15 ? '已满级' : `升级 ($${upgrades.moveSpeed * 100})`}
                      </button>
                    </div>
                  </div>

                  <button 
                    onClick={() => setGameState('START')}
                    className="w-full py-4 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-bold transition-all flex items-center justify-center gap-3"
                  >
                    返回主页
                  </button>
                </div>
              </motion.div>
            )}

            {gameState === 'PAUSED' && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/60 backdrop-blur-md flex flex-col items-center justify-center"
              >
                <div className="p-12 rounded-3xl bg-white/5 border border-white/10 text-center space-y-8">
                  <h2 className="text-4xl font-bold">游戏暂停</h2>
                  <div className="flex flex-col gap-4">
                    <button 
                      onClick={togglePause}
                      className="px-8 py-4 rounded-2xl bg-sky-500 hover:bg-sky-400 text-white font-bold transition-all flex items-center justify-center gap-3"
                    >
                      <Play className="w-5 h-5 fill-current" /> 继续游戏
                    </button>
                    <button 
                      onClick={() => setGameState('START')}
                      className="px-8 py-4 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-bold transition-all flex items-center justify-center gap-3"
                    >
                      <RotateCcw className="w-5 h-5" /> 退出战斗
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {gameState === 'GAMEOVER' && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center p-12 overflow-y-auto"
              >
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="w-full max-w-md text-center space-y-8"
                >
                  <div className="space-y-2">
                    <Skull className="w-16 h-16 text-rose-500 mx-auto mb-4" />
                    <h2 className="text-5xl font-black text-rose-500 tracking-tighter">战机坠毁</h2>
                    <p className="text-slate-400">你在星际战争中表现英勇，但最终还是倒下了。</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-6 rounded-3xl bg-white/5 border border-white/10">
                      <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">最终得分</p>
                      <p className="text-3xl font-mono font-bold text-sky-400">{score.toLocaleString()}</p>
                    </div>
                    <div className="p-6 rounded-3xl bg-white/5 border border-white/10">
                      <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">最高关卡</p>
                      <p className="text-3xl font-mono font-bold text-amber-400">{level}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest flex items-center justify-center gap-2">
                      <Trophy className="w-4 h-4" /> 本局成就
                    </h3>
                    <div className="flex flex-wrap justify-center gap-2">
                      {achievements.filter(a => a.unlocked).length > 0 ? (
                        achievements.filter(a => a.unlocked).map(a => (
                          <div key={a.id} className="px-3 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-bold">
                            {a.title}
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-slate-600 italic">暂无成就解锁</p>
                      )}
                    </div>
                  </div>

                  <button 
                    onClick={startGame}
                    className="w-full px-8 py-5 rounded-2xl bg-sky-500 hover:bg-sky-400 text-white font-bold text-xl transition-all flex items-center justify-center gap-3 shadow-[0_0_30px_rgba(14,165,233,0.3)]"
                  >
                    <RotateCcw className="w-6 h-6" /> 再次挑战
                  </button>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Achievement Popup */}
          <AnimatePresence>
            {unlockedAchievement && (
              <motion.div
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -100, opacity: 0 }}
                className="absolute bottom-8 left-1/2 -translate-x-1/2 px-6 py-4 rounded-2xl bg-amber-500 text-white shadow-2xl shadow-amber-500/40 flex items-center gap-4 z-50"
              >
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                  <Trophy className="w-6 h-6" />
                </div>
                <div className="text-left">
                  <p className="text-[10px] uppercase tracking-widest font-bold opacity-80">成就解锁</p>
                  <p className="font-bold text-lg leading-tight">{unlockedAchievement.title}</p>
                  <p className="text-xs opacity-90">{unlockedAchievement.description}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer Info - Mobile Only */}
        <div className="mt-8 lg:hidden w-full max-w-[800px] grid grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3">
            <Zap className="w-5 h-5 text-amber-400" />
            <div className="text-xs">
              <p className="font-bold">三向子弹</p>
              <p className="text-slate-500">增强火力</p>
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3">
            <Shield className="w-5 h-5 text-sky-400" />
            <div className="text-xs">
              <p className="font-bold">能量护盾</p>
              <p className="text-slate-500">抵挡伤害</p>
            </div>
          </div>
        </div>
      </main>

      {/* Achievement List - Desktop Only */}
      <aside className="hidden xl:flex w-80 border-l border-white/10 bg-white/5 backdrop-blur-xl p-8 flex-col gap-6">
        <h2 className="text-xl font-bold flex items-center gap-2 text-amber-400">
          <Trophy className="w-5 h-5" /> 成就系统
        </h2>
        <div className="space-y-4">
          {achievements.map(a => (
            <div 
              key={a.id} 
              className={`p-4 rounded-2xl border transition-all duration-500 ${
                a.unlocked 
                  ? 'bg-amber-500/10 border-amber-500/30' 
                  : 'bg-white/5 border-white/10 opacity-40 grayscale'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="font-bold text-sm">{a.title}</p>
                {a.unlocked && <ChevronRight className="w-4 h-4 text-amber-500" />}
              </div>
              <p className="text-xs text-slate-400">{a.description}</p>
            </div>
          ))}
        </div>
      </aside>

      {/* Custom Styles for Canvas Glow */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(14, 165, 233, 0.1); }
          50% { box-shadow: 0 0 40px rgba(14, 165, 233, 0.2); }
        }
        canvas {
          image-rendering: pixelated;
        }
      `}} />
    </div>
  );
}
