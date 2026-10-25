# 塔防改造：降城墙 · 4 坑位英雄布阵 · 关卡+积分升级

## 目标流程（改后）
打开游戏 → **英雄布阵界面**（4 位英雄预站在城墙 4 个坑位上，点两张卡交换站位）→「开始第 1 关」→ 关内 5 波（波间保持现有 14s 间歇/可提前召唤）→ 打完第 5 波 → **关卡结算界面**（暂停：展示 4 张英雄技能/射程卡牌，用积分升级、可继续交换站位）→「开启下一关」→ …… → 第 4 关打完第 20 波 → 胜利结算。金币系统整体改名为**积分**（击杀、波次奖励、提前召唤奖励都发积分，仅用于关卡间升级英雄）。

## 1. `js/config.js`
- 新增 `const WALL_H = 3.4`（原 6.2 约一半）；`PLOTS` 改为 4 个：`[24.4, WALL_H, ±2.45], [24.4, WALL_H, ±3.55]`（门洞两侧各 2 座，同一水平线）。
- `TOWERS` 每个英雄：
  - 删除 `cost`（不再建造）与 `key`；`upgrades` 改为 3 档积分价格：mage `[90,160,260]`、hunter `[70,130,220]`、paladin `[110,190,320]`、priest `[120,200,340]`。
  - `levels` 各加第 4 档（对应 4 关成长）：mage `{dmg:96, range:16.0, rate:0.80, splash:2.8, slow:0.54, slowDur:2.8}`；hunter `{dmg:48, range:20.5, rate:0.28}`；paladin `{dmg:145, range:8.0, rate:1.15, stun:1.0}`；priest `{dot:160, range:13.2, rate:1.7, aura:0.65, auraRange:11.0}`。
- 新增 `LEVELS: [{name:'第一关 · 兽人先锋', from:1, to:5}, {name:'第二关 · 亡灵大军', from:6, to:10}, {name:'第三关 · 燃烧军团', from:11, to:15}, {name:'第四关 · 巫妖王之怒', from:16, to:20}]` 和 `levelBonus(lv){ return 60 + lv*40; }`。
- 经济改名：`START_GOLD:250` → `START_POINTS: 0`；`ENEMIES` 的 `gold` 字段 → `points`；删除 `SELL_RATIO`。`TOTAL_WAVES`、`WAVES`、`hpMult` 不动。

## 2. `js/world.js` `_stormwindGate()`（world.js:249-318）
- 墙体 `BoxGeometry(1.8, 6.2, 6.8)`@y=3.1 → `(1.8, WALL_H, 6.8)`@y=WALL_H/2；城垛 y 6.55 → WALL_H+0.35。
- 门柱高 5.0→WALL_H（y=WALL_H/2）；横梁 `1.4×1.0×5.3` y 5.4→WALL_H+0.5（净空 3.4 足够敌人通过）。
- 角楼圆柱高 9→5.6（y=2.8），锥顶/旗帜/旗杆按比例下移（roof≈6.9、flag≈8.6）。火炬、门组位置（x=24.2）不动。
- `_plots()` 无需改（自动按新 CFG.PLOTS 生成 4 个基座）。

## 3. `js/main.js`（核心状态机改造）
- 状态：`gold`→`points`；新增 `level: 1`、`order: ['mage','hunter','paladin','priest']`（站位顺序）；`phase` 初始 `'arrange'`，新增 `'inter'`（关卡结算）。
- 主循环守卫 `main.js:67`：`phase !== 'over' && phase !== 'inter' && phase !== 'arrange'` 时才更新逻辑（渲染继续）。
- 删除建造流：`setBuildMode/_removeGhost/_tryBuild/sellSelected`、幽灵预览、键盘 1-4 绑定、`towersBuilt/invested`；`_handleClick` 只保留「点英雄→选中看属性/射程圈」，`phase` 为 arrange/inter 时直接 return。
- 新增 `_placeHeroes()`：按 `order` 在 4 个 plot 上创建 4 座英雄（免费、`_spawnTowerMesh` 复用），开局预览与最终布阵都用它（交换站位时重摆即可）。
- 关卡流转 `_updateWaves`（main.js:325-335）：波次打完时 — wave≥20 → 胜利；wave === 当前关 `to` → 发 `levelBonus` 积分、`phase='inter'`、弹结算界面；否则走原有 14s 间歇。
- 新增 `upgradeHero(type)`（积分支付、`level++`、重建模型+特效，供结算界面调用）、`nextLevel()`（`level++`、`phase='build'`、`waveTimer=Infinity` 手动开波）。
- `_startWave` 的 Boss 横幅带上关名；`_gameOver`/`showEnd` 统计改为 坚守关卡/消灭敌人/剩余积分。
- 键盘：保留空格（下一波）、P（暂停，inter/arrange 下禁用）、Esc；去掉 1-4。

## 4. `js/ui.js` + `index.html` + `css/style.css`
- 删除底部建造卡栏 `#hero-bar`、`#card-tip` 及相关 CSS/逻辑。
- 新增两个全屏遮罩（复用 `#end-screen` 的 fixed+blur 模式与 `wow-panel`）：
  - `#arrange-screen`：标题+说明+**4 张小队卡**（按站位顺序）+「开始第 1 关」按钮。卡面：头像/名字/定位/技能描述（`desc`）/当前等级与含射程的属性行（`statLine`）。
  - `#level-screen`：标题「第 X 关 完成！」+ 积分余额 + 同一套 4 张小队卡（多一个 `⬆ 升级 🏅N` 按钮，满级/积分不足禁用）+「开启第 X+1 关」按钮。
  - **交换站位**：两屏共用——点击两张卡即交换 `order` 并重摆 3D 模型（选中卡金色描边高亮）。
  - 样式新增 `.squad-card`（约 4 列网格）、`.slot-tag`（站位序号）、`.up-btn`、`.swap-sel`，配色沿用现有金/蓝魔兽风。
- HUD：金币图标 🪙→🏅、文案「金币」→「积分」；`setWave` 改为显示「第 X 关 · 波 Y/5」；提示条文案更新为「点击英雄查看技能与射程 …」。

## 5. 收尾
- README.md 同步新玩法描述。
- 浏览器实测（localhost + 截图）：布阵交换、开局 4 英雄就位、降低后的城墙视觉、第 5 波后结算升级（积分扣减/模型变化/射程圈）、下一关流转；用 evaluate(IIFE) 快进波次验证到第 20 波胜利；第 2/3/4 关 Boss 横幅正常。

## 明确不做（保持零依赖、不引构建工具）
- 不加主动技能/冷却系统（技能仍是英雄的自动攻击特效，卡牌上做描述展示）。
- 不做积分 localStorage 持久化（刷新重开即重置，后续可加）。
- 数值平衡只做粗调（全部 tunable 收在 config.js，实测后再微调）。