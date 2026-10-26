# 计划：全怪物血量/防御强化 + 每小怪组新增精英怪

## Summary

1. 所有怪物（含 Boss）血量上限 ×1.5、护甲（防御）统一 +0.10。
2. 每个小怪组（`CFG.WAVES` 中每个 group）在组内最后追加 1 只精英怪：血量与护甲为强化后普通怪（小怪）的 2 倍；外观为同模型 + 红色光晕 + 体型 ×1.15 + 更宽血条。
3. Boss 组（第 10/15/20 波的纯 Boss 组）不加精英，保持原样（用户已确认）。

## Current State Analysis

- 怪物基础数值在 [config.js](file:///Users/jackwu/Documents/TD-Game/js/config.js#L242-L251) `CFG.ENEMIES`：`hp`、`armor`（伤害减免百分比，目前仅 orc 0.25 / lich 0.15 / abyssal 0.30 / lichking 0.30 有，其余小怪为 0）。
- 波次血量成长：[config.js](file:///Users/jackwu/Documents/TD-Game/js/config.js#L292) `CFG.hpMult(wave)`（与本次改动正交，保持不动）。
- 出怪队列构建：[main.js](file:///Users/jackwu/Documents/TD-Game/js/main.js#L428-L461) `_startWave()` 遍历 `CFG.WAVES[w-1]` 各组，按 `count × gap` 逐只 push 进 `spawnQueue`。
- 生成敌人：[main.js](file:///Users/jackwu/Documents/TD-Game/js/main.js#L505-L559) `_spawnEnemy(type, mult, route)`，`hp: cfg.hp * mult`，`cfg` 引用共享配置对象。
- 护甲生效点：[main.js](file:///Users/jackwu/Documents/TD-Game/js/main.js#L630) `damageEnemy()` 中 `dmg = amount * (1 - (e.cfg.armor || 0))` —— 唯一使用点（ui.js 不展示怪物面板）。
- 夜光光晕：`FX.makeGlow(colorHex, scale, boost)`（[effects.js](file:///Users/jackwu/Documents/TD-Game/js/effects.js#L143-L151)），精英可复用换红色。

## Proposed Changes

### 1. js/config.js — 新增两个全局配置块（放在 `ENEMIES` 之后、`ENEMY_GLOW` 之前）

```js
// ============ 全局难度强化：所有怪物（含 Boss）血量×1.5、护甲+0.10 ============
ENEMY_BUFF: { hpMult: 1.5, armorAdd: 0.10 },
// ============ 精英怪：每个小怪组末尾追加 1 只，血量/护甲为强化后普通小怪的 2 倍 ============
ELITE: { hpMult: 2, armorMult: 2, scale: 1.15, haloColor: 0xff3a2a, haloOpacity: 0.55, haloScale: 2.2 },
```

改动理由：数值集中可调，不重写 8 行 ENEMIES 基础表（最小改动、便于回滚）。

### 2. js/main.js — `_startWave()`：每个非 Boss 组追加精英出怪项

在组内循环 push 完普通怪后（约 [main.js#L435-L441](file:///Users/jackwu/Documents/TD-Game/js/main.js#L435-L441)）：

```js
for (const grp of def) {
  const route = grp.route !== undefined ? grp.route : (rr++ % (lv.routes || 1));
  for (let i = 0; i < grp.count; i++) {
    this.spawnQueue.push({ type: grp.type, at: grp.delay + i * grp.gap, mult, route });
  }
  // 精英怪：小怪组末尾压阵 1 只（Boss 组不加）
  if (!CFG.ENEMIES[grp.type].boss) {
    this.spawnQueue.push({ type: grp.type, at: grp.delay + grp.count * grp.gap, mult, route, elite: true });
  }
}
```

精英出场时点 = 该组最后一只普通怪之后（`delay + count × gap`），与组同路线。

### 3. js/main.js — `_spawnEnemy(type, mult, route, elite)`：应用全局强化与精英倍率

```js
_spawnEnemy(type, mult, route = 0, elite = false) {
  const cfg = CFG.ENEMIES[type];
  const buff = CFG.ENEMY_BUFF;
  const hp = cfg.hp * mult * buff.hpMult * (elite ? CFG.ELITE.hpMult : 1);
  const armor = Math.min(1, ((cfg.armor || 0) + buff.armorAdd) * (elite ? CFG.ELITE.armorMult : 1));
  const scale = cfg.scale * (elite ? CFG.ELITE.scale : 1);
  mesh.scale.setScalar(scale);
  mesh.userData.baseScale = scale;
```

- 敌人记录（约 [main.js#L548-L558](file:///Users/jackwu/Documents/TD-Game/js/main.js#L548-L558)）新增字段：`hp: hp, maxHp: hp, armor, elite`（护甲必须存到实例上，因 `cfg` 为共享配置，不同怪 armor 不同）。
- 血条宽度：`const bw = cfg.boss ? 1.7 : elite ? 1.35 : 1.0;`
- 光晕改为精英专属红色：

```js
const halo = elite
  ? FX.makeGlow(CFG.ELITE.haloColor, CFG.ELITE.haloScale, 1.0)
  : FX.makeGlow(glowCfg.colors[type] || glowCfg.color, cfg.boss ? glowCfg.haloBoss : glowCfg.halo, 1.0);
halo.material.opacity = elite ? CFG.ELITE.haloOpacity : glowCfg.haloOpacity;
```

### 4. js/main.js — 调用点与护甲生效

- `_updateWaves()` 出怪处（[main.js#L476](file:///Users/jackwu/Documents/TD-Game/js/main.js#L476)）：`this._spawnEnemy(s.type, s.mult, s.route || 0, s.elite);`
- `damageEnemy()`（[main.js#L630](file:///Users/jackwu/Documents/TD-Game/js/main.js#L630)）：`const dmg = amount * (1 - (e.armor || 0));`

## 强化后数值表（波次倍率 hpMult(wave) 之外的基础值）

| 怪物 | 原 hp | 新 hp | 原护甲 | 新护甲 | 精英 hp | 精英护甲 |
|---|---|---|---|---|---|---|
| 鱼人 | 32 | 48 | 0 | 0.10 | 96 | 0.20 |
| 野猪 | 60 | 90 | 0 | 0.10 | 180 | 0.20 |
| 食尸鬼 | 92 | 138 | 0 | 0.10 | 276 | 0.20 |
| 石像鬼 | 52 | 78 | 0 | 0.10 | 156 | 0.20 |
| 兽人步兵 | 185 | 277.5 | 0.25 | 0.35 | 555 | 0.70 |
| 巫妖(Boss) | 560 | 840 | 0.15 | 0.25 | — | — |
| 深渊火魔王(Boss) | 1500 | 2250 | 0.30 | 0.40 | — | — |
| 巫妖王(Boss) | 3400 | 5100 | 0.30 | 0.40 | — | — |

## Assumptions & Decisions

- 精英怪积分/经验与基础类型一致（需求未提及，不改动；如需加倍后续可在 `_killEnemy` 调整）。
- 精英怪速度与普通怪一致；每小怪组固定 +1 只精英。
- 精英组队压阵（组内最后出场），不先头开路。
- 毒/暗言术 DoT 本就无视护甲，对精英同样生效，仅因血量翻倍而耗时更久。
- 全局强化同样作用于 Boss（用户确认"所有怪物"）；Boss 组不加精英。
- 精英护甲按"强化后普通护甲 ×2"计（兽人精英 0.70 即减伤 70%，属需求本义，数值表已列明供确认）。

## Verification

1. 浏览器打开 `index.html`，进入第 1 波：应出现 6 只鱼人 + 1 只红色光晕、体型更大、血条更宽的精英鱼人；精英掉血速度约为普通 2 倍耐打；普通鱼人伤害飘字 ≈ 命中的 90%（护甲 0.10），精英 ≈ 80%。
2. 提前打到第 10 波：巫妖血量 840 × 波次倍率、护甲 0.25，且巫妖组无精英。
3. 任一小怪组精英与组内普通怪同路线、最后出现；击杀精英积分 +8（鱼人组）正常入账，漏怪扣血正常。
4. 浏览器控制台无报错；减速/毒/暴击表现正常（减速染色与红色光晕不冲突，精英死亡后光晕随 mesh 一并移除）。
