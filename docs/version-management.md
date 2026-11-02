# GitHub版本管理

项目以整个 `homework_alert` 文件夹为仓库根目录，`main` 保存可运行版本，使用 `v1.2.4` 这样的标签标记发布快照。默认使用私有仓库，GitHub存放源码和素材；iPad仍通过现有私有网址安装或更新。

仓库：[caihker/homework-clock](https://github.com/caihker/homework-clock)。完整资源压缩包在对应GitHub Release中下载。

完整仓库的初始版本基于当前已发布的v1.2.4，不改写原网站的提交记录。迁移前Demo子目录的Git元数据保留在本机 `.git/legacy-demo/`，完整历史备份为 `.git/legacy-demo-history.bundle`。这两份本机备份不会作为程序资源上传；已有网站的发布标识仍保存在 `releases/published-v*.json`。

## 完整资源范围

- `demo/`：PWA程序、完整离线资源、字体、图标、语音、乌龟动画、构建脚本和测试。
- `design-assets/`：分类图标及各版设计源。
- `animation-source/`：Blender工程、动画生成脚本、参考图和验证记录。
- `comfyui-workflows/`：工作流JSON、输入参考及生成试稿。
- `docs/`：设计文档、验收记录和截图。
- `releases/`：历史发布记录和已有本地版本ZIP。
- 项目根目录的说明、参考图、版本记录及GitHub自动检查配置。

Git元数据、登录凭据、安装的软件和模型、缓存、实际用户从iPad导出的计划及录音备份不属于程序资源。程序内置语音和素材随源码保存；iPad上的私人录音继续留在设备中。

`demo/dist` 是可直接托管的完整程序，必须随源码提交。无需安装npm依赖。Blender和ComfyUI用于素材重建，日常运行和程序测试不依赖它们。

## 日常修改

在项目根目录查看改动：

```sh
git status
git diff
```

每次完成一个明确修改后提交，提交说明可用 `fix: 修复录音保存`、`feat: 增加计划模板` 等。不要用强制推送覆盖已有发布记录。

## 发布一个新版本

1. 修改程序，将 `demo/package.json`、`demo/dist/index.html` 底部版本和两个入口脚本查询版本更新为同一个值。
2. 在 `CHANGELOG.md` 记录该版本的变化。
3. 在项目根目录运行版本检查，再到Demo重建离线清单并检查：

```sh
node scripts/check-version.mjs
cd demo
npm run build
npm run check
npm test
cd ..
```

4. 核对 `git diff`，提交并推送 `main`。GitHub Actions自动检查版本、语法、离线清单、测试及构建结果是否一致。
5. 检查通过后为该提交添加不可复用的版本标签，例如：

```sh
git tag -a v1.2.5 -m "作业时钟 v1.2.5"
git push origin main
git push origin v1.2.5
```

6. 从标签生成完整资源ZIP和校验文件，随GitHub Release上传，写明变化和验证结果。GitHub自带的Source code下载也对应同一标签。

示例打包命令（输出放在已忽略的 `artifacts/`，不会把压缩包循环打进源码）：

```sh
mkdir -p artifacts
git archive --format=zip --prefix=homework-clock-v1.2.5/ --output=artifacts/homework-clock-v1.2.5-full.zip v1.2.5
shasum -a 256 artifacts/homework-clock-v1.2.5-full.zip > artifacts/SHA256SUMS.txt
```

## GitHub与iPad更新的关系

推送GitHub不会自动更新现有私有网站。本仓库的自动流程只做检查，不包含网站发布凭据。网站发布仍使用原有私有站点流程，验证后更新，发布结果写回 `releases/`。

需要恢复旧版本时，从目标标签检出到独立文件夹，检查测试后再发布；保留新版本的历史，不删除标签。源码回退不等于回退iPad本机计划，计划和录音备份仍按应用内的导出、恢复流程处理。
