import os, io, math, cairosvg
from PIL import Image, ImageDraw

SRC = {
 'meta':('meta-ads.svg','Meta Ads'), 'canva':('canva.png','Canva'), 'loops':('loops.svg','Loops'),
 'beehiiv':('beehiiv.svg','beehiiv'), 'posthog':('posthog.svg','PostHog'), 'jira':('jira.svg','Jira'),
 'gmail':('gmail.svg','Gmail'), 'fullenrich':('fullenrich-mark.svg','FullEnrich'),
 'imessage':('imessage.png','iMessage'), 'zoominfo':('zoominfo-icon.png','ZoomInfo'),
 'apollo':('apollo-icon.png','Apollo'), 'xero':('xero.png','Xero'),
 'perplexity':('perplexity.svg','Perplexity'), 'pandadoc':('pandadoc.png','PandaDoc'),
 'stripe':('stripe-icon.png','Stripe'), 'revenuecat':('revenuecat.svg','RevenueCat'),
}

def load(fp):
    if fp.endswith('.svg'):
        png = cairosvg.svg2png(url=fp, output_width=1200)
        return Image.open(io.BytesIO(png)).convert('RGBA')
    return Image.open(fp).convert('RGBA')

def bbox_crop(im):
    b = im.getbbox()
    return im.crop(b) if b else im

def try_mark_crop(im):
    """If wordmark: find first vertical whitespace gap; keep left segment if squarish."""
    w,h = im.size
    if w < h*1.6: return im  # already squarish
    alpha = im.split()[3]
    cols = [0]*w
    px = alpha.load()
    for x in range(w):
        s = 0
        for y in range(0,h,2): s += px[x,y]
        cols[x] = s
    # find gap of >= h*0.06 empty cols after some content
    thresh = 255*2  # near empty
    in_content = False; gap_start = None
    for x in range(w):
        empty = cols[x] < thresh
        if not empty: in_content = True; gap_start=None
        else:
            if in_content and gap_start is None: gap_start = x
            if in_content and gap_start is not None and x-gap_start >= max(6,h*0.06):
                seg = bbox_crop(im.crop((0,0,gap_start,h)))
                a = seg.size[0]/seg.size[1]
                if 0.55 <= a <= 1.6: return seg
                return im
    return im

T = 256; R = 58; FIT = 176
os.makedirs('tiles', exist_ok=True)
for key,(fp,name) in SRC.items():
    im = bbox_crop(load(fp))
    im2 = try_mark_crop(im)
    cropped = im2.size != im.size
    im = bbox_crop(im2)
    tile = Image.new('RGBA',(T,T),(0,0,0,0))
    d = ImageDraw.Draw(tile)
    d.rounded_rectangle([0,0,T-1,T-1], radius=R, fill=(255,255,255,255), outline=(28,26,23,26), width=2)
    w,h = im.size
    sc = min(FIT/w, FIT/h)
    nw,nh = max(1,round(w*sc)), max(1,round(h*sc))
    logo = im.resize((nw,nh), Image.LANCZOS)
    tile.alpha_composite(logo, ((T-nw)//2,(T-nh)//2))
    tile = tile.resize((160,160), Image.LANCZOS)
    tile.save(f'tiles/{key}.png')
    print(f"{key:12s} src={fp:22s} mark_crop={cropped} logo_aspect={w/h:.2f}")
# contact sheet
files = sorted(os.listdir('tiles'))
cs = Image.new('RGBA',(4*180, math.ceil(len(files)/4)*180),(246,243,238,255))
for i,f in enumerate(files):
    cs.alpha_composite(Image.open(f'tiles/{f}'), (10+(i%4)*180, 10+(i//4)*180))
cs.convert('RGB').save('contact-sheet.png')
print('sheet done')
