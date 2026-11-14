# v1.5.1 阶段 4 第一批：schema、加载抽取与 CSS 清理

2026-11-14（北京时间）。本版是阶段 4（可维护性）的第一批，只做低风险结构整理，不改变产品行为与数据格式。

## 完成内容

### 统一 schema 常量

- 新增 `dist/schema.mjs`，集中导出：
  - `TASK_TYPES` / `TASK_TYPE_LABELS`
  - `STATE_VERSION`、`STATE_KEY`、`RECOVERY_KEY`
  - `DEFAULT_SETTINGS`
  - `NOTE_MAX_LENGTH`、`MAX_RECORDING_BYTES`、`MAX_BACKUP_BYTES`
- `core`、`store`、`backup`、`scene-voice-settings` 与 `app` 改为共用；`store`/`backup` 继续 re-export 原有常量，现有调用与测试不需要改导入路径。
- 删除 `app.mjs` 与 `backup.mjs` 中重复的默认设置、任务类型标签与上限定义。

### 抽出可测试的加载逻辑

- `store.inspectStorage({ storage, today, defaults, createSampleState })` 统一处理：
  - 读取失败（storage 不可用）
  - 空数据
  - 结构损坏 / 未来版本
  - 可读数据的归一化与部分坏记录计数
- 返回原始字节供调用方先写恢复副本；`app.mjs` 只保留“是否冻结写入、是否提示恢复”的界面策略。
- 新增 2 项集成测试：空/损坏/未来/部分损坏分类，以及完整快照与 storage 读取失败。
- 新增 `schema.test.mjs` 固定常量单一来源。

### CSS 清理

- 删除无引用样式：`voice-pack.css` 整个文件、`.recording-*`、`.record-details`、`.finish-symbol`、`.settings-pet-preview`、`.task-duration`；同步清理 `styles.css`、`ipad.css`、`fonts.css`、`settings.css` 中的引用。
- 补齐此前引用了但未定义的 `--green` token；样式源文件 13 → 12，CSS 合并顺序同步更新。
- 构建产物与页面截图对比：首页布局、字号、消息条、时间轴无变化。

## 验证

- 自动检查 **243 项，失败 0、跳过 0**（新增 inspectStorage 2 项、schema 1 项）。
- `npm run build` / `npm run check` / `node scripts/check-version.mjs` 通过；构建版本 `e5ef5b1399226bd71818`。
- 离线清单 **57 项 / 5.1 MB**（新增 `schema.mjs`，减少 `voice-pack.css`，净增 1 项）。
- 浏览器截图（Chrome 无头）：[首页](previews/v1.5.1-home.png)，与 v1.5.0 布局一致。
- 语法检查覆盖 23 个脚本（新增 `schema.mjs`）。

## 未完成（阶段 4 后续）

- `app.mjs` 仍约 900 行；下一步拆分 `render.mjs` / `controller.mjs`，入口只做装配。
- CSS 只做了死代码清理与一个 token，尚未做字号/圆角/阴影/颜色全局 token 化。
- DOM/UI 行为仍缺少浏览器自动化测试；当前新增测试集中在纯函数与加载路径。
- 真机 iPad 验收未做。

## 局限

- 本批未改存储格式、离线策略与界面行为，回退到 v1.5.0 不影响本机数据。
- 截图来自本机 Chrome 无头模式，非 iPad Safari。
