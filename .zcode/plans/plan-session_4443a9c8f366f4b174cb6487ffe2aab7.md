# 英雄建模打磨 + 技能光影特效

## 现状诊断（为什么会"素"）
- **材质单一**：全是纯色 `MeshLambertMaterial`（world.js:2-11 缓存工厂），无高光、英雄身上 emissive 全为 0，发光件是"死"的 MeshBasicMaterial 纯色，且无 Bloom 后处理，辉光出不来。
- **模型是死的**：`main.js:443` 恒传 `moving=0`，猎人和圣骑的待机动画全部被归零（猎人 100% 静止）；攻击无任何动作，弹道从身体固定锚点（main.js:447）而非武器发出。
- **技能无光照**：FX 只有粒子/冲击环/飘字（effects.js，269 行），无点光闪光、无地面光斑；r147 的 Lambert 是逐顶点光照，地面大平面用点光也照不亮——需换逐片元 Phong。
- 已知顺手修复项：`FX.update` 被 main.js:71 的 phase 条件挡住（升级特效在 inter 阶段冻结）；弹道 geometry 每发 new 不 dispose（effects.js:113-124）。

## 改动方案

### 1. Bloom 辉光后处理（用户已确认）
- 从 jsdelivr 下载 three@0.147.0 examples UMD 到 `js/lib/`（已验证存在）：`CopyShader.js`、`LuminosityHighPassShader.js`、`EffectComposer.js`、`RenderPass.js`、`ShaderPass.js`、`UnrealBloomPass.js`（共 6 个约 24KB，仍是本地文件零构建）。
- index.html 在 three.min.js 后、main.js 前加 6 个 script 标签（shader 两个在前）。
- main.js init 建 composer（RenderPass + UnrealBloomPass），主循环 `composer.render()`，resize 同步 `composer.setSize`。
- 参数放 `CFG.FX.bloom = { enabled, strength≈0.65, radius≈0.45, threshold≈0.62 }`，可整体关掉兜底性能。

### 2. 材质升级（world.js MatCache）
- `MatCache.get()` 内部改产 `MeshPhongMaterial`（specular 低、shininess 适中，emissive 参数保留）：逐片元光照让点光闪真正照亮地面/角色，金属件自然出高光，外观整体更"像样"。
- 新增 `MatCache.phong(color, opts)` 供需要 flatShading 的盔甲件用（低模棱面感）。
- characters.js:138 披风等内联 Lambert 一并转 Phong。

### 3. FX 新光影原语（effects.js）
- `FX.light(pos, color, {intensity, dist, life})`：8 盏 PointLight 对象池（FX.init 时全部以 intensity=0 加入，避免运行时 shader 重编译），快起慢落的施法/命中闪光——"光影"的核心。
- `FX.groundGlow(pos, color, radius, life)`：加色径向渐变地面光斑贴花池（复用 glowTexture），命中区域/奉献圈。
- `FX.flash(pos, color, scale, life)`：大光晕 sprite 快闪（施法口/命中点）。
- 弹道增强：共享 geometry 修泄漏；arrow 也加稀疏拖尾 + 箭头加光晕；frost/shadow 弹头光晕加大。
- 生命周期全部挂进现有 `FX.update(dt)`，无架构改动。

### 4. 英雄建模打磨（characters.js，4 个 builder）
通用：武器/发光件加 makeGlow 光晕 + emissive 点缀（配 Bloom 真泛光）；给 4 位英雄加简单手臂（法师/牧师袍袖圆锥、猎人皮护腕、圣骑金属臂甲），武器从"漂浮"改为"握在手里"。
- **法师**：法袍加冰蓝 emissive 符文饰带、肩甲加冰棱、法杖水晶加光晕。
- **猎人**：发光绿眼、弓上搭一支待发箭（射出时隐藏）、箭袋箭羽两色、宠物加项圈发光眼。
- **圣骑**：盾面金狮徽记（emissive）、锤头金纹发光、披风金边、盔顶冠刺、面甲缝发光眼。
- **牧师**：头顶悬浮金色光环、法杖顶球加光晕、法球各自加微光、袍子金线镶边。
- 待机动画修活：不再被 moving=0 归零（猎人弓微颤/宠物摆尾、圣骑锤 idle 摆动保留），每个英雄站桩都有生命感。

### 5. 施法动作 + 武器锚点（用户已确认包含）
- 机制：`anim(t, moving, castK)` 增加 castK 进度参数（main.js 施法时置 `t.castT`，每帧算出 0→1 传入），姿势曲线在 builder 内实现：
  法师举杖前指蓄力、猎人拉弓放箭、圣骑抡锤过顶下砸、牧师举杖+法球收拢再散开。
- 弹道改从武器尖发出：builder 存 `head.userData.castAnchor`（局部坐标），main.js:447 用 `localToWorld` 换算（自动跟随 `_faceHead` 转向和等级缩放）。

### 6. 技能光影接线（main.js 四个施法分支）
- **寒冰箭**：施法 flash+light（杖尖冰蓝）；命中 light + 冰霜地面光斑（splash 范围）+ 粒子加强。
- **快速射击**：弓口微闪；命中火花 burst + 弱 light。
- **奉献冲击波**：锤砸地瞬间强金 light + 大金地面光斑 + 双层冲击环 + 短暂金色光柱。
- **暗言术**：施法暗紫 light；命中暗紫光斑 + burst；DoT 期间目标身上低频冒暗影粒子。
- 升级特效随 `FX.update` 门控修复（移出 main.js:71 phase 条件）自然生效。

### 7. config.js
新增 `CFG.FX` 区块集中管理 bloom 参数、施法时长、光影强度（沿用数值集中 config 的约定）。

## 验证（沿用 IAB 测试技巧）
1. `python3 -m http.server` + 应用内浏览器，reload 后默认机位先截 4 英雄特写对比。
2. evaluate（IIFE）把敌人放进射程/清零冷却，逐技能截帧验证光影与施法动作。
3. 快进一整局确认无 console 报错、帧率正常；验证 build/inter 阶段特效不再冻结。
4. 关掉 `CFG.FX.bloom.enabled` 再看一眼兜底可用；测完 reload 还原干净状态。

## 改动量
characters.js +~250 行、effects.js +~180 行、main.js +~60 行、world.js +~20 行、config.js +~15 行、index.html +6 行、js/lib/ 新增 6 文件。不引入构建工具、不改架构、不动敌人/关卡数值。