import sys,os
from PIL import Image, ImageDraw
d=sys.argv[1]; out=sys.argv[2]; os.makedirs(out,exist_ok=True)
labels=sorted({f.rsplit('-',1)[0] for f in os.listdir(d) if f.endswith('.png')})
for l in labels:
    t=f'{d}/{l}-testnet.png'; m=f'{d}/{l}-mainnet.png'
    if not (os.path.exists(t) and os.path.exists(m)): continue
    a=Image.open(t).convert('RGB'); b=Image.open(m).convert('RGB')
    sc=0.5; a=a.resize((int(a.width*sc),int(a.height*sc))); b=b.resize((int(b.width*sc),int(b.height*sc)))
    H=max(a.height,b.height)+40; c=Image.new('RGB',(a.width+b.width+30,H),(30,30,30)); dr=ImageDraw.Draw(c)
    dr.text((10,10),f'{l}  TESTNET (left)',fill=(255,255,255)); dr.text((a.width+30,10),'MAINNET (right)',fill=(199,252,117))
    c.paste(a,(10,35)); c.paste(b,(a.width+20,35)); c.save(f'{out}/{l}.png')
print('ok')
