# 原版乌龟 · ComfyUI 立体风格试稿

本机 Comfy Desktop：`/Applications/Comfy Desktop.app`
本地服务：<http://127.0.0.1:8188>（启动本地 ComfyUI 实例后可用）

## 重现

1. 打开 Comfy Desktop，启动本地的 **ComfyUI** 实例。
2. 将 `turtle_3d_workflow.json` 拖入画布。
3. `LoadImage` 选择 `turtle-original.png`，模型选择 `dreamshaper_8.safetensors`。
4. 点击运行。默认 640 × 640，24 步，种子 20261101。

输入原图已放在 `~/ComfyUI-Shared/input/turtle-original.png`。
模型在 `~/ComfyUI-Shared/models/checkpoints/dreamshaper_8.safetensors`。
生成结果在 `~/ComfyUI-Shared/output/turtle_3d/`。

低重绘强度更接近原画，高强度更容易改变面部和形体。当前是 3D 渲染风格的二维图片，不是可旋转或绑定骨骼的 3D 模型。

## 模型与安装

- Comfy Desktop 1.1.8；本地 ComfyUI v0.42.1；Apple MPS 推理。
- DreamShaper 8，作者 Lykon。模型通过可达的 ModelScope 镜像下载，SHA-256 与作者 Hugging Face 仓库公布值核对一致。
- SHA-256：`879db523c30d3b9017143d56705015e15a2cb5628762c11d086fed9538abd7fd`
- 作者来源：https://huggingface.co/Lykon/DreamShaper/blob/main/DreamShaper_8_pruned.safetensors
- 自动升级到 v0.43.0 时 GitHub 连接超时，因此使用安装包自带 v0.42.1；本地出图不需要 Cloud 登录。

## 轮廓约束版

`turtle_controlnet_workflow.json` 增加 Canny + ControlNet，直接由原图提取五官、颈部条纹和龟壳轮廓，限制高强度重绘时的形体变化。

ControlNet 文件：`~/ComfyUI-Shared/models/controlnet/control_v11p_sd15_canny_fp16.safetensors`。
SHA-256：`9ed3a7f834aca0d2b26f9c7f186b3ee29465de1d13e152459e8c9cbb25a0c0bc`，已与原作者仓库核对。
作者来源：https://huggingface.co/lllyasviel/control_v11p_sd15_canny/blob/main/diffusion_pytorch_model.fp16.safetensors

## 明亮动画电影风格（替代黏土方向）

使用 `turtle_pixar_workflow.json`，以原版完整乌龟图为输入。保留金黄色头部、深棕大眼睛、奶油色颈纹、焦糖橙龟壳，采用明亮柔光和干净光滑的材质。

- 原图 Canny 轮廓阈值 0.05 / 0.15，强化细部保留。
- ControlNet 强度 1.0，作用至 95%。
- 重绘强度 0.60；另存 0.72 对照实验。
- 原始渲染存放在 `~/ComfyUI-Shared/output/turtle_pixar/`。
