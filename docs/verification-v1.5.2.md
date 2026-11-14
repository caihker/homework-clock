# v1.5.2 阶段 4 第二批：DOM/时间轴拆分与 CSS token

2026-11-14（北京时间）。本版继续阶段 4（可维护性），把渲染层从 `app.mjs` 拆出，并做第一批 CSS 变量收敛；不改变产品行为。

## 完成内容

### 抽出 `dom.mjs`

- DOM 查询（`$`/`$$`）、文本转义、SVG 图标表与渲染、分类图标、`setIcons`/`setCategoryIcons` 从 `app.mjs` 移入 `dist/dom.mjs`。
- `app.mjs` 不再维护 30 余个图标路径字符串，只导入需要的 DOM 能力。

### 抽出 `timeline-view.mjs`

- 时间轴列表、空态、现在标线、下一项标记、完成/编辑按钮，以及「记事」列表渲染移入 `dist/timeline-view.mjs`。
- 通过工厂注入 `$`、`icon`、`escape`、`categoryIcon`、类型标签、时间/进度辅助函数与状态读取器；渲染不直接依赖模块级全局状态。
- `notesForDate()` 收敛到 `store.mjs`，时间轴渲染与「复制这一天」共用同一筛选逻辑。
- 新增 `timeline-view.test.mjs` 3 项 fake-DOM 测试：当前项/下一项/空闲/现在标线、空态与筛选空态、记事渲染与空态。

### CSS token 第一批

- 新增语义变量：设置页青绿系（`--teal`、`--teal-soft`、`--teal-line`）、`--blue-ink`、`--track`、`--amber`、`--danger`、`--shadow-card`、`--shadow-control`。
- `settings.css`、`pwa.css` 中硬编码颜色与 `styles.css` 中重复阴影改为变量；补上此前未定义的 `--green` 使用路径。
- 未做全量字号/圆角/间距 token 化，留待后续。

## 发现与修复（本轮内）

- 第一轮拆分时 `timeline-view` 漏传 `nowMarkerIndex`，导致启动在渲染前抛错，错误兜底条出现、时间轴为空。已改为视图模块内部导入该纯函数，并由 3 项渲染测试与页面截图复核；`npm test` 与浏览器截图均通过。

## 验证

- 自动检查 **246 项，失败 0、跳过 0**（新增时间轴/记事 fake-DOM 3 项）。
- `npm run build` / `npm run check` / `node scripts/check-version.mjs` 通过；构建版本 `98c802f0c80e3d1aeeda`。
- 离线清单 **59 项 / 5.1 MB**（新增 `dom.mjs`、`timeline-view.mjs`）。
- 浏览器截图：[首页](previews/v1.5.2-home.png)、[家庭设置](previews/v1.5.2-settings.png)；图标、时间轴、现在标线、记事、设置页颜色均正常。
- `app.mjs` 约 1012 行，仍是状态与事件控制层；本次只抽走了 DOM/渲染约 100 行。

## 未完成（阶段 4 后续）

- 继续拆 `app.mjs`：`render.mjs`（时钟/陪伴/总结）、`controller.mjs`（任务/设置/备份动作），入口只做装配。
- CSS 全量 token 与跨文件重复选择器合并。
- 更多 DOM 行为自动化测试（当前为 fake-DOM + 截图）。
- 真机 iPad 验收。

## 局限

- 本批未改数据格式、离线策略与交互；回退到 v1.5.1 不影响本机数据。
- 截图来自本机 Chrome 无头模式，非 iPad Safari。
