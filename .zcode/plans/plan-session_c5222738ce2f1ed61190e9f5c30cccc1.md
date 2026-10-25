# TD-Game 场景 / 昼夜 / 天气 / 迷雾 / 多路怪物 实施方案

## 设计决策（已确认）
- **迷雾**：氛围雾气（纯视觉），黎明/夜晚地面飘雾 + 浓雾天气降低能见度，不改索敌。
- **多路**：多入口汇合同一城门。每条路线独立黑暗之门（西/北/南），全部涌向暴风城大门；第 1 关 1 路 → 第 2 关 2 路 → 第 3/4 关 3 路。4 英雄坑位与漏怪逻辑不变。
- **昼夜**：连续循环（150 秒/昼夜，太阳方位与影子和天空/雾色渐变），第四关锁定永夜。
- **天气**：轻度影响玩法，数值全部进 config.js（可调成 0 退化为纯视觉）。

## 四关场景规划
| 关卡 | 场景主题 | 地面/植被 | 入场时刻 | 天气池 | 路线数 |
|---|---|---|---|---|---|
| 1 兽人先锋 | 翠绿林地 | 现状绿草地+松树 | 8:00 | 晴70%/雨30% | 1 |
| 2 亡灵大军 | 暮色沼泽 | 墨绿泥地+枯树 | 14:00 | 雨50%/雾30%/晴20% | 2 |
| 3 燃烧军团 | 霜雪平原 | 雪地+雪松 | 17:00(入夜) | 雪60%/晴40% | 3 |
| 4 巫妖王之怒 | 冰封王座 | 冰蓝冻土+冰晶 | 锁定 21:00 永夜 | 雪/暴雪/雾 | 3 |

## 文件改动

### 1. js/config.js（数值全在这里）
- 新增 `CFG.SCENES`（4 主题）：`name / ground / groundPatches / pathTiles / treeType(pine|dead|snowPine|ice) / rockColors / timeStart / timeLock / weatherPool / groundMist`。
- 新增 `CFG.ENV`：`DAY_LENGTH: 150` + 昼夜关键帧数组（t=0/5/7/12/18/20.5/24 各给 sky、fog、hemi 强度、太阳颜色/强度），关键帧之间 lerp。夜段太阳光变暗蓝月光。
- 新增 `CFG.WEATHER`：`rain / snow / blizzard / mist / clear` 各自带 `label / count / fall / fogNear / gameplay{towerRangeMult, enemySpeedMult}`（如雪天地面怪速度 ×0.88、雨天塔射程 ×0.92，飞行单位不受雪减速）+ `TRANSITION: 5` 淡入淡出秒数 + 雨天闪电开关。
- 新增 `CFG.ROUTES`：3 条路线。主路 = 现有 `CFG.PATH` 12 点（保留，`PATH` 字段改为引用它）。北路约 `[-16,-18]→[-16,-11]→[-7,-11]→[-7,-15]→[1,-15]→[1,-9]→[8,-9]→[8,-14]→[16,-14]→[16,-5]→[20,-5]→[20,0]→[24,0]`，南路为其 z 取镜像。均避开 4 个英雄坑位、与主路保持 ≥3 距离、终点汇合 (24,0)。
- `CFG.LEVELS` 每关增加 `scene: 'forest'|'swamp'|'tundra'|'icecrown'` 和 `routes: 1|2|3`。
- `CFG.WAVES` 第 6 波起给每组加 `route: 0|1|2` 字段（组级指派，如波 17-19 三组分走三路；巫妖/火魔王/巫妖王走主路）。缺省的组按当前关路线数轮转分配。数量维持现状，实测后只在 config 微调。

### 2. 新文件 js/environment.js（Env 对象；index.html 在 world.js 后、main.js 前引入）
- **昼夜**：`Env.init(scene)` 存 `scene`/`World.hemi/sun` 引用；`Env.update(dt)` 推进 `time`（受游戏暂停与倍速影响），按关键帧 lerp 并应用到 `scene.background`、`scene.fog.color/near/far`、半球光与方向光颜色强度。太阳方位随时刻旋转（阴影会动），高度按 sin 曲线，夜里切换为月光路径；加太阳/月亮辉光精灵（复用 `FX.glowTexture`）与 ~260 颗星星 Points（夜晚淡入）。`World.nightFactor` 供火炬/传送门夜光增益。
- **天气**：独立于 FX 粒子池，各建专属 `THREE.Points`：雨 ~800 点（竖条 canvas 纹理、下落 26/s、normal 混合）、雪 ~450 点（复用 `FX.snowTexture`、慢飘+左右摆动）。粒子围绕相机注视点半径 45 的范围循环降落。地面雾：10~14 块大尺寸低透明度辉光贴片贴地缓慢漂移（雾天气/沼泽/冰封关常驻薄雾）。
- **天气调度**：`Env.rollWeather(wave)` 在每波开始时按当前关 `weatherPool` 加权抽取（不连续重复），5 秒淡入淡出；雾/暴雪天气把 `scene.fog.near` 目标值拉近（如 38/45）。雨天随机闪电（背景闪白 + 方向光强度尖峰，纯视觉）。
- **玩法接口**：`Env.play = { towerRangeMult, enemySpeedMult }` 随天气过渡插值，供 main.js 读取。
- `Env.setScene(theme)`：设置 timeStart/timeLock/天气池/常驻雾。

### 3. js/world.js（场景可重建 + 多路线）
- `_lights`：把 hemi、sun 存为 `this.hemi/this.sun`（昼夜系统需要）。
- 环境网格全部收进 `this.envGroup`；新增 `World.rebuild(levelIdx)`：读取当前关 `SCENES` 主题与 `routes` 数，traverse 释放几何体（MatCache 共享材质打 `userData.cached` 标记、不释放），重建地面色块/石板路/装饰/传送门。
- `_path` 遍历 `this.tracks`（每条路一个 `PathTrack`，主路保留 `this.track` 别名）逐路铺石板；`_darkPortal` 重构为接受位置与朝向参数，每条路一个传送门（粒子数据按实例存 `this._portalFx` 数组）；出生点 = 各路线 `pointAt(0)`。
- `_decor` 的避让函数改为对所有 track 求 `distTo` 最小值；树/岩石按主题 `treeType`/`rockColors` 构建四种变体（松树=现状、枯树=枝干、雪松=白色锥顶、冰晶=半透明冰蓝锥）。
- `World.update`：火炬/传送门灯光强度乘 `1 + nightFactor` 增益；多传送门粒子循环更新。
- 英雄坑位 `_plots`、暴风城大门保持一次构建不参与重建（`nextLevel` 重建只换环境层，英雄无需重放）。

### 4. js/main.js
- `Game.init`：删掉写死的 fog 参数（由 Env 接管）；`World.init` 后调 `Env.init` + `Env.setScene`。
- 主循环：`World.update`/`Env.update` 移出 wave 限定条件，在未暂停的所有阶段运行（布阵/结算时天气与昼夜也流动，与 FX.update 行为一致）。
- `_startWave`：spawnQueue 条目带 `route`（组缺省则按关卡路线数轮转）；开波时 `Env.rollWeather(wave)`，横幅带天气如「⚔ 第 7 波来袭 · 大雪」；解锁新路线的波次横幅提示「新路开启：北路黑暗之门！」。
- `_spawnEnemy(type, mult, routeIdx)`：按 `World.tracks[routeIdx]` 出生，敌人对象存 `track` 引用与 `progress = dist/track.length`；出生时在该传送门处给一次粒子爆发+门光脉冲。
- `_updateEnemies`：改用 `e.track`（删全局 track）；雪天 `enemySpeedMult` 只乘地面单位；`_leak` 用 `e.track` 终点做漏怪特效位置。
- `_findTarget`：射程乘 `Env.play.towerRangeMult`；「最靠前」判定由 `e.dist` 改为 `e.progress`（多路长度不同，dist 不可跨路比较——重要正确性修正）。
- `nextLevel()`：先 `World.rebuild` + `Env.setScene` 再进入 build 阶段。
- 调试热键（README 说明）：`T` 时刻 +4h、`W` 切换天气，便于演示与自动化验证。

### 5. js/ui.js + index.html + css/style.css
- 顶栏加一个小状态片：天气图标/文字 + 昼夜时钟（如「🌧 雨 · 14:00」），`UI.setEnv()` 每秒级更新。
- 关卡结算/开场画面加一句场景与天气氛围文案；样式沿用现有 DOM overlay 模式，`#ui-root` 内加一个 span 即可。

## 验证方案
1. 浏览器自动化（IAB）加载游戏，evaluate（IIFE）调 `Env.setTime`/`Env.setWeather`/调试热键逐项截屏：白天/黄昏/夜晚/雨/雪/暴雪/雾/闪电。
2. 直接把 `state.wave` 推到 6/11/16 验证 2 路/3 路出生与路线解锁横幅；统计各 `e.track` 数量分布。
3. 验证 `_findTarget` 按 progress 选目标；雪天地面怪减速、飞行怪不受影响；雾天能见度变化但不影响索敌。
4. 打完第 5 波走 `nextLevel`：确认场景重建无报错、无几何体泄漏（内存/对象数对比）、英雄保持原级。
5. 满天气 + 夜晚 + Boss 波压测帧率；`CFG.FX.bloom.enabled=false` 回退直渲也过一遍。

## 不做的事
- 不引入构建工具/模块化（保持 script 全局 + UMD three r147）。
- 不做战争迷雾/隐身索敌（Q1 已选氛围雾气）。
- 不改 4 英雄坑位布局与城门位置；不做场景中途动态切换（仅关卡切换时重建）；重开一局仍是 location.reload()。
