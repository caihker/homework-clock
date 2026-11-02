# 乌龟动画源文件

- `turtle-solid-3d.blend`：立体版本，完整头部、龟壳、四肢和面部构件；六组动作保存在 Action 数据块中。
- `build_turtle_3d.py`：重建模型、关键帧、灯光及透明帧序列。使用 Blender 5.2，以 `--background --factory-startup --python` 运行。
- `turtle-rig.blend` / `turtle-jump-turn.blend`：早期二维网格动画，留作历史参考。

立体版本使用几何体而非贴图平面，因此旋转过程中能看到真实侧面、背面和后脑。头部及面部构件共同挂在头颈关节下。仰头/跳跃动画使用固定宽松取景，不对各帧自动裁切；WebP 导出保留完整画布。发布前逐帧检查 alpha 边界并验证动作帧确有差异。

## 当前采用：原画风直立庆祝

`turtle-upright-celebration.blend` 使用原版角色的八方向直立原画（`turtle-upright-turnaround.png`），在 Blender 中编排竖直起跳和逐角度转圈。未采用重新建模的三维外观。`render_upright_celebration.py` 可重建；`restore_original_motion.py` 重建保留完整取景的原图骨骼动作。

直立原画由内置 imagegen 生成，提示词核心：严格保持原图头脸、眼睛、颈纹、配色与描边，仅改为双后脚直立姿势；八视图沿竖轴转一圈、保持一致比例、透明背景。逐帧取景检查保存在 `original-v2-validation.json`。
