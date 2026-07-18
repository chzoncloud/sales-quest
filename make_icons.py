from PIL import Image
import os

# โลโก้ต้นฉบับความละเอียดสูงจากโฟลเดอร์แบรนด์ของบริษัท (2000x2000)
SRC = r'F:\TUMCHZ WORK\MK\MK FOR WEB\Logo\MK LOGO\MK.png'
OUT = r'F:\Claude-Office\sales-quest\icons'
os.makedirs(OUT, exist_ok=True)

full = Image.open(SRC).convert('RGB')

# กรอบ "เพชร MK" — หาด้วยการสแกนพิกเซลที่ไม่ใช่สีขาว (ไม่เอาแถบ INDUSTRIAL SUPPLY ด้านล่าง
# เพราะย่อเป็นไอคอนแล้วอ่านไม่ออก)
DIAMOND = (386, 341, 1625, 1456)
mark = full.crop(DIAMOND)

WHITE = (255, 255, 255)


def make(size, pad_ratio, name):
    """ย่อมาร์กให้พอดีกรอบใน แล้ววางกลางพื้นขาว — รักษาสัดส่วนเดิม ไม่บิด"""
    canvas = Image.new('RGB', (size, size), WHITE)
    inner = int(size * (1 - pad_ratio * 2))
    mw, mh = mark.size
    scale = min(inner / mw, inner / mh)
    nw, nh = max(1, round(mw * scale)), max(1, round(mh * scale))
    m = mark.resize((nw, nh), Image.LANCZOS)
    canvas.paste(m, ((size - nw) // 2, (size - nh) // 2))
    canvas.save(os.path.join(OUT, name), 'PNG', optimize=True)
    print(f'{name:<26} {size}x{size}')


make(192, 0.07, 'icon-192.png')
make(512, 0.07, 'icon-512.png')
make(180, 0.07, 'apple-touch-icon.png')       # iOS ต้องพื้นทึบ ห้ามโปร่งใส
make(512, 0.20, 'icon-maskable-512.png')      # Android ครอปมุม ต้องเผื่อ safe zone
make(192, 0.20, 'icon-maskable-192.png')
make(32,  0.03, 'favicon-32.png')

# โลโก้เต็ม (มีชื่อบริษัท) ไว้ใช้ที่อื่น เช่น หัวรายงาน
full.crop((200, 341, 1800, 1672)).save(
    os.path.join(OUT, 'logo-full.png'), 'PNG', optimize=True)
print('logo-full.png              (โลโก้เต็มพร้อมชื่อบริษัท)')
print('done ->', OUT)
