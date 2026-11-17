import * as THREE from 'three';
/** Architecture authored in metres. Openings are geometry, not painted rectangles. */
export class CityKit {
  group=new THREE.Group();
  materials=new Map<string,THREE.MeshStandardMaterial>();
  mat(color='#bbc1c2'){let m=this.materials.get(color);if(!m){m=new THREE.MeshStandardMaterial({color,roughness:.95,metalness:0});this.materials.set(color,m);}return m;}
  mesh(g:THREE.BufferGeometry,p:number[],color='#bbc1c2',rotation?:number[]){const m=new THREE.Mesh(g,this.mat(color));m.position.set(p[0],p[1],p[2]);if(rotation)m.rotation.set(rotation[0],rotation[1],rotation[2]);this.group.add(m);return m;}
  box(w:number,h:number,d:number,x:number,y:number,z:number,c?:string){return this.mesh(new THREE.BoxGeometry(w,h,d),[x,y,z],c);}
  cylinder(r:number,h:number,x:number,y:number,z:number,c='#7e898c',segments=10){return this.mesh(new THREE.CylinderGeometry(r,r,h,segments),[x,y,z],c);}
  rail(w:number,x:number,y:number,z:number,c='#687579'){this.box(w,.07,.07,x,y+1.05,z,c);this.box(w,.06,.06,x,y+.12,z,c);for(let t=-w/2;t<=w/2;t+=.6)this.box(.045,1.05,.045,x+t,y+.525,z,c);}
  stairs(x:number,y:number,z:number,height=3.3,width=2){const n=Math.ceil(height/.165),going=.28;for(let i=0;i<n;i++)this.box(width,(i+1)*height/n,going,x,y+(i+1)*height/n/2,z+(i+.5)*going,'#8e989b');for(const side of [-1,1]){const length=Math.hypot(n*going,height);const m=this.box(.06,.06,length,x+side*(width/2+.06),y+height/2+1,z+n*going/2,'#667378');m.rotation.x=-Math.atan2(height,n*going);}}
  /** One facade bay. Side piers + head/sill leave an actual open door/window. */
  bay(w:number,h:number,x:number,y:number,z:number,door=false,c='#bec4c5'){
    const opening=door?Math.min(2.2,w-.6):w-.65, bottom=door?0:.9, top=door?2.7:h-.45;
    for(const side of [-1,1])this.box((w-opening)/2,h,.28,x+side*(w+opening)/4,y+h/2,z,c);
    if(bottom)this.box(opening,bottom,.28,x,y+bottom/2,z,c);
    this.box(opening,h-top,.28,x,y+(top+h)/2,z,c);
    this.box(opening+.12,.09,.42,x,y+bottom,z,'#737f84');
    for(const side of [-1,1])this.box(.06,top-bottom,.08,x+side*opening/2,y+(bottom+top)/2,z+.16,'#657378');
    if(!door){this.box(.055,top-bottom,.08,x,y+(bottom+top)/2,z+.16,'#657378');this.box(opening,.055,.08,x,y+(bottom+top)/2,z+.16,'#657378');}
  }
  /** Parametric shell with floor slabs, real apertures on all facades and a stairwell. */
  building(w:number,d:number,floors:number,style:'residential'|'school'|'hospital'|'office'|'shop',interior=true){
    const fh=style==='shop'?4:3.4,bays=Math.round(w/4)|1,bay=w/bays,sideBays=Math.round(d/4),side=d/sideBays,c=style==='hospital'?'#cbd2d2':style==='school'?'#b5bebf':style==='office'?'#a3b1b6':'#b9c0c1';
    for(let f=0;f<floors;f++){const y=f*fh;
      // Slabs stop short of the rear stair opening; it remains traversable between floors.
      if(f===0||!interior)this.box(w,.18,d,0,y-.09,0,'#b0b8ba');else{this.box(w-3,.18,d,-1.5,y-.09,0,'#b0b8ba');this.box(3,.18,Math.max(1,d-6),w/2-1.5,y-.09,3,'#b0b8ba');}
      for(let b=0;b<bays;b++){const x=-w/2+(b+.5)*bay;this.bay(bay,fh,x,y,d/2,f===0&&(b===Math.floor(bays/2)||style==='shop'||style==='school'&&b%2===0),c);this.bay(bay,fh,x,y,-d/2,f===0&&b===0,c);
        if(style==='residential'&&f>0&&b%2===0){this.box(bay-.3,.16,1.3,x,y+.03,d/2+.65,'#929fa3');this.rail(bay-.3,x,y,d/2+1.3);for(const sx of [-1,1])this.box(.08,1.08,1.25,x+sx*(bay-.3)/2,y+.55,d/2+.65,'#748187');}
        if(style==='shop'&&f===0){this.box(bay-.25,.55,.2,x,y+3.4,d/2+.23,'#6f8289');const aw=this.box(bay-.1,.12,1.8,x,y+3.15,d/2+.9,'#87989c');aw.rotation.x=.1;}
      }
      for(const sign of [-1,1]){const sideKit=new CityKit();for(let b=0;b<sideBays;b++)sideKit.bay(side,fh,-d/2+(b+.5)*side,y,0,false,c);sideKit.group.rotation.y=sign*Math.PI/2;sideKit.group.position.x=sign*w/2;this.group.add(sideKit.group);}
      if(interior&&f<floors-1){this.stairs(w/2-1.5,y,-d/2+.2,fh,2.3);this.box(3,.18,.8,w/2-1.5,y+fh-.09,-d/2+6.2,'#9ba6a9');}
      if(!interior||f===floors-1)this.box(w+.4,.14,d+.4,0,y+fh-.07,0,'#89979b');
      if(interior&&f<floors-1){this.box(w+.4,.16,.35,0,y+fh-.08,d/2+.1,'#89979b');this.box(w+.4,.16,.35,0,y+fh-.08,-d/2-.1,'#89979b');}
      if(style==='school'){for(let room=1;room<6;room++)this.box(.16,fh,d-3,-w/2+room*w/6,y+fh/2,-1.5,'#b5bebf');this.box(w,.12,2.4,0,y+.03,d/2+1.2,'#a4afb2');if(f>0)this.rail(w,0,y,d/2+2.35);for(let x=-w/2;x<=w/2;x+=4)this.box(.22,fh,.22,x,y+fh/2,d/2+2.1,'#909fa3');}
    }
    const top=floors*fh;this.box(w,.65,.18,0,top+.325,-d/2,'#8b989d');this.box(w,.65,.18,0,top+.325,d/2,'#8b989d');for(const x of [-w/2,w/2])this.box(.18,.65,d,x,top+.325,0,'#8b989d');
    if(style==='hospital'){this.box(w*.6,.3,5,0,3.4,d/2+2.5,'#8b9fa4');for(const x of [-w*.27,w*.27])this.cylinder(.22,3.3,x,1.65,d/2+4.5);this.box(1.8,.45,.18,0,top-1,d/2+.3,'#788d95');this.box(.45,1.8,.18,0,top-1,d/2+.3,'#788d95');}
    if(interior){if(style==='hospital'){this.box(5,1,.8,-3,.5,1,'#819397');for(let x=-w/2+2;x<w/2-4;x+=3){if(Math.abs(x)<3)continue;this.box(2,.4,.6,x,.2,3,'#8b999e');this.box(2,.7,.1,x,.7,2.7,'#8b999e');}}
      if(style==='school'){for(let x=-w/2+2;x<w/2-4;x+=2)for(let z=-d/2+2;z<d/2-2;z+=2){if(Math.abs(x)<1.5)continue;this.box(1.2,.08,.65,x,.75,z,'#8c9a9e');for(const s of [-.45,.45])this.box(.05,.72,.05,x+s,.36,z);this.box(.45,.05,.45,x,.43,z+.7,'#7a8d93');this.box(.45,.42,.06,x,.65,z+.91,'#7a8d93');for(const cx of [-.17,.17])for(const cz of [-.17,.17])this.box(.035,.4,.035,x+cx,.2,z+.7+cz,'#7a8d93');}this.box(5,1.3,.08,0,1.65,-d/2+.3,'#657b82');}
      if(style==='shop'){this.box(w*.6,.95,.8,0,.475,0,'#8f9e9f');for(const x of [-w/2+1,w/2-1])for(let y=.5;y<2.5;y+=.5)this.box(1,.07,d-2,x,y,0,'#7e8e92');}
      if(style==='residential'){this.box(2.2,.45,.9,-2,.225,0,'#8d9c9f');this.box(2.2,.5,.18,-2,.65,-.4,'#8d9c9f');this.box(1,.1,.7,-2,.45,1.4,'#7d8d93');}
    }
  }
}
export function cityAsset(kind:string):THREE.Group{
 const k=new CityKit();
 if(kind==='apartment')k.building(24,13,6,'residential',true);
 else if(kind==='walkup')k.building(18,11,3,'residential',true);
 else if(kind==='hospital')k.building(44,19,5,'hospital',true);
 else if(kind==='clinic')k.building(20,13,2,'hospital',true);
 else if(kind==='school')k.building(52,12,3,'school',true);
 else if(kind==='shop')k.building(24,10,2,'shop',true);
 else if(kind==='office')k.building(25,22,9,'office',false);
 else if(kind==='civic')k.building(30,16,2,'office',true);
 else if(kind==='tree'){k.cylinder(.19,3.8,0,1.9,0,'#73817f');for(const [x,y,z,r]of [[0,4.5,0,2],[1,4.4,0,1.4],[-1,4.9,.2,1.5],[0,5.5,.2,1.5]])k.mesh(new THREE.IcosahedronGeometry(r,1),[x,y,z],'#8e9f94');}
 else if(kind==='lamp'){k.cylinder(.07,7,0,3.5,0);k.box(2,.08,.1,.8,6.95,0,'#74838a');k.box(.8,.12,.4,1.5,6.9,0,'#cdd3d3');k.box(.5,.3,.5,0,.15,0);}
 else if(kind==='bench'){k.box(1.8,.08,.5,0,.48,0,'#81918f');k.box(1.8,.55,.07,0,.8,-.23,'#81918f');for(const x of [-.65,.65])k.box(.08,.48,.4,x,.24,0,'#6b7a7d');}
 else if(kind==='car'){k.box(1.8,.65,4.3,0,.7,0,'#a3adb1');k.box(1.55,.6,2.15,0,1.32,-.3,'#89999f');for(const x of [-.88,.88])for(const z of [-1.35,1.35])k.mesh(new THREE.CylinderGeometry(.35,.35,.22,12),[x,.4,z],'#4e5d63',[0,0,Math.PI/2]);for(const x of [-.58,.58])k.box(.38,.15,.05,x,.86,2.18,'#d1d7d5');}
 else if(kind==='bus'){k.box(2.5,2.2,9,0,1.5,0,'#aab6ba');k.box(2.3,.75,8.2,0,2,0,'#72868f');for(const x of [-1.2,1.2])for(const z of [-2.8,2.8])k.mesh(new THREE.CylinderGeometry(.5,.5,.22,12),[x,.55,z],'#4c5a61',[0,0,Math.PI/2]);}
 else if(kind==='shelter'){for(const x of [-3,0,3])k.box(.1,2.8,.1,x,1.4,-.8);k.box(7,.16,2.5,0,2.8,0,'#88999e');k.box(6.8,1.6,.1,0,1.8,-.8,'#a7b4b8');k.box(5,.1,.5,0,.5,0,'#76898f');}
 else if(kind==='fence'){for(let x=-5;x<=5;x+=.3)k.box(.035,1.8,.035,x,.9,0,'#65787e');for(const y of [.3,1.6])k.box(10,.05,.05,0,y,0,'#65787e');}
 else if(kind==='sports'){k.box(66,.08,36,0,.04,0,'#869893');for(const x of [-29,29])k.box(.12,.02,28,x,.09,0,'#d8dedd');for(const z of [-14,14])k.box(58,.02,.12,0,.09,z,'#d8dedd');k.box(.12,.02,28,0,.09,0,'#d8dedd');for(const x of [-29,29]){for(const z of [-3.5,3.5])k.cylinder(.06,2.4,x,1.2,z,'#c9d3d3');k.box(.12,.12,7,x,2.4,0,'#c9d3d3');}}
 else if(kind==='hill'){const g=new THREE.PlaneGeometry(480,440,28,28);g.rotateX(-Math.PI/2);const a=g.getAttribute('position');for(let i=0;i<a.count;i++){const x=a.getX(i),z=a.getZ(i);const edge=Math.max(0,1-(x/240)**2)*Math.max(0,1-(z/220)**2);a.setY(i,edge*(42+18*Math.sin(x*.025)+14*Math.cos(z*.032)+8*Math.sin((x+z)*.05)));}g.computeVertexNormals();k.mesh(g,[0,0,0],'#8e9c99');}
 else throw new Error(`未知城市组件：${kind}`);
 return k.group;
}
