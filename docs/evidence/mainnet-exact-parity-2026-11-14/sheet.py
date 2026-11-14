import sys,os
from PIL import Image, ImageDraw
d='parity2'; vp=sys.argv[1]; out=sys.argv[2]
states=sorted({f.split('-',1)[1].rsplit('-',1)[0].replace('-testnet','') for f in os.listdir(d) if f.startswith(vp+'-')})
pairs=[]
for s in states:
    t=f'{d}/{vp}-{s}-testnet-local.png'; m=f'{d}/{vp}-{s}-mainnet.png'
    if os.path.exists(t) and os.path.exists(m): pairs.append((s,t,m))
for s,t,m in pairs:
    a=Image.open(t).convert('RGB'); b=Image.open(m).convert('RGB')
    sc=0.5 if vp!='desktop' else 0.4
    a=a.resize((int(a.width*sc),int(a.height*sc))); b=b.resize((int(b.width*sc),int(b.height*sc)))
    W=a.width+b.width+30; H=max(a.height,b.height)+40
    c=Image.new('RGB',(W,H),(30,30,30)); dr=ImageDraw.Draw(c)
    dr.text((10,10),f'{s}  TESTNET (left)',fill=(255,255,255)); dr.text((a.width+30,10),'MAINNET (right)',fill=(199,252,117))
    c.paste(a,(10,35)); c.paste(b,(a.width+20,35)); c.save(f'{out}/{vp}-{s}.png')
print(len(pairs))
