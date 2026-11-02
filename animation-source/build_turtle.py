import bpy, math, os
from pathlib import Path
ROOT=Path('/Users/caihker/Downloads/AI coding/homework_alert')
OUT=Path('/private/tmp/turtle-frames')
# New standalone scene; no user scene is opened or overwritten.
scene=bpy.context.scene
for obj in list(scene.objects): bpy.data.objects.remove(obj,do_unlink=True)
scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=320; scene.render.resolution_y=320; scene.render.resolution_percentage=100
scene.render.film_transparent=True
scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGBA'
scene.render.fps=24
scene.view_settings.view_transform='Standard'
# Dense UV mesh for continuous 2D skin deformation.
N=80
verts=[((x/N-.5)*2,(y/N-.5)*2,0) for y in range(N+1) for x in range(N+1)]
faces=[]
for y in range(N):
 for x in range(N):
  i=y*(N+1)+x;faces.append((i,i+1,i+N+2,i+N+1))
mesh=bpy.data.meshes.new('TurtleSkin_80x80');mesh.from_pydata(verts,[],faces);mesh.update()
obj=bpy.data.objects.new('Approved_Turtle_Skin',mesh);scene.collection.objects.link(obj)
uv=mesh.uv_layers.new(name='ArtworkUV')
for poly in mesh.polygons:
 for li in poly.loop_indices:
  v=mesh.vertices[mesh.loops[li].vertex_index].co;uv.data[li].uv=((v.x+1)/2,(v.y+1)/2)
mat=bpy.data.materials.new('Approved_Artwork_RGBA');mat.use_nodes=True
nodes=mat.node_tree.nodes;nodes.clear();links=mat.node_tree.links
tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ROOT/'demo/dist/assets/turtle-mascot.png'));tex.image.pack();tex.interpolation='Linear'
em=nodes.new('ShaderNodeEmission');links.new(tex.outputs['Color'],em.inputs['Color'])
tr=nodes.new('ShaderNodeBsdfTransparent');mix=nodes.new('ShaderNodeMixShader');links.new(tex.outputs['Alpha'],mix.inputs[0]);links.new(tr.outputs[0],mix.inputs[1]);links.new(em.outputs[0],mix.inputs[2]);out=nodes.new('ShaderNodeOutputMaterial');links.new(mix.outputs[0],out.inputs['Surface']);obj.data.materials.append(mat)
arm=bpy.data.armatures.new('Turtle_Joints');rig=bpy.data.objects.new('Turtle_Rig',arm);scene.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
# Pixel-normalized pivots measured against the approved art, y grows upward.
pivots={'body':(.58,.40),'neck':(.37,.35),'head':(.33,.57),'front_near':(.52,.30),'front_far':(.20,.33),'rear_near':(.84,.25),'tail':(.88,.35)}
def coord(p):return ((p[0]-.5)*2,(p[1]-.5)*2,0)
for name,p in pivots.items():
 b=arm.edit_bones.new(name);b.head=coord(p);b.tail=(b.head.x,b.head.y+.16,0)
 if name!='body':b.parent=arm.edit_bones['neck' if name=='head' else 'body']
bpy.ops.object.mode_set(mode='OBJECT')
for name in pivots:obj.vertex_groups.new(name=name)
def smooth(a,b,x):
 t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
for v in mesh.vertices:
 x=(v.co.x+1)/2;y=(v.co.y+1)/2
 head=smooth(.44,.60,y)*(1-smooth(.48,.58,x))
 neck=smooth(.30,.52,y)*(1-smooth(.41,.49,x))*(1-head)
 feet=1-smooth(.18,.34,y)
 fn=feet*smooth(.34,.43,x)*(1-smooth(.65,.71,x))
 ff=feet*(1-smooth(.28,.35,x))
 rn=feet*smooth(.73,.81,x)
 tail=smooth(.91,.98,x)*smooth(.24,.31,y)*(1-smooth(.38,.44,y))
 weights={'head':head,'neck':neck,'front_near':fn,'front_far':ff,'rear_near':rn,'tail':tail}
 total=sum(weights.values());weights['body']=max(0,1-total);total=sum(weights.values())
 for name,w in weights.items():
  if w>0:obj.vertex_groups[name].add([v.index],w/total,'REPLACE')
mod=obj.modifiers.new('Joint-driven skin','ARMATURE');mod.object=rig;mod.use_deform_preserve_volume=True
bpy.ops.object.camera_add(location=(0,0,4));scene.camera=bpy.context.object;scene.camera.data.type='ORTHO';scene.camera.data.ortho_scale=2.28
scene.camera.rotation_euler=(0,0,0)
# Camera local -Z looks down at the artwork plane.
poses=rig.pose.bones
for p in poses:p.rotation_mode='XYZ'
clips=['walking','waiting','rest','ready','happy']
for ci,clip in enumerate(clips):
 start=ci*49+1
 scene.timeline_markers.new(clip,frame=start)
 for frame in range(49):
  phase=frame/48*math.tau
  for p in poses:p.rotation_euler=(0,0,0);p.location=(0,0,0);p.scale=(1,1,1)
  if clip=='walking':
   for name,offset in [('front_near',0),('front_far',math.pi),('rear_near',math.pi)]:
    p=poses[name];s=math.sin(phase+offset);p.rotation_euler.z=.20*s;p.location.x=.038*s;p.location.y=.038*max(0,math.cos(phase+offset))
   poses['head'].rotation_euler.z=.065*math.sin(phase+.4);poses['neck'].rotation_euler.z=.025*math.sin(phase);poses['tail'].rotation_euler.z=.12*math.sin(phase)
  elif clip=='waiting':
   poses['head'].rotation_euler.z=.16*math.sin(phase);poses['neck'].rotation_euler.z=.035*math.sin(phase-.5)
  elif clip=='rest':
   poses['neck'].rotation_euler.z=-.08;poses['head'].rotation_euler.z=-.09+.018*math.sin(phase);poses['body'].scale=(1,1+.009*math.sin(phase),1)
  elif clip=='ready':
   poses['neck'].location.y=.035*(1-math.cos(phase));poses['head'].rotation_euler.z=.12*math.sin(phase*2)
  else:
   poses['head'].rotation_euler.z=.10*math.sin(phase);poses['front_near'].rotation_euler.z=-.42*(.5+.5*math.sin(phase));poses['front_far'].rotation_euler.z=.24*(.5+.5*math.sin(phase));poses['neck'].location.y=.025*(1-math.cos(phase));poses['tail'].rotation_euler.z=.22*math.sin(phase*2)
  for p in poses:
   p.keyframe_insert('rotation_euler',frame=start+frame);p.keyframe_insert('location',frame=start+frame);p.keyframe_insert('scale',frame=start+frame)
scene.frame_start=1;scene.frame_end=245
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'animation-source/turtle-rig.blend'))
# 24 unique frames per 2-second loop; export at 12 fps for a compact UI asset.
for ci,clip in enumerate(clips):
 folder=OUT/clip;folder.mkdir(exist_ok=True)
 for f in range(24):
  scene.frame_set(ci*49+1+f*2);scene.render.filepath=str(folder/f'{f:02d}.png');bpy.ops.render.render(write_still=True)
print('TURTLE_RENDER_DONE')
