/**
 * น้องเควส — ตัวรับข้อความจาก LINE
 * วางไฟล์นี้เป็นไฟล์ที่ 2 ในโปรเจกต์ Apps Script "Sales Quest API"
 *
 * หลักการ: บอทเงียบสนิท ไม่เก็บอะไร จนกว่าจะมีคนพิมพ์คำสั่ง "จด"
 *          - เก็บข้อความล่าสุดไว้ 30 ข้อความชั่วคราว (เพื่อรู้ว่า "จด" หมายถึงอันไหน)
 *          - พอถูกชี้ ย้ายไปกล่องรอประมวลผล แล้วตอบรับในกลุ่ม
 *          - Claude มาอ่านกล่องนี้ทีหลัง ตีความ แล้วลงระบบ
 *
 * ⚠️ TOKEN เก็บใน Script Properties ไม่ใช่ในโค้ด (ไฟล์นี้อยู่บน GitHub แบบ public)
 *    ตั้งที่: ⚙️ Project Settings -> Script Properties -> เพิ่ม LINE_TOKEN
 */

var BUF_SHEET   = 'line_buffer';   // ข้อความล่าสุด 30 อัน ลืมทิ้งอัตโนมัติ
var INBOX_SHEET = 'line_inbox';    // ข้อความที่ถูกชี้ว่า "จด" รอ Claude มาอ่าน
var BUF_MAX     = 30;

var TRIGGERS = ['จด', 'เก็บ', 'บันทึก', 'เก็บข้อมูล'];

function lineToken_() {
  return PropertiesService.getScriptProperties().getProperty('LINE_TOKEN') || '';
}

function sheetNamed_(name, headers) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** ตอบกลับในกลุ่ม (ฟรี ไม่นับโควต้า ต้องใช้ replyToken ภายใน ~1 นาที) */
function lineReply_(replyToken, text) {
  if (!replyToken) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + lineToken_() },
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] }),
    muteHttpExceptions: true
  });
}

/** ส่งข้อความเข้ากลุ่มแบบไม่ต้องรอใครพูดก่อน (นับโควต้า free 200/เดือน) */
function linePush_(to, text) {
  return UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + lineToken_() },
    payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: text }] }),
    muteHttpExceptions: true
  }).getResponseCode();
}

/** ดึงชื่อเล่นคนพูด เอาไว้ให้ Claude รู้ว่าใครเป็นใคร */
function lineName_(groupId, userId) {
  try {
    var url = groupId
      ? 'https://api.line.me/v2/bot/group/' + groupId + '/member/' + userId
      : 'https://api.line.me/v2/bot/profile/' + userId;
    var r = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + lineToken_() },
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) return '';
    return JSON.parse(r.getContentText()).displayName || '';
  } catch (e) { return ''; }
}

function isTrigger_(text) {
  var t = String(text || '').trim().toLowerCase();
  if (t.length > 25) return false;                 // ข้อความยาว = เนื้อหา ไม่ใช่คำสั่ง
  for (var i = 0; i < TRIGGERS.length; i++) {
    if (t === TRIGGERS[i] || t.indexOf(TRIGGERS[i]) === 0) return true;
    if (t.indexOf('@น้องเควส') >= 0 && t.indexOf(TRIGGERS[i]) >= 0) return true;
  }
  return false;
}

/** เก็บข้อความล่าสุด ตัดของเก่าทิ้งเมื่อเกิน BUF_MAX */
function bufPush_(row) {
  var sh = sheetNamed_(BUF_SHEET, ['msgId','groupId','userId','name','text','ts']);
  sh.appendRow(row);
  var extra = sh.getLastRow() - 1 - BUF_MAX;
  if (extra > 0) sh.deleteRows(2, extra);
}

/** หาข้อความที่ถูกชี้ — ถ้ากดตอบกลับใช้ quotedMessageId ถ้าไม่ใช่เอาข้อความก่อนหน้า */
function bufFind_(groupId, quotedId) {
  var sh = sheetNamed_(BUF_SHEET, ['msgId','groupId','userId','name','text','ts']);
  var last = sh.getLastRow();
  if (last < 2) return null;
  var rows = sh.getRange(2, 1, last - 1, 6).getValues();
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    if (String(r[1]) !== String(groupId)) continue;
    if (quotedId) { if (String(r[0]) === String(quotedId)) return r; }
    else if (!isTrigger_(r[4])) return r;          // ข้ามคำสั่ง เอาข้อความจริงอันล่าสุด
  }
  return null;
}

/** จุดรับ webhook จาก LINE — เรียกจาก doPost หลัก */
function handleLineEvents_(body) {
  var events = body.events || [];
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') continue;

    var src     = ev.source || {};
    var groupId = src.groupId || src.roomId || '';
    var userId  = src.userId || '';
    var text    = ev.message.text || '';
    var msgId   = ev.message.id || '';
    var quoted  = ev.message.quotedMessageId || '';

    if (isTrigger_(text)) {
      var target = bufFind_(groupId, quoted);
      if (!target) { lineReply_(ev.replyToken, 'ไม่เจอข้อความที่จะจดค่ะ 🤔 ลองกดตอบกลับข้อความนั้นแล้วพิมพ์ "จด" อีกทีนะคะ'); continue; }

      sheetNamed_(INBOX_SHEET, ['ts','groupId','userId','name','text','status','note'])
        .appendRow([new Date().getTime(), groupId, target[2], target[3], target[4], 'pending', '']);

      lineReply_(ev.replyToken, 'รับทราบค่ะ 📝 เก็บของ' + (target[3] || 'พี่') + 'ไว้แล้ว เดี๋ยวลงระบบให้นะคะ');
      continue;
    }

    // ไม่ใช่คำสั่ง = เก็บใส่ buffer เฉยๆ ไม่ตอบ ไม่วิเคราะห์
    bufPush_([msgId, groupId, userId, lineName_(groupId, userId), text, new Date().getTime()]);
  }
}

/* ===== ฟังก์ชันให้ Claude เรียกใช้ (ผ่าน doGet/doPost ที่มี token) ===== */

/** อ่านกล่องที่รอประมวลผล */
function inboxList_() {
  var sh = sheetNamed_(INBOX_SHEET, ['ts','groupId','userId','name','text','status','note']);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, 7).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][5]) !== 'pending') continue;
    out.push({ row: i + 2, ts: rows[i][0], groupId: rows[i][1], userId: rows[i][2],
               name: rows[i][3], text: rows[i][4] });
  }
  return out;
}

/** มาร์กว่าจัดการแล้ว */
function inboxDone_(rows, note) {
  var sh = sheetNamed_(INBOX_SHEET, ['ts','groupId','userId','name','text','status','note']);
  (rows || []).forEach(function (r) {
    if (r > 1 && r <= sh.getLastRow()) {
      sh.getRange(r, 6).setValue('done');
      if (note) sh.getRange(r, 7).setValue(note);
    }
  });
}
