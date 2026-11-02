import bpy, math
from pathlib import Path
root=Path('/Users/caihker/Downloads/AI coding/homework_alert')
bpy.ops.wm.open_mainfile(filepath=str(root/'animation-source/turtle-rig.blend'))
scene=bpy.context.scene;rig=bpy.data.objects['Turtle_Rig'];out=Path('/private/tmp/turtle-turn');out.mkdir(exist_ok=True)
bpy.data.objects['Approved_Turtle_Skin'].parent=rig
# Separate left/right walk cycles, baked from the same articulated rig.
for direction in ['left','right']:
 folder=out/('walking-'+direction);folder.mkdir(exist_ok=True)
 rig.scale.x=1 if direction=='left' else -1
 for f in range(24):
  scene.frame_set(1+f*2);scene.render.filepath=str(folder/f'{f:02d}.png');bpy.ops.render.render(write_still=True)
rig.scale=(1,1,1)
# Root turn plus independent limb tuck, anticipation, flight, landing.
rig.animation_data_clear()
scene.camera.data.ortho_scale=2.9;scene.camera.location.y=.28
scene.render.resolution_x=384;scene.render.resolution_y=384
for f in range(65):
 t=(f%32)/32;cycle=f//32
 for p in rig.pose.bones:p.rotation_euler=(0,0,0);p.location=(0,0,0);p.scale=(1,1,1)
 if t<.16:
  squash=math.sin(t/.16*math.pi)*.12;lift=0;turn=0
 elif t<.80:
  u=(t-.16)/.64;lift=.80*math.sin(math.pi*u);squash=0;turn=math.pi*(u*u*(3-2*u))
 else:
  lift=0;turn=math.pi;squash=.12*math.sin((t-.8)/.2*math.pi)
 rig.location.y=lift-.06*squash
 rig.rotation_euler=(0,cycle*math.pi+turn,0)
 rig.scale=(1+squash*.5,1-squash,1)
 for name,sign in [('front_near',-1),('front_far',1),('rear_near',1)]:rig.pose.bones[name].rotation_euler.z=sign*.6*(lift/.8)
 rig.pose.bones['head'].rotation_euler.z=.1*math.sin(t*math.tau)
 rig.pose.bones['tail'].rotation_euler.z=.25*math.sin(t*math.tau)
 for path in ['location','rotation_euler','scale']:rig.keyframe_insert(path,frame=f+1)
 for p in rig.pose.bones:
  for path in ['location','rotation_euler','scale']:p.keyframe_insert(path,frame=f+1)
scene.frame_start=1;scene.frame_end=64;scene.render.fps=24
bpy.ops.wm.save_as_mainfile(filepath=str(root/'animation-source/turtle-jump-turn.blend'))
folder=out/'happy-jump';folder.mkdir(exist_ok=True)
for f in range(64):
 scene.frame_set(f+1);scene.render.filepath=str(folder/f'{f:02d}.png');bpy.ops.render.render(write_still=True)
print('TURN_RENDER_DONE')
