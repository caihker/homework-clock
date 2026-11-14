# GitHub Pages 发布与 iPad 更新

## 在线地址

- 应用：https://caihker.github.io/homework-clock/
- 发布工作流：[Deploy homework clock to Pages](../.github/workflows/pages.yml)
- 发布源：`demo/dist`（只发布部署产物，不发布仓库源码）

## 自动发布机制

- 推送到 `main` 后，GitHub Actions 依次执行：
  1. `node scripts/check-version.mjs`
  2. `cd demo && npm run build && npm run check && npm test`
  3. 上传 `demo/dist` 为 Pages artifact
  4. 部署到 `github-pages` 环境
- 版本标签（`v*`）本身不触发 Pages 发布；Pages 始终跟随 `main` 的最新通过检查的提交。
- 手动重跑：Actions → Deploy homework clock to Pages → Run workflow。
- 发布失败不会影响上一次成功的站点；在 Actions 日志中查看失败步骤。

## iPad 首次安装（GitHub Pages）

1. 用 Safari 打开 https://caihker.github.io/homework-clock/ 。
2. 进入「家庭小设置 → 本机与备份」，等待「离线准备完成」。
3. Safari「共享 → 添加到主屏幕」，如有「作为网页 App 打开」则打开。
4. 保持联网，从主屏图标首次打开，再次确认离线准备完成，再断网试用。
5. 首次点一次语音试听，允许声音播放。

## iPad 更新已安装的版本

1. 电脑侧确认 `main` 已推送且 Pages 工作流成功（或手动 Run workflow）。
2. iPad 保持联网，关闭所有作业时钟窗口（Safari 标签页和主屏独立窗口都关闭）。
3. 从主屏图标打开 →「家庭小设置 → 本机与备份」。
4. 等待检查完成，点「检查更新」；出现“新版已准备好”后点「立即更新」。
5. 确认设置底部版本号正确、「离线准备完成」，再断网打开验证。
6. 若未出现更新：完全退出主屏 App 后重新联网打开；仍不行则在 Safari 打开站点刷新两次，再回主屏打开。

更新保留本机计划、模板、记事、专注记录、家庭设置和录音；更新前仍建议先「导出备份」。

## 从旧私有站点迁移

GitHub Pages 与原私有站点是不同网址，浏览器存储按网址隔离：

1. 在旧站「家庭小设置 → 本机与备份 → 导出备份」，保存到 iPad「文件」。
2. 用 Safari 打开 GitHub Pages 地址，先添加到主屏。
3. 在新地址「恢复备份」，确认计划/记录/模板/设置数量。
4. 旧主屏图标可保留或删除；删除前先确认新地址已恢复并验证。

## 回滚

- 代码回滚：把 `main` 回退到之前通过的提交并推送，Pages 会重新发布；不要删除版本标签。
- 仅回滚站点：Actions 中找到上一次成功的 Pages 工作流并重新运行（其提交需已存在于仓库）。
- 本机数据不回滚：按应用内备份恢复流程处理。

## 注意

- GitHub Pages 是公开地址，任何人可访问页面；应用数据只保存在各自设备浏览器，不会上传。
- 不要把个人计划、录音或备份文件提交到仓库。
- 原私有站点 https://homework-clock-demo-caihker.wujiyu2002.chatgpt.site 仍可手动发布，但推送 GitHub 不会更新它。
