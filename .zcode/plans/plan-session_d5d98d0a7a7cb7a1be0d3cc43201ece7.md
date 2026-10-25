# 四英雄主动群攻技能

## 设计概览
- 四位英雄各获得一个**专属主动技能**：以英雄坑位为中心的大范围爆发（英雄固定在城墙上，与圣骑士现有奉献冲击同模式，半径 10~12，远大于普攻）。
- **手动触发**：屏幕底部常驻技能栏，4 个按钮按站位 1-4 排列（技能图标 + CD 遮罩倒计时），点击施放，**键盘 1-4 快捷施放**。
- **CD**：每英雄独立冷却（16~20s），随游戏时间流动（受暂停/倍速影响，与现有攻击冷却一致）；CD 中按钮禁用并显示倒计时。
- 伤害全部走现有 `damageEnemy()` → 自动获得暴击、护甲减免、飘字、击杀经验归属该英雄；伤害乘牧师光环（与普攻一致）。
- 复用现有"蓄力-释放"机制（`castT`/`pending`，动作 58% 处结算）与 FX 特效对象池，数值随英雄等级自动成长（乘当前等级 dmg/dot）。

## 各英雄技能（数值放 config.js 便于调参）
| 英雄 | 技能 | 机制 |
|---|---|---|
| 亡灵法师 | ❄ 冰霜新星 (CD 16s, 半径10) | 大范围冰爆 + **强制减速 50%/3s**（区别于普攻的概率减速） |
| 暗夜精灵猎人 | ☄ 箭雨 (CD 20s, 半径12) | 范围内每个敌人从天而降一支强箭（复用追踪投射物系统） |
| 人类圣骑士 | 💥 圣光风暴 (CD 18s, 半径11) | 大范围圣光冲击 + **眩晕 1.2s**（普攻是小范围短眩晕） |
| 血精灵牧师 | 🔮 暗言术：灾 (CD 20s, 半径10) | 暗影爆发直伤 + 附加强力持续掉血 DoT |

伤害 = 当前等级 dmg（牧师用 dot）× `dmgMult`（法师 2.5 / 猎人 2.0/箭 / 圣骑 2.2 / 牧师 1.5 直伤 + 1.2 倍 DoT），首版数值，均可后续在 config.js 调。

## 文件改动

**js/config.js** — 每个英雄 `TOWERS[type]` 增加一个 `skill` 块，例如：
```js
mage: { ..., skill: { name:'冰霜新星', icon:'❄', cd:16, radius:10, dmgMult:2.5, slow:0.5, slowDur:3, desc:'大范围冰爆，重创并强制减速范围内所有敌人' } }
```
（hunter 带 `dmgMult`；paladin 带 `stun`；priest 带 `dotMult`）

**js/main.js**
1. `HINT_DEFAULT`（:2）加"1-4：英雄技能"提示。
2. `_placeHeroes`（:202）tower 对象加 `skillCd: 0`。
3. `_updateTowers`（:703 附近）每帧 `t.skillCd = Math.max(0, t.skillCd - dt)`。
4. 新增 `castSkill(type)`：`phase !== 'wave'` 时 toast 提示；`paused`、CD 中、普攻蓄力中（`t.pending` 存在）时忽略；否则设 `t.skillCd = sk.cd`、`t.castT = castDur`、`t.pending = { skill:true, mult: this._auraMult(...) }` 并播施法音效。
5. `_releaseShot`（:768）开头加 `if (p.skill) { this._releaseSkill(t, lv); return; }`。
6. 新增 `_releaseSkill(t, lv)`：以 plot 为中心按 type 分支——法师双层 FX.ring + groundGlow + burst + light，遍历半径内 `damageEnemy` + `_applySlow(e, sk)`（skill 块自带 slow/slowDur 字段可直接复用）；猎人每敌一条 `FX.projectile` 从其上空 9 单位处落下，onHit 结算伤害；圣骑士放大版奉献特效（pillar + 双层 ring + groundGlow + light + punch）+ 眩晕 `e.stunUntil = time + sk.stun`；牧师 FX.pillar + ring 紫色 + 直伤 + push DoT（沿用普攻的 4 层上限逻辑，src 'priest'）。
7. 主循环（:137 旁）加 `UI.updateSkillCds()`。

**index.html** — `#ui-root` 加 `<div id="skill-bar" class="hidden"></div>`；`#tower-panel` 的 `#tp-desc` 后加 `<div id="tp-skill"></div>`。

**js/ui.js**
1. `renderSkillBar()`：按 `g.order` 生成 4 个 `.skill-btn`（快捷键序号、技能 icon、名称、CD 遮罩、CD 秒数文本），点击 → `g.castSkill(type)`；在 `startGame`/`nextLevel` 显示，`showArrange`/`showLevelScreen`/`showEnd` 隐藏。
2. `updateSkillCds()`：每帧同步各按钮遮罩高度、剩余秒数、就绪态 class（内容不变时跳过写 DOM，参照 `setEnv` 模式）。
3. `showTowerPanel` 填 `#tp-skill`（技能名 / CD / 描述）。
4. `_bind` keydown（:126）加 `1-4` → `g.castSkill(g.order[k-1])`。

**css/style.css** — `.skill-bar`（底部居中横排）、`.skill-btn`（金边面板质感 + 英雄 clsColor 描边）、`.skill-cd-mask`（自底向上高度遮罩）、`.skill-cd-text`、就绪态微光 pulse 动画。

## 验证
1. `python3 -m http.server 8123` 起本地服务。
2. 用 browser-use 技能做 GUI 黑盒验证：开始游戏 → 召唤第 1 波 → 依次点击按钮与按 1-4 施放四英雄技能 → 截图确认特效播放、敌人掉血/减速/眩晕、CD 遮罩倒计时与禁用态、CD 结束恢复可用；布阵与结算界面技能栏正确隐藏。
   （注：evaluate 需用 IIFE；窗口被遮挡时 rAF 可能暂停，必要时手动步进兜底。）