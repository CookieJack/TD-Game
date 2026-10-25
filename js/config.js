/* ============ 游戏数值配置 ============ */
/* 城墙顶高度（英雄站位所在的墙顶 y，暴风城大门墙体同高） */
const WALL_H = 3.4;

const CFG = {
  LIVES: 20,
  START_POINTS: 0,         // 初始积分：击杀 / 波次奖励获得（可在关卡结算画面购买经验）
  TOTAL_WAVES: 20,
  WAVE_BREAK: 14,          // 波次间隔秒数（可提前召唤拿奖励）

  // 英雄经验：击杀者获得怪物 xp；经验条满自动升级（need 为升到 2/3/4 级所需）
  XP: { need: [180, 380, 700] },
  // 关卡结算画面用积分购买经验：每次点击花费 price 积分，为该英雄增加 xp 点经验（可连点）
  XP_BUY: { price: 40, xp: 50 },

  // 地图与路径
  GROUND_W: 64, GROUND_D: 44,
  PATH_WIDTH: 2.4,

  // 多路进攻路线：各路独立黑暗之门入场，终点全部汇合到暴风城大门 [24,0]
  // 关卡通过 LEVELS[i].routes 决定启用前几条路线
  ROUTES: [
    { name: '西路', path: [
      [-24, 0], [-14, 0], [-14, -6], [-6, -6], [-6, 4], [2, 4],
      [2, -4], [9, -4], [9, 6], [15, 6], [15, 0], [24, 0]
    ]},
    { name: '北路', path: [
      [-16, -18], [-16, -11], [-7, -11], [-7, -15], [1, -15], [1, -9],
      [8, -9], [8, -14], [16, -14], [16, -5], [20, -5], [20, 0], [24, 0]
    ]},
    { name: '南路', path: [
      [-16, 18], [-16, 11], [-7, 11], [-7, 15], [1, 15], [1, 10],
      [8, 10], [8, 14], [16, 14], [16, 9], [21, 9], [21, 4], [24, 0]
    ]},
  ],
  // 相机初始位：城墙斜上空，朝西俯瞰战场（可拖拽旋转 / 右键平移 / 滚轮缩放）
  CAMERA: { target: [18, 2, 0], theta: Math.PI / 2, phi: 0.9, radius: 18 },

  // 4 个英雄站位：暴风城大门城墙顶一字排开（门洞两侧各 2 座，按站位 1→4 从北到南）
  // 中间两位须避开城门头横梁（z 半长 2.65），故整体外扩
  PLOTS: [
    [24.4, WALL_H, 4.7], [24.4, WALL_H, 3.5],
    [24.4, WALL_H, -3.5], [24.4, WALL_H, -4.7]
  ],

  // ============ 关卡场景主题（换关时 World 重建环境层） ============
  // weather: 每波开始时按权重抽取的天气池 [[类型, 权重], ...]；mist: 常驻地面雾强度 0~1
  SCENES: {
    forest: {
      name: '翠绿林地', desc: '晨光穿过松林，黑暗之门的绿光在林间隐现。',
      ground: 0x5d8f3d, patches: [0x557f36, 0x679a44],
      pathTiles: [0x93866a, 0x9c8f70],
      treeType: 'pine', trees: 26, rocks: 12,
      rockColors: [0x8c8c88, 0x7d7d78, 0x99958c],
      hemiGround: 0x3a5a2a, mistColor: 0xaebfd0,
      timeStart: 8, timeLock: null,
      weather: [['clear', 7], ['rain', 3]],
      mist: 0
    },
    swamp: {
      name: '暮色沼泽', desc: '腐烂的泥沼蒸腾着毒雾，枯树下亡灵低语。',
      ground: 0x4a5f33, patches: [0x3d5128, 0x55703a],
      pathTiles: [0x6e6552, 0x776e59],
      treeType: 'dead', trees: 20, rocks: 10,
      rockColors: [0x5f6558, 0x6b7263, 0x555a4e],
      hemiGround: 0x2c3a22, mistColor: 0x9fb289,
      timeStart: 14, timeLock: null,
      weather: [['rain', 5], ['mist', 3], ['clear', 2]],
      mist: 0.5
    },
    tundra: {
      name: '霜雪平原', desc: '寒风卷起细雪，暮色正一寸寸沉入黑夜。',
      ground: 0xdfe8f0, patches: [0xcfdce8, 0xeef4f8],
      pathTiles: [0x9aa4ae, 0xa8b2bc],
      treeType: 'snowPine', trees: 22, rocks: 14,
      rockColors: [0xb8c4cc, 0xa5b1ba, 0xc8d2da],
      hemiGround: 0x8a97a5, mistColor: 0xc4d4e2,
      timeStart: 17, timeLock: null,
      weather: [['snow', 6], ['clear', 4]],
      mist: 0
    },
    icecrown: {
      name: '冰封王座', desc: '永夜降临，寒冰王座之下暴雪呼啸。',
      ground: 0xbfd4e6, patches: [0xa9c2da, 0xd2e2f0],
      pathTiles: [0x7e93a8, 0x8ba0b5],
      treeType: 'ice', trees: 16, rocks: 10,
      rockColors: [0x9fb8cc, 0x8aa4bc, 0xb4cadb],
      hemiGround: 0x6d8095, mistColor: 0xcfe0ee,
      timeStart: 21, timeLock: 21,   // 锁定永夜
      weather: [['snow', 4], ['blizzard', 3], ['mist', 3]],
      mist: 0.7
    }
  },

  // ============ 昼夜循环（time 为游戏内时刻，0-24 小时） ============
  ENV: {
    DAY_LENGTH: 150,      // 一昼夜现实秒数
    FOG: { near: 75, far: 160 },
    // 关键帧之间线性插值；sky 同时用作雾色与半球光天色，太阳在夜里转为暗蓝月光
    // 夜段亮度以保证可玩性为准（月光 hemi≈0.32 / sunI≈0.30）
    KEYS: [
      { t: 0,    sky: 0x0e1830, hemi: 0.32, sunC: 0x4a6a9e, sunI: 0.30 },
      { t: 4.5,  sky: 0x22264a, hemi: 0.34, sunC: 0x52679e, sunI: 0.32 },
      { t: 6,    sky: 0xd98a55, hemi: 0.35, sunC: 0xff9a55, sunI: 0.50 },
      { t: 8,    sky: 0x88b6dd, hemi: 0.50, sunC: 0xffe0b0, sunI: 0.70 },
      { t: 13,   sky: 0x8fc0e8, hemi: 0.60, sunC: 0xfff2d8, sunI: 0.80 },
      { t: 17,   sky: 0xe0a060, hemi: 0.45, sunC: 0xffb060, sunI: 0.55 },
      { t: 19,   sky: 0x5a3a5e, hemi: 0.32, sunC: 0x6a5a8e, sunI: 0.30 },
      { t: 21,   sky: 0x182642, hemi: 0.32, sunC: 0x4a6a9e, sunI: 0.30 },
      { t: 24,   sky: 0x0e1830, hemi: 0.32, sunC: 0x4a6a9e, sunI: 0.30 }
    ]
  },

  // ============ 天气（雨 / 雪 / 暴雪 / 雾 / 晴） ============
  // fogMult: 乘到雾 near/far 上（越小越看不清）；gameplay 数值可在 1~0 间调，1 为无影响
  WEATHER: {
    TRANSITION: 5,        // 天气淡入淡出秒数
    LIGHTNING: true,      // 雨天闪电（纯视觉）
    clear:    { label: '晴',   icon: '☀️', fogMult: 1.0 },
    rain:     { label: '雨',   icon: '🌧', count: 800, fall: 24, size: 0.6, fogMult: 0.72,
                gameplay: { towerRange: 0.92, enemySpeed: 1 } },
    snow:     { label: '雪',   icon: '🌨', count: 450, fall: 2.6, drift: 1.4, size: 0.34, fogMult: 0.8,
                gameplay: { towerRange: 1, enemySpeed: 0.88 } },
    blizzard: { label: '暴雪', icon: '❄️', count: 700, fall: 4.2, drift: 3.2, size: 0.42, fogMult: 0.5,
                gameplay: { towerRange: 0.95, enemySpeed: 0.8 } },
    mist:     { label: '雾',   icon: '🌫', fogMult: 0.4,
                gameplay: { towerRange: 1, enemySpeed: 1 } }
  },

  // ============ 英雄塔 ============
  // fx: 逐级光影档位——弹道/粒子/点光颜色随级变亮变纯，boost 放大弹体体积、光强与粒子量
  TOWERS: {
    mage: {
      name: '亡灵法师', role: '范围输出', icon: '❄️',
      clsColor: '#6fb9ff',
      desc: '发射寒冰箭，造成范围溅射伤害；减速有触发概率，等级越高越容易触发。',
      fx: [
        { color: 0x7fc8ff, boost: 1.0 },
        { color: 0x8fd8ff, boost: 1.15 },
        { color: 0xaee6ff, boost: 1.3 },
        { color: 0xdcf6ff, boost: 1.5 }
      ],
      // slowChance：寒冰箭减速触发概率（随级提升，最高不得超过 25%）
      levels: [
        { dmg: 18, range: 11.0, rate: 1.10, splash: 1.7, slow: 0.30, slowDur: 2.0, slowChance: 0.10 },
        { dmg: 32, range: 12.6, rate: 1.00, splash: 2.0, slow: 0.38, slowDur: 2.2, slowChance: 0.15 },
        { dmg: 56, range: 14.4, rate: 0.90, splash: 2.4, slow: 0.46, slowDur: 2.5, slowChance: 0.20 },
        { dmg: 96, range: 16.0, rate: 0.80, splash: 2.8, slow: 0.54, slowDur: 2.8, slowChance: 0.25 }
      ],
      // 主动群攻技能（手动点击/按快捷键施放，独立 CD）：伤害 = 当前等级 dmg × dmgMult
      skill: {
        name: '冰霜新星', icon: '❄', cd: 16, radius: 10, dmgMult: 2.5,
        slow: 0.50, slowDur: 3,
        desc: '大范围冰爆，重创并强制减速范围内所有敌人'
      },
      statLine: l => `伤害 ${l.dmg}　射程 ${l.range}　间隔 ${l.rate}s\n溅射 ${l.splash}　减速 ${Math.round(l.slow*100)}% / ${l.slowDur}s\n减速触发率 ${Math.round(l.slowChance*100)}%`
    },
    hunter: {
      name: '暗夜精灵猎人', role: '快速单体', icon: '🏹',
      clsColor: '#9d7bff',
      desc: '射速极快、射程最远，箭无虚发，单体物理伤害；2 级解锁毒箭，命中使怪物中毒持续掉血。',
      fx: [
        { color: 0x9d7bff, boost: 1.0 },
        { color: 0xad92ff, boost: 1.15 },
        { color: 0xc4aeff, boost: 1.3 },
        { color: 0xe4d9ff, boost: 1.5 }
      ],
      // poison：2 级解锁的毒箭——命中必附毒持续掉血（无视护甲），同一目标最多 2 层
      levels: [
        { dmg: 9,  range: 14.0, rate: 0.50 },
        { dmg: 16, range: 16.0, rate: 0.42, poison: 8,  poisonDur: 3 },
        { dmg: 28, range: 18.4, rate: 0.34, poison: 14, poisonDur: 3 },
        { dmg: 48, range: 20.5, rate: 0.28, poison: 24, poisonDur: 3 }
      ],
      // 主动群攻技能：范围内每个敌人从天而降一支强箭，伤害 = 当前等级 dmg × dmgMult
      skill: {
        name: '箭雨', icon: '☄', cd: 20, radius: 12, dmgMult: 2.0,
        desc: '天降箭雨，范围内每个敌人各中一支强力箭矢'
      },
      statLine: l => `伤害 ${l.dmg}　射程 ${l.range}　间隔 ${l.rate}s\n(每秒约 ${Math.round(l.dmg / l.rate)} 伤害)${l.poison ? `\n毒性 ${l.poison}/s × ${l.poisonDur}s（无视护甲）` : ''}`
    },
    paladin: {
      name: '人类圣骑士', role: '近战清场', icon: '⚔️',
      clsColor: '#ffd257',
      desc: '释放奉献圣光冲击波，震慑周围所有敌人并短暂眩晕。',
      fx: [
        { color: 0xffd257, boost: 1.0 },
        { color: 0xffdc7a, boost: 1.15 },
        { color: 0xffe79d, boost: 1.3 },
        { color: 0xfff3c8, boost: 1.5 }
      ],
      levels: [
        { dmg: 26, range: 5.4, rate: 1.60, stun: 0.4 },
        { dmg: 48, range: 6.2, rate: 1.45, stun: 0.6 },
        { dmg: 84, range: 7.2, rate: 1.30, stun: 0.8 },
        { dmg: 145, range: 8.0, rate: 1.15, stun: 1.0 }
      ],
      // 主动群攻技能：大范围圣光冲击 + 长眩晕，伤害 = 当前等级 dmg × dmgMult
      skill: {
        name: '圣光风暴', icon: '💥', cd: 18, radius: 11, dmgMult: 2.2, stun: 1.2,
        desc: '圣光冲击波席卷战场，重创并长时间眩晕周围所有敌人'
      },
      statLine: l => `冲击伤害 ${l.dmg}　范围 ${l.range}\n间隔 ${l.rate}s　眩晕 ${l.stun}s`
    },
    priest: {
      name: '血精灵牧师', role: '暗影辅助', icon: '✨',
      clsColor: '#ff8a8a',
      desc: '暗言术：痛蚕食敌人；暗影光环使周围友军伤害提升。',
      fx: [
        { color: 0xb04ae8, boost: 1.0 },
        { color: 0xbd63ec, boost: 1.15 },
        { color: 0xcf80f2, boost: 1.3 },
        { color: 0xe8b6f8, boost: 1.5 }
      ],
      levels: [
        { dot: 30, range: 10.0, rate: 2.0, aura: 0.20, auraRange: 8.0 },
        { dot: 55, range: 11.0, rate: 1.9, aura: 0.35, auraRange: 9.0 },
        { dot: 95, range: 12.0, rate: 1.8, aura: 0.50, auraRange: 10.0 },
        { dot: 160, range: 13.2, rate: 1.7, aura: 0.65, auraRange: 11.0 }
      ],
      // 主动群攻技能：直伤 = 当前等级 dot × dmgMult，另附 dot × dotMult / 5s 的持续蚕食
      skill: {
        name: '暗言术：灾', icon: '🔮', cd: 20, radius: 10, dmgMult: 1.5, dotMult: 1.2,
        desc: '暗影能量席卷战场，重创范围内敌人并持续蚕食'
      },
      statLine: l => `暗言术 ${l.dot} 伤害/5s　射程 ${l.range}\n光环 +${Math.round(l.aura*100)}% 友军伤害（半径 ${l.auraRange}）`
    }
  },

  // ============ 视觉特效（光影 / 辉光） ============
  FX: {
    bloom: { enabled: true, strength: 0.45, radius: 0.35, threshold: 0.94 },
    castDur: 0.42,          // 施法动作时长（秒），伤害/弹道在动作 58% 处释放
    light: { intensity: 2.2, dist: 7.5, life: 0.35 }   // 点光闪光默认参数
  },

  // ============ 暴击（英雄攻击命中时概率造成倍率伤害） ============
  CRIT: { chance: 0.15, mult: 2 },

  // ============ 敌人（points 为战绩分数，xp 为击杀者获得的经验） ============
  // ownLight：模型自带点光（深渊火魔王 / 巫妖王），不再占用怪物夜光灯光池
  ENEMIES: {
    murloc:   { name: '鱼人',       hp: 32,   speed: 2.30, points: 8,   xp: 15,  scale: 0.95 },
    boar:     { name: '野猪',       hp: 60,   speed: 1.70, points: 10,  xp: 20,  scale: 1.0  },
    ghoul:    { name: '食尸鬼',     hp: 92,   speed: 2.00, points: 13,  xp: 26,  scale: 1.05 },
    gargoyle: { name: '石像鬼',     hp: 52,   speed: 2.90, points: 13,  xp: 26,  scale: 0.9, flying: true },
    orc:      { name: '兽人步兵',   hp: 185,  speed: 1.15, points: 20,  xp: 42,  armor: 0.25, scale: 1.2 },
    lich:     { name: '巫妖',       hp: 560,  speed: 1.05, points: 70,  xp: 165, armor: 0.15, boss: true, scale: 1.35 },
    abyssal:  { name: '深渊火魔王', hp: 1500, speed: 0.85, points: 150, xp: 360, armor: 0.30, boss: true, scale: 1.7, ownLight: true },
    lichking: { name: '巫妖王',     hp: 3400, speed: 0.75, points: 330, xp: 780,  armor: 0.30, boss: true, scale: 1.9, ownLight: true }
  },

  // ============ 怪物夜光（黑夜出怪可见 + 照亮周围地面） ============
  // 灯光为常驻池（intensity 0，避免运行时增删触发 shader 重编译），按出怪顺序分配给前 pool 只怪；
  // intensity 按 Env.night 缩放：白天极弱、黑夜全亮。halo 为挂在怪物身上的加色光晕贴片缩放
  ENEMY_GLOW: {
    pool: 8, intensity: 1.1, dist: 5.5,
    halo: 1.5, haloBoss: 2.6, haloOpacity: 0.4,
    color: 0xbfe8d0,
    colors: {
      murloc: 0x53d769, boar: 0xd8a05a, ghoul: 0x8fe86b,
      gargoyle: 0x9a7bff, orc: 0xff8a4a, lich: 0x6fe8ff
    }
  },

  // ============ 波次（多组并行：type, count, gap 秒, delay 秒后开始）
  // route: 该组从哪条路进攻（0 西 / 1 北 / 2 南）；缺省时按当前关路线数轮转分配
  WAVES: [
    [ { type: 'murloc', count: 6, gap: 1.2, delay: 0 } ],
    [ { type: 'murloc', count: 8, gap: 1.0, delay: 0 }, { type: 'boar', count: 2, gap: 1.6, delay: 4 } ],
    [ { type: 'boar', count: 6, gap: 1.4, delay: 0 }, { type: 'murloc', count: 5, gap: 0.9, delay: 2 } ],
    [ { type: 'ghoul', count: 6, gap: 1.3, delay: 0 }, { type: 'boar', count: 4, gap: 1.5, delay: 1 } ],
    [ { type: 'ghoul', count: 6, gap: 1.2, delay: 0 }, { type: 'gargoyle', count: 5, gap: 1.0, delay: 4 } ],
    [ { type: 'gargoyle', count: 8, gap: 0.9, delay: 0, route: 0 }, { type: 'murloc', count: 8, gap: 0.8, delay: 2, route: 1 } ],
    [ { type: 'orc', count: 4, gap: 2.0, delay: 0, route: 0 }, { type: 'boar', count: 6, gap: 1.2, delay: 3, route: 1 } ],
    [ { type: 'ghoul', count: 10, gap: 1.0, delay: 0, route: 0 }, { type: 'gargoyle', count: 6, gap: 1.0, delay: 2, route: 1 } ],
    [ { type: 'orc', count: 6, gap: 1.8, delay: 0, route: 0 }, { type: 'ghoul', count: 8, gap: 1.0, delay: 1, route: 1 } ],
    [ { type: 'murloc', count: 8, gap: 0.8, delay: 0, route: 1 }, { type: 'lich', count: 1, gap: 1, delay: 5, route: 0 } ],
    [ { type: 'orc', count: 8, gap: 1.6, delay: 0, route: 0 }, { type: 'gargoyle', count: 6, gap: 0.9, delay: 2, route: 1 } ],
    [ { type: 'boar', count: 12, gap: 1.0, delay: 0, route: 0 }, { type: 'ghoul', count: 10, gap: 1.0, delay: 1, route: 2 } ],
    [ { type: 'orc', count: 8, gap: 1.5, delay: 0, route: 0 }, { type: 'gargoyle', count: 8, gap: 0.9, delay: 2, route: 1 } ],
    [ { type: 'ghoul', count: 14, gap: 0.9, delay: 0, route: 0 }, { type: 'orc', count: 6, gap: 1.6, delay: 3, route: 2 } ],
    [ { type: 'orc', count: 8, gap: 1.4, delay: 0, route: 1 }, { type: 'abyssal', count: 1, gap: 1, delay: 6, route: 0 } ],
    [ { type: 'gargoyle', count: 12, gap: 0.8, delay: 0, route: 0 }, { type: 'murloc', count: 12, gap: 0.6, delay: 1, route: 2 } ],
    [ { type: 'orc', count: 12, gap: 1.3, delay: 0, route: 0 }, { type: 'ghoul', count: 12, gap: 0.9, delay: 2, route: 1 } ],
    [ { type: 'gargoyle', count: 10, gap: 0.8, delay: 0, route: 0 }, { type: 'orc', count: 8, gap: 1.4, delay: 2, route: 1 }, { type: 'ghoul', count: 10, gap: 0.9, delay: 4, route: 2 } ],
    [ { type: 'orc', count: 14, gap: 1.2, delay: 0, route: 0 }, { type: 'gargoyle', count: 8, gap: 0.8, delay: 2, route: 1 }, { type: 'ghoul', count: 12, gap: 0.8, delay: 4, route: 2 } ],
    [ { type: 'ghoul', count: 10, gap: 0.9, delay: 0, route: 1 }, { type: 'gargoyle', count: 6, gap: 0.8, delay: 3, route: 2 }, { type: 'lichking', count: 1, gap: 1, delay: 8, route: 0 } ]
  ],

  // 波次血量成长
  hpMult(wave) { return 1 + (wave - 1) * 0.15; },
  // 提前召唤下一波的积分奖励
  callBonus(secondsLeft) { return Math.ceil(secondsLeft * 2); },
  // 通关波次奖励
  waveBonus(wave) { return 12 + wave * 3; },

  // ============ 关卡（20 波拆为 4 关，打完一关暂停结算再开下一关）
  // scene: SCENES 主题；routes: 启用前几条进攻路线（1/2/3）
  LEVELS: [
    { name: '第一关 · 兽人先锋',   from: 1,  to: 5,  scene: 'forest',   routes: 1 },
    { name: '第二关 · 亡灵大军',   from: 6,  to: 10, scene: 'swamp',    routes: 2 },
    { name: '第三关 · 燃烧军团',   from: 11, to: 15, scene: 'tundra',   routes: 3 },
    { name: '第四关 · 巫妖王之怒', from: 16, to: 20, scene: 'icecrown', routes: 3 }
  ],
  // 整关通关的积分奖励
  levelBonus(level) { return 60 + level * 40; }
};
