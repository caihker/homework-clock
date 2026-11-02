"""Build a portable ComfyUI canvas from the API graph and server node schemas."""
import json
import sys
from pathlib import Path
root=Path(__file__).parent
source_file=sys.argv[1] if len(sys.argv)>1 else 'turtle_3d_api.json'
api=json.loads((root/source_file).read_text())
schema=json.loads((root/'node-schema.json').read_text())
positions={'1':[0,0],'2':[340,0],'3':[340,280],'4':[0,450],'5':[0,750],'6':[340,580],'7':[650,540],'8':[950,540],'9':[1250,540],'10':[1250,0],'11':[1590,0],'12':[1880,0]}
positions.update({'13':[650,840],'14':[650,1100],'15':[950,840]})
nodes=[];links=[];byid={}
for id,n in api.items():
 s=schema[n['class_type']]; inputs=[]; widgets=[]
 for name,spec in {**s['input'].get('required',{}),**s['input'].get('optional',{})}.items():
  if name not in n['inputs']:continue
  v=n['inputs'][name];typ=spec[0]
  if isinstance(v,list):inputs.append({'name':name,'type':typ,'link':None})
  else:
   widgets.append(v)
   if len(spec)>1 and spec[1].get('control_after_generate'):widgets.append('fixed')
 if n['class_type']=='LoadImage':widgets.append('image')
 out=[{'name':name,'type':typ,'links':[]} for name,typ in zip(s.get('output_name',s['output']),s['output'])]
 node={'id':int(id),'type':n['class_type'],'pos':positions[id],'size':[300,240] if n['class_type']=='CLIPTextEncode' else [280,210],'flags':{},'order':int(id)-1,'mode':0,'inputs':inputs,'outputs':out,'properties':{'Node name for S&R':n['class_type']},'widgets_values':widgets}
 nodes.append(node);byid[id]=node
for id,n in api.items():
 for idx,inp in enumerate(byid[id]['inputs']):
  source,slot=n['inputs'][inp['name']];lid=len(links)+1
  links.append([lid,int(source),slot,int(id),idx,inp['type']]);inp['link']=lid;byid[source]['outputs'][slot]['links'].append(lid)
w={'last_node_id':max(map(int,api)),'last_link_id':len(links),'nodes':nodes,'links':links,'groups':[],'config':{},'extra':{'ds':{'scale':0.6,'offset':[80,80]}},'version':0.4}
(root/source_file.replace('_api.json','_workflow.json')).write_text(json.dumps(w,ensure_ascii=False,indent=2))
