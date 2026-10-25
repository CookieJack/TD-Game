## 目标

鼠标进入游戏页面后，光标变成一把剑。UI 按钮（开始波次、卡牌、购买按钮等）保留原有的 `pointer` / `not-allowed` 小手。

## 方案

项目零依赖、无图片资源，因此不引入任何外部文件：用离屏 canvas 在运行时画一把 32×32 的剑，导出 PNG data URI 设为 CSS `cursor`（PNG 光标所有浏览器都支持，包括 Safari；SVG 光标在 Safari 上不可靠所以不用）。

**改动只涉及 `js/main.js` 一个文件：**

1. 新增模块级辅助函数 `makeSwordCursor()`：
   - 32×32 离屏 canvas，用 2D API 绘制 45° 斜置奇幻剑：剑尖朝左上 (3,3)，银白渐变剑刃 + 金色护手和柄头 + 棕色握柄，加深色描边和轻微投影保证在明亮地形上可见。
   - 返回 `` `url(data:image/png;base64,...) 3 3, auto` ``，热点 (3,3) 在剑尖——点击落点与系统箭头一致，`auto` 作兜底。
2. `Game.init()` 渲染器挂载后（main.js:31-36 附近）：`document.body.style.cursor = makeSwordCursor()`。

**行为效果：**
- 游戏是全屏的（`#game-container { position: fixed; inset: 0 }`），body 级设置即"整个游戏画面内都是剑"；
- `cursor` 可继承但子元素的显式规则优先，所以 `css/style.css` 里已有的 `.wow-btn`、`.squad-card`、`.buy-btn` 的 `pointer` 和 disabled 的 `not-allowed` 会自动覆盖剑形，无需改 CSS。

## 验证

1. `python3 -m http.server` 起本地服务，用浏览器自动化打开页面：
2. 检查 `getComputedStyle(document.body).cursor` 包含 `url("data:image/png`；
3. 把 data URI 解码成 PNG 文件目检剑的造型，不满意就地微调绘制代码；
4. 悬停画布区域确认剑形、悬停按钮确认仍是 pointer，控制台无报错。