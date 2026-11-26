"""
Usage: python3 tools/bake_volume_maps.py   (needs numpy, scipy, Pillow)
Run it after you replace a tree or cloud image so its volume map matches the new picture.

Bake a small "volume map" for each existing sprite. The sprite images themselves are NOT touched.
Output (RGB, opaque, linear):  R,G = surface normal x,y (0.5 = flat)   B = ambient occlusion (1 = open)
Everything is derived from the sprite's own alpha silhouette and brightness.
"""
import numpy as np, os, json
from PIL import Image
from scipy import ndimage as ndi

HERE=os.path.dirname(os.path.abspath(__file__))
ASSETS=os.path.join(HERE,'..','src','assets')+os.sep

KIND = {  # name: (kind, data scale vs sprite)
  'tree1':('foliage',1.0), 'tree2':('foliage',1.0), 'bush1':('foliage',1.0), 'blossom':('foliage',1.0),
  'cloud1':('cloud',0.5), 'cloud2':('cloud',0.5), 'cloud3':('cloud',0.5),
}

def smooth01(x): x=np.clip(x,0,1); return x*x*(3-2*x)

def bake(name, kind, scale):
    im = Image.open(ASSETS+name+'.webp').convert('RGBA')
    if scale != 1.0:
        im = im.resize((max(8,round(im.width*scale)), max(8,round(im.height*scale))), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)/255.0
    rgb, alpha = a[...,:3], a[...,3]
    H_, W_ = alpha.shape
    size = max(W_, H_)
    m = (alpha > 0.5).astype(np.float32)
    lum = rgb @ np.array([0.299,0.587,0.114],dtype=np.float32)
    yy = np.linspace(1,0,H_)[:,None]*np.ones((1,W_))      # 1 at top of the image, 0 at bottom
    # bounding box so "height" is measured on the object, not the padded canvas
    rows = np.where(m.max(1)>0)[0]; y0,y1 = rows.min(), rows.max()
    yfrac = np.clip(1 - (np.arange(H_)-y0)/max(1,(y1-y0)), 0, 1)[:,None]*np.ones((1,W_))

    dt = ndi.distance_transform_edt(m)
    if kind == 'foliage':
        R = 0.10*size
        pillow = np.sqrt(np.clip(1-(1-np.minimum(dt/R,1))**2,0,1))          # rounded edges
        big = ndi.gaussian_filter(m, 0.11*size)                              # broad dome over canopy
        big = big/ max(big.max(),1e-3)
        H = 0.45*pillow + 0.55*big
        # leaf scale bump from brightness: brighter leaf faces catch the light
        detail = lum - ndi.gaussian_filter(lum, max(1.5,0.012*size))
        H = H + 0.9*detail*m*0.12
        depth = 0.30*size
    else:
        R = 0.16*size
        pillow = np.sqrt(np.clip(1-(1-np.minimum(dt/R,1))**2,0,1))
        big = ndi.gaussian_filter(m, 0.09*size); big = big/max(big.max(),1e-3)
        H = 0.55*pillow + 0.45*big
        depth = 0.42*size
    H = ndi.gaussian_filter(H, 0.004*size+0.6)
    gy, gx = np.gradient(H)                      # gy: change per row (rows go down)
    nx = -gx*depth*0.9
    ny =  gy*depth*0.9                           # up = -row  ->  -dH/dup = +dH/drow
    nz = np.ones_like(nx)
    n = np.sqrt(nx*nx+ny*ny+nz*nz)
    nx, ny, nz = nx/n, ny/n, nz/n
    # keep normals gentle so the art stays readable
    nx, ny = nx*0.92, ny*0.92

    if kind == 'foliage':
        ao_v = 0.66 + 0.34*(yfrac**0.65)                       # lower parts sit in the shade of the upper parts
        cav = np.clip(1 + (lum - ndi.gaussian_filter(lum, 0.03*size))*1.7, 0.72, 1.06)
        inner = 1 - 0.22*(big**1.5)
        ao = np.clip(ao_v*cav*inner, 0.22, 1.0)
        # trunk base / bottom edge of the whole thing: contact darkening
        ao *= 1 - 0.18*smooth01(1 - yfrac*9.0)
    else:
        ao_v = 0.72 + 0.28*yfrac
        ao = np.clip(ao_v*(1 - 0.38*big**1.2), 0.3, 1.0)

    out = np.dstack([nx*0.5+0.5, ny*0.5+0.5, ao])
    out = np.where(m[...,None]>0, out, np.dstack([np.full_like(m,0.5),np.full_like(m,0.5),np.full_like(m,0.9)]))
    # fill outside with the nearest inside value so mip-maps / edge filtering never pick up grey
    _, (iy, ix) = ndi.distance_transform_edt(m==0, return_indices=True)
    out = out[iy, ix]
    img = Image.fromarray((np.clip(out,0,1)*255+0.5).astype(np.uint8),'RGB')
    img.save(ASSETS+name+'_d.webp','WEBP',quality=92,method=6)
    return img.size, os.path.getsize(ASSETS+name+'_d.webp')

for n,(k,s) in KIND.items():
    print(n, *bake(n,k,s))
