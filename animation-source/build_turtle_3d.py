import bpy, math, json, sys
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
ROOT=Path('/Users/caihker/Downloads/AI coding/homework_alert');OUT=Path('/private/tmp/turtle-3d');OUT.mkdir(exist_ok=True)
scene=bpy.context.scene
for obj in list(scene.objects):bpy.data.objects.remove(obj,do_unlink=True)
scene.render.engine='BLENDER_EEVEE';scene.render.film_transparent=True
scene.render.resolution_x=384;scene.render.resolution_y=384;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.fps=24
scene.view_settings.view_transform='Standard';scene.world.color=(.35,.35,.35)
def material(name,color):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=.6
 return m
skin=material('Golden cream skin',(.69,.48,.19));light=material('Cream neck stripes',(.98,.83,.48));shell=material('Caramel shell',(.45,.18,.065));seam=material('Shell grooves',(.21,.065,.018));dark=material('Cocoa facial features',(.055,.017,.008));white=material('Eye catchlights',(1,.96,.85));blush=material('Peach cheeks',(.94,.36,.16));belly=material('Warm belly',(.82,.61,.30))
def empty(name,loc,parent=None):
 o=bpy.data.objects.new(name,None);scene.collection.objects.link(o);o.location=loc
 if parent:o.parent=parent
 bpy.context.view_layer.update()
 return o
root=empty('Root - jump and turn',(0,0,0));parts=[]
def parent_keep(o,parent):
 world=o.matrix_world.copy();o.parent=parent;o.matrix_world=world
 # Explicit matrix needed before dependency graph evaluates newly added objects.
def sphere(name,loc,scale,mat,parent=root):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=40,ring_count=24,location=loc);o=bpy.context.object;o.name=name;o.scale=scale;o.data.materials.append(mat)
 for p in o.data.polygons:p.use_smooth=True
 bpy.context.view_layer.update();parent_keep(o,parent);parts.append(o);return o
def line(name,coords,radius,mat,parent=root):
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.bevel_depth=radius;c.bevel_resolution=3
 s=c.splines.new('POLY');s.points.add(len(coords)-1)
 for p,co in zip(s.points,coords):p.co=(*co,1)
 o=bpy.data.objects.new(name,c);scene.collection.objects.link(o);c.materials.append(mat);bpy.context.view_layer.update();parent_keep(o,parent);parts.append(o);return o
sphere('Soft belly',(0,.10,.58),(.70,.92,.40),belly)
sphere('Full rounded shell',(0,.24,.91),(.86,1.03,.67),shell)
# Physical shell rim and grooves following the curved shell surface.
line('Shell rim',[(.86*math.cos(t),.24+1.03*math.sin(t),.79) for t in [i*math.tau/96 for i in range(97)]],.045,seam)
def surface(x,y):return (x,y,.91+.675*math.sqrt(max(.005,1-(x/.86)**2-((y-.24)/1.03)**2)))
hexpts=[(.42*math.cos(i*math.tau/6),.24+.49*math.sin(i*math.tau/6)) for i in range(6)]
for i in range(6):
 a=hexpts[i];b=hexpts[(i+1)%6]
 line('Central scute edge', [surface(a[0]+(b[0]-a[0])*t/12,a[1]+(b[1]-a[1])*t/12) for t in range(13)],.018,seam)
 angle=i*math.tau/6
 e=(.83*math.cos(angle),.24+1.0*math.sin(angle))
 line('Radial scute seam',[surface(a[0]+(e[0]-a[0])*t/20,a[1]+(e[1]-a[1])*t/20) for t in range(21)],.018,seam)
# Joint hierarchy uses real 3D geometry, no image planes.
neck=empty('Neck joint',(0,-.64,.81),root)
sphere('Neck',(0,-.80,1.10),(.31,.32,.53),skin,neck)
head=empty('Head joint',(0,-.90,1.40),root);parent_keep(head,neck)
sphere('Complete round head',(0,-1.03,1.70),(.68,.63,.70),skin,head)
# Eyes and face mounted on the head, so every head movement preserves its silhouette.
for side in [-1,1]:
 eye=sphere('Eye white',(side*.275,-1.575,1.84),(.172,.077,.225),white,head)
 sphere('Large cocoa eye',(side*.281,-1.637,1.85),(.135,.048,.18),dark,head)
 sphere('Bright eye highlight',(side*.281-.035,-1.68,1.928),(.043,.022,.055),white,head)
 sphere('Peach cheek',(side*.43,-1.523,1.58),(.11,.038,.074),blush,head)
 sphere('Nostril',(side*.065,-1.66,1.69),(.018,.012,.014),dark,head)
line('Gentle smile',[(.18*t,-1.635,1.49-.055*(1-t*t)) for t in [-1+i/16*2 for i in range(17)]],.015,dark,head)
for side in [-1,1]:
 line('Cream neck stripe',[(side*(.13-.035*t),-1.103-.025*math.sin(t*math.pi),.84+t*.47) for t in [i/20 for i in range(21)]],.025,light,neck)
