import bpy,json,math
from pathlib import Path
ROOT=Path('/Users/caihker/Downloads/AI coding/homework_alert');OUT=Path('/private/tmp/turtle-upright-celebration');OUT.mkdir(exist_ok=True)
scene=bpy.context.scene
for o in list(scene.objects):bpy.data.objects.remove(o,do_unlink=True)
scene.render.engine='BLENDER_EEVEE';scene.render.film_transparent=True;scene.render.resolution_x=384;scene.render.resolution_y=384;scene.render.resolution_percentage=100;scene.render.fps=24
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.view_settings.view_transform='Standard'
info=json.loads((ROOT/'animation-source/upright-uv-boxes.json').read_text());W,H=info['size']
# Each direction is a drawn volume view, never an edge-on rotating image plane.
image=bpy.data.images.load(str(ROOT/'animation-source/turtle-upright-turnaround.png'));image.pack()
root=bpy.data.objects.new('Vertical jump root',None);scene.collection.objects.link(root)
views=[]
for i,(x0,y0,x1,y1) in enumerate(info['boxes']):
 height=1.9;width=height*(x1-x0)/(y1-y0)
 mesh=bpy.data.meshes.new(f'Turn view {i}');mesh.from_pydata([(-width/2,0,0),(width/2,0,0),(width/2,height,0),(-width/2,height,0)],[],[(0,1,2,3)]);mesh.update()
 uv=mesh.uv_layers.new();coords=[(x0/W,1-y1/H),(x1/W,1-y1/H),(x1/W,1-y0/H),(x0/W,1-y0/H)]
 for li in range(4):uv.data[li].uv=coords[li]
 ob=bpy.data.objects.new(f'Upright angle {i*45} degrees',mesh);scene.collection.objects.link(ob);ob.parent=root
 m=bpy.data.materials.new(f'Original art angle {i}');m.use_nodes=True;n=m.node_tree.nodes;n.clear();l=m.node_tree.links
 t=n.new('ShaderNodeTexImage');t.image=image;t.interpolation='Linear'
 em=n.new('ShaderNodeEmission');l.new(t.outputs['Color'],em.inputs['Color'])
 tr=n.new('ShaderNodeBsdfTransparent');mix=n.new('ShaderNodeMixShader');l.new(t.outputs['Alpha'],mix.inputs[0]);l.new(tr.outputs[0],mix.inputs[1]);l.new(em.outputs[0],mix.inputs[2]);o=n.new('ShaderNodeOutputMaterial');l.new(mix.outputs[0],o.inputs['Surface']);mesh.materials.append(m);views.append(ob)
bpy.ops.object.camera_add(location=(0,1.35,4));scene.camera=bpy.context.object;scene.camera.data.type='ORTHO';scene.camera.data.ortho_scale=3.1;scene.camera.rotation_euler=(0,0,0)
for f in range(65):
 angle=0;lift=0;sx=sy=1
 if 8<=f<14:
  q=(f-8)/6;sy=1-.13*math.sin(q*math.pi/2);sx=1+.05*math.sin(q*math.pi/2)
 elif 14<=f<21:
  q=(f-14)/7;lift=.82*(1-(1-q)**2);sy=1+.04*math.sin(q*math.pi)
 elif 21<=f<37:
  q=(f-21)/16;lift=.82+.06*math.sin(q*math.pi);angle=(1+(f-21)//2)%8
 elif 37<=f<45:
  q=(f-37)/8;lift=.82*(1-q*q)
 elif 45<=f<52:
  q=(f-45)/7;sy=1-.12*math.sin(q*math.pi);sx=1+.055*math.sin(q*math.pi)
 root.location=(0,lift,0);root.scale=(sx,sy,1)
 for prop in ['location','scale']:root.keyframe_insert(prop,frame=f+1)
 for i,ob in enumerate(views):
  ob.hide_render=i!=angle;ob.hide_viewport=i!=angle;ob.keyframe_insert('hide_render',frame=f+1);ob.keyframe_insert('hide_viewport',frame=f+1)
scene.frame_start=1;scene.frame_end=64
for label,frame in [('Stand',1),('Crouch',9),('Vertical takeoff',15),('Upright aerial turn',22),('Descent',38),('Landing',46)]:scene.timeline_markers.new(label,frame=frame)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'animation-source/turtle-upright-celebration.blend'))
for f in range(64):
 scene.frame_set(f+1);scene.render.filepath=str(OUT/f'{f:02d}.png');bpy.ops.render.render(write_still=True)
print('UPRIGHT_CELEBRATION_DONE')
