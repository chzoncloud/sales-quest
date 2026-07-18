/**
 * Sales Quest — Google Sheet backend (Apps Script Web App)
 * ---------------------------------------------------------
 * ทำหน้าที่เป็นฐานข้อมูลกลางให้เซลทุกคนเห็นข้อมูลเดียวกัน
 *
 * วิธีติดตั้ง: ดูใน README.md หัวข้อ "ต่อ Google Sheet"
 */

// ⚠️ ไฟล์นี้อยู่บน GitHub แบบ public — ห้ามใส่ค่าจริงตรงนี้
// ค่าจริงตั้งไว้ในโปรเจกต์ Apps Script "Sales Quest API" บน Google แล้ว
// ถ้าจะติดตั้งชุดใหม่ ค่อยแทนที่ 2 บรรทัดล่างด้วยค่าของตัวเอง

// โทเคนลับ — ต้องตรงกับที่ตั้งในแอป (แท็บตั้งค่า) ใครไม่มีโทเคนนี้เรียก API ไม่ได้
// สร้างใหม่ได้ด้วย: python -c "import secrets; print(secrets.token_urlsafe(24))"
var TOKEN = 'ใส่โทเคนของคุณตรงนี้';

// id ของ Google Sheet (ดูได้จาก URL ของชีท ส่วนที่อยู่ระหว่าง /d/ กับ /edit)
var SHEET_ID = 'ใส่ SHEET_ID ของคุณตรงนี้';

var SHEET_NAME = 'entries';
// ref   = อ้างถึง id ของลูกค้า (ใช้ตอน type='status')
// stage = ขั้นตอนการขาย (new/talked/visited/sample/quoted/won/lost/noreach)
var HEADERS = ['id', 'rep', 'date', 'type', 'name', 'phone', 'note', 'amount', 'ts', 'deleted', 'ref', 'stage'];

function sheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** อ่านทั้งหมด — ฝั่งแอปเรียกตอน sync */
function doGet(e) {
  try {
    if (!e || !e.parameter || e.parameter.token !== TOKEN) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    var sh = sheet_();
    var last = sh.getLastRow();
    var entries = [];
    if (last > 1) {
      var rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
      var deleted = {};
      rows.forEach(function (r) { if (r[9]) deleted[String(r[0])] = true; });
      rows.forEach(function (r) {
        var id = String(r[0]);
        if (!id || deleted[id] || r[9]) return;
        entries.push({
          id: id,
          rep: String(r[1]),
          // Sheets คืนค่าวันที่เป็น Date object แต่ instanceof เชื่อไม่ได้ใน Apps Script
          // เช็คด้วย getFullYear แทน ไม่งั้นจะได้ string ยาวแบบ "Sat Jul 18 2026 07:00:00 GMT+0700"
          date: (r[2] && typeof r[2].getFullYear === 'function')
                  ? Utilities.formatDate(r[2], 'Asia/Bangkok', 'yyyy-MM-dd')
                  : String(r[2]),
          type: String(r[3]),
          name: String(r[4] || ''),
          phone: String(r[5] || ''),
          note: String(r[6] || ''),
          amount: r[7] === '' ? 0 : Number(r[7]),
          ts: Number(r[8]) || 0,
          ref: String(r[10] || ''),
          stage: String(r[11] || '')
        });
      });
    }
    return json_({ ok: true, entries: entries });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** บันทึกเป็นชุด — กันซ้ำด้วย id */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var body = JSON.parse(e.postData.contents);
    if (body.token !== TOKEN) return json_({ ok: false, error: 'unauthorized' });
    if (body.action !== 'save') return json_({ ok: false, error: 'unknown action' });

    var sh = sheet_();
    var last = sh.getLastRow();
    var existing = {};
    if (last > 1) {
      sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r, i) {
        existing[String(r[0])] = i + 2;   // id -> row number
      });
    }

    var toAppend = [];
    (body.entries || []).forEach(function (x) {
      var id = String(x.id || '');
      if (!id) return;

      if (x.deleted) {                      // ลบ = mark deleted ไม่ลบแถวจริง เก็บประวัติไว้
        if (existing[id]) sh.getRange(existing[id], 10).setValue(true);
        return;
      }
      if (existing[id]) return;             // มีแล้ว ข้าม

      existing[id] = -1;                    // กันซ้ำภายใน batch เดียวกัน
      toAppend.push([
        id, x.rep || '', x.date || '', x.type || '',
        x.name || '', x.phone || '', x.note || '',
        x.amount || '', x.ts || Date.now(), '',
        x.ref || '', x.stage || ''
      ]);
    });

    if (toAppend.length) {
      var start = sh.getLastRow() + 1;
      // คอลัมน์ date (C) ต้องเป็นข้อความ ไม่งั้น Sheets แปลงเป็น Date แล้วอ่านกลับมาเพี้ยน
      sh.getRange(start, 3, toAppend.length, 1).setNumberFormat('@');
      sh.getRange(start, 1, toAppend.length, HEADERS.length).setValues(toAppend);
    }
    return json_({ ok: true, saved: toAppend.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}