legs={}
for side in [-1,1]:
 for pos,y in [('front',-.49),('back',.83)]:
  pivot=empty(f'{pos} {side} hip',(side*.55,y,.56),root);legs[(side,pos)]=pivot
  sphere(f'{pos} {side} soft leg',(side*.62,y-.04,.42),(.19,.22,.31),skin,pivot)
  sphere(f'{pos} {side} foot',(side*.68,y-.12,.20),(.26,.32,.26),skin,pivot)
  for j in [-1,0,1]:sphere('Rounded toe',(side*.68+j*.092,y-.39,.18),(.037,.055,.035),belly,pivot)
tail=empty('Tail joint',(0,1.1,.55),root)
sphere('Little tail',(0,1.27,.52),(.12,.37,.12),skin,tail)
# Broad studio lighting makes the profile and back read as solid volume.
for name,loc,power,size in [('Key',(-3,-4,7),450,5),('Fill',(4,-1,4),280,5),('Rim',(1,4,6),400,4)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(5,-7,4));camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO'
def camera_for(clip):
 camera.location=(5 if clip!='walking-right' else -5,-7,4.1)
 target=Vector((0,-.05,1.22 if clip!='happy-jump' else 1.45))
 camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=4.1 if clip!='happy-jump' else 4.9

def pose(clip,t):
 root.location=(0,0,0);root.rotation_euler=(0,0,0);root.scale=(1,1,1);neck.rotation_euler=(0,0,0);head.rotation_euler=(0,0,0);tail.rotation_euler=(0,0,0)
 for leg in legs.values():leg.rotation_euler=(0,0,0)
 phase=t*math.tau
 if clip.startswith('walking'):
  for (side,pos),leg in legs.items():leg.rotation_euler.x=.32*math.sin(phase+(0 if (side==1)==(pos=='front') else math.pi))
  neck.rotation_euler.x=.035*math.sin(phase);head.rotation_euler.z=.045*math.sin(phase);root.location.z=.025*(1-math.cos(phase*2));tail.rotation_euler.z=.16*math.sin(phase)
 elif clip=='waiting':head.rotation_euler.z=.22*math.sin(phase);neck.rotation_euler.x=-.10*(.5+.5*math.sin(phase))
 elif clip=='ready':neck.rotation_euler.x=-.25*(.5-.5*math.cos(phase));head.rotation_euler.z=.13*math.sin(phase)
 elif clip=='rest':neck.rotation_euler.x=.13;head.rotation_euler.x=.08;root.scale.z=1+.009*math.sin(phase)
 else:
  if t<.14:
   squash=.14*math.sin(t/.14*math.pi/2);u=0;lift=0;turn=0
  elif t<.82:
   u=(t-.14)/.68;squash=0;lift=.95*math.sin(math.pi*u)
   v=max(0,min(1,(u-.07)/.86));turn=math.tau*(v*v*(3-2*v))
  else:
   u=1;lift=0;turn=math.tau;squash=.13*math.sin((t-.82)/.18*math.pi)
  root.location.z=lift;root.rotation_euler.z=turn;root.scale=(1+squash*.2,1+squash*.2,1-squash)
  for (side,pos),leg in legs.items():leg.rotation_euler.x=(-.7 if pos=='front' else .65)*lift/.95
  neck.rotation_euler.x=-.1*lift/.95;head.rotation_euler.z=.12*math.sin(phase);tail.rotation_euler.z=.22*math.sin(phase)
 bpy.context.view_layer.update()

clips=['walking-left','walking-right','waiting','ready','rest','happy-jump']
# Validate the entire swept volume, with minimum 5% framing margin.
checks={}
for clip in clips:
 camera_for(clip);minimum=1
 for i in range(64):
  pose(clip,i/64)
  for ob in parts:
   for co in ob.bound_box:
    v=world_to_camera_view(scene,camera,ob.matrix_world@Vector(co));minimum=min(minimum,v.x,v.y,1-v.x,1-v.y)
 if minimum<.05:camera.data.ortho_scale*=1.18
 checks[clip]={'minimum_margin_initial':round(minimum,4),'ortho_scale':camera.data.ortho_scale}
 # keyframe editable separate actions per clip
 objects=[root,neck,head,tail,*legs.values()]
 for o in objects:o.animation_data_clear()
 for i in range(49):
  pose(clip,i/48)
  for o in objects:
   for path in ['location','rotation_euler','scale']:o.keyframe_insert(path,frame=i+1)
 for o in objects:
  if o.animation_data and o.animation_data.action:o.animation_data.action.name=clip+' / '+o.name;o.animation_data.action.use_fake_user=True
 if '--preview' in sys.argv:
  if clip in ['waiting','happy-jump']:
   scene.frame_set(18 if clip=='happy-jump' else 13);scene.render.filepath=str(OUT/(clip+'-preview.png'));bpy.ops.render.render(write_still=True)
 else:
  folder=OUT/clip;folder.mkdir(exist_ok=True)
  frames=48 if clip=='happy-jump' else 24
  for i in range(frames):
   scene.frame_set(1+int(i*48/frames));scene.render.filepath=str(folder/f'{i:02d}.png');bpy.ops.render.render(write_still=True)
scene.frame_start=1;scene.frame_end=48
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'animation-source/turtle-solid-3d.blend'))
(OUT/'framing.json').write_text(json.dumps(checks,indent=2))
print('SOLID_TURTLE_DONE')
