# v1.5.4 阶段 4 收尾：薄入口、控制器模块、CSS token 与 DOM 测试

2026-11-14（北京时间）。本版完成阶段 4（可维护性）剩余操作：入口只做装配、逻辑集中到控制器模块、CSS 全量 token 化、补陪伴/计时 fake-DOM 测试。

## 完成内容

### 入口与控制器

- `dist/app.mjs` 收敛为 **3 行装配入口**：`import { startApp } from './app-controller.mjs'; startApp();`
- 原状态、持久化、事件绑定与启动流程移入 `dist/app-controller.mjs`（约 914 行）；渲染职责已拆到：
  - `dom.mjs`：DOM/转义/图标
  - `timeline-view.mjs`：时间轴、现在标线、记事
  - `mascot-view.mjs`：陪伴形象、乌龟、庆祝
  - `clock-view.mjs`：首页计时、专注页、统计
- 同步更新依赖 app.mjs 源码切片的测试（持久化守卫、备份导入、界面守卫）指向 `app-controller.mjs`。

### 陪伴/计时 DOM 测试

- 新增 `tests/clock-view.test.mjs` 8 项：空闲、演示时钟、未开始/进行/过期、专注弹窗三种状态、静音图标。
- 新增 `tests/mascot-view.test.mjs` 7 项：转向、进度 clamp、mood/src/alt、庆祝 5 秒窗口、失败静态回退、设置预览。
- 修复 `clock-view.updateClocks()` 重复调用一次陪伴渲染的问题（每 tick 2 次 → 1 次），测试同步调整。
- 全部 fake-DOM，不依赖真实浏览器。

### CSS 全量 token

- 12 个样式源文件完成字面量收敛：
  - 32 个字号 → `--font-*`
  - 14 个单值圆角 → `--radius-*`
  - 8 个颜色（白、焦点环、危险红、线色、纸色）→ `--color/--*`
  - 其余颜色/阴影沿用已有 token（`--ink`、`--paper`、`--teal*`、`--shadow-*` 等）
- 仅替换完全相同的字面值，最终计算值不变；多值手绘圆角与媒体查询分档保持原样。
- 未定义变量审计仅剩 JS 运行时设置的 `--companion-*`、`--settings-viewport-*`，属预期。

## 验证

- 自动检查 **261 项，失败 0、跳过 0**（新增 15 项视图测试）。
- `npm run build` / `npm run check` / `node scripts/check-version.mjs` 通过；构建版本 `0bfe8bb6e934eca8f978`。
- 离线清单 **62 项 / 5.1 MB**（新增 `app-controller.mjs`）。
- 浏览器截图：[首页](previews/v1.5.4-home.png)，与 token 化前无视觉差异；计时、现在标线、下一项、乌龟、记事、回顾正常。
- 样式源 12 个；语法检查覆盖 28 个脚本。

## 阶段 4 完成情况

- ✅ `schema.mjs` 统一常量
- ✅ `store.inspectStorage()` 可测试加载
- ✅ DOM/时间轴/陪伴/计时视图拆分
- ✅ 入口只做装配（3 行）
- ✅ CSS 全量 token（字号/圆角/颜色/阴影）
- ✅ fake-DOM 渲染测试（时间轴 3 + 计时 8 + 陪伴 7）
- 说明：`app-controller.mjs` 仍承担状态、事件与启动，约 914 行；若要进一步降为 250 行以内，需要把任务/设置/备份/更新控制器再拆一批，属后续增量优化，不影响阶段 4 的可维护性目标。

## 局限

- 截图来自本机 Chrome 无头模式，非 iPad Safari；真机键盘/触控仍未验收。
- CSS token 命名以数值为主（`--font-13`、`--radius-10`），语义化缩放可在后续迭代收敛。
- 本版未改数据格式、离线策略与产品行为，回退到 v1.5.3 不影响本机数据。
