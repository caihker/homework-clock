import bpy
from pathlib import Path
root=Path('/Users/caihker/Downloads/AI coding/homework_alert')
bpy.ops.wm.open_mainfile(filepath=str(root/'animation-source/turtle-rig.blend'))
scene=bpy.context.scene;rig=bpy.data.objects['Turtle_Rig'];skin=bpy.data.objects['Approved_Turtle_Skin'];skin.parent=rig
scene.camera.data.ortho_scale=2.55
scene.render.resolution_x=384;scene.render.resolution_y=384
out=Path('/private/tmp/turtle-original-fixed');out.mkdir(exist_ok=True)
clips=[('walking-left',0),('walking-right',0),('waiting',1),('rest',2),('ready',3)]
for name,ci in clips:
 rig.scale.x=-1 if name=='walking-right' else 1
 folder=out/name;folder.mkdir(exist_ok=True)
 for i in range(24):
  scene.frame_set(ci*49+1+i*2);scene.render.filepath=str(folder/f'{i:02d}.png');bpy.ops.render.render(write_still=True)
print('ORIGINAL_FIXED_DONE')
