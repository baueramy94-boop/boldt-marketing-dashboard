/**
 * Boldt Marketing Dashboard: shared storage for the marketing project calendar.
 * Paste this whole file into Extensions > Apps Script in the
 * "Marketing Project Tracker (live)" Google Sheet, then Deploy > New deployment >
 * Web app (Execute as: Me, Who has access: Anyone). Copy the web app URL.
 *
 * The dashboard site calls this through its own server, never from the browser,
 * and every call must carry the token below.
 */
const TOKEN = '67Q0AM827EdY7BYQKfZ3vkJwbY33bRdR';

const ITEM_COLS = ['id','title','ws','owners','due','prec','status','waiting','notes','src','recurring','group','target','subtasks','completedAt','updatedAt','updatedBy','extra'];
const ARCH_COLS = ['id','title','type','market','date','status','link','editLink','owners','tags','notes','fromItem','auto','updatedAt','updatedBy','thumb','thumb2','extra'];
const LIST_FIELDS = { owners: 1, tags: 1 };
const JSON_FIELDS = { subtasks: 1 };
const BOOL_FIELDS = { target: 1, auto: 1 };
const CELL_MAX = 49000;

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.token !== TOKEN) return json_({ ok: false, error: 'unauthorized' });
  try {
    if (p.action === 'tracker') return json_(readTracker_());
    return json_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  if (body.token !== TOKEN) return json_({ ok: false, error: 'unauthorized' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const who = String(body.user || '').slice(0, 60);
    const now = new Date().toISOString();
    const up = body.upserts || {}, del = body.deletes || {};
    write_('Items', ITEM_COLS, up.items || [], del.items || [], who, now);
    write_('Archive', ARCH_COLS, up.archive || [], del.archive || [], who, now);
    if (Array.isArray(body.archiveIgnore)) setMeta_('archiveIgnore', JSON.stringify(body.archiveIgnore));
    setMeta_('lastSave', now + (who ? ' by ' + who : ''));
    return json_({ ok: true, savedAt: now });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- tracker storage ---------- */
function sheet_(name, cols) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function toRow_(obj, cols, who, now) {
  const extra = {};
  Object.keys(obj).forEach(k => { if (cols.indexOf(k) < 0) extra[k] = obj[k]; });
  const thumb = String(obj.thumb || '');
  return cols.map(c => {
    if (c === 'updatedAt') return now;
    if (c === 'updatedBy') return who;
    if (c === 'extra') return Object.keys(extra).length ? JSON.stringify(extra) : '';
    if (c === 'thumb') return thumb.slice(0, CELL_MAX);
    if (c === 'thumb2') return thumb.slice(CELL_MAX, CELL_MAX * 2);
    const v = obj[c];
    if (v === undefined || v === null) return '';
    if (LIST_FIELDS[c]) return (v || []).join('; ');
    if (JSON_FIELDS[c]) return JSON.stringify(v || []);
    if (BOOL_FIELDS[c]) return v ? 'TRUE' : 'FALSE';
    return String(v);
  });
}

function fromRow_(row, cols) {
  const o = {};
  let thumb = '';
  cols.forEach((c, i) => {
    let v = row[i];
    if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    v = v === null || v === undefined ? '' : String(v);
    if (c === 'extra') { if (v) { try { Object.assign(o, JSON.parse(v)); } catch (e) {} } return; }
    if (c === 'thumb' || c === 'thumb2') { thumb += v; return; }
    if (LIST_FIELDS[c]) { o[c] = v ? v.split(/;\s*/).filter(String) : []; return; }
    if (JSON_FIELDS[c]) { try { o[c] = v ? JSON.parse(v) : []; } catch (e) { o[c] = []; } return; }
    if (BOOL_FIELDS[c]) { o[c] = v.toUpperCase() === 'TRUE'; return; }
    if ((c === 'recurring' || c === 'prec' || c === 'group' || c === 'fromItem') && !v) { o[c] = null; return; }
    o[c] = v;
  });
  if (cols.indexOf('thumb') >= 0) o.thumb = thumb;
  return o;
}

function write_(name, cols, upserts, deletes, who, now) {
  if (!upserts.length && !deletes.length) return;
  const sh = sheet_(name, cols);
  sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
  const last = sh.getLastRow();
  const ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0])) : [];
  const delSet = {};
  deletes.forEach(id => delSet[id] = 1);
  upserts.forEach(obj => {
    const row = toRow_(obj, cols, who, now);
    const i = ids.indexOf(String(obj.id));
    if (i >= 0) sh.getRange(i + 2, 1, 1, cols.length).setValues([row]);
    else { sh.appendRow(row); ids.push(String(obj.id)); }
  });
  for (let i = ids.length - 1; i >= 0; i--) if (delSet[ids[i]]) sh.deleteRow(i + 2);
}

function readTracker_() {
  const read = (name, cols) => {
    const sh = SpreadsheetApp.getActive().getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return [];
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    const order = cols.map(c => head.indexOf(c));
    return rows.filter(r => String(r[order[0]] || '').trim())
      .map(r => fromRow_(order.map(j => j >= 0 ? r[j] : ''), cols));
  };
  let ignore = [];
  try { ignore = JSON.parse(getMeta_('archiveIgnore') || '[]'); } catch (e) {}
  return { ok: true, items: read('Items', ITEM_COLS), archive: read('Archive', ARCH_COLS), archiveIgnore: ignore, lastSave: getMeta_('lastSave') || '' };
}

function getMeta_(k) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Meta');
  if (!sh) return '';
  const v = sh.getDataRange().getValues().find(r => r[0] === k);
  return v ? String(v[1]) : '';
}
function setMeta_(k, val) {
  const sh = sheet_('Meta', ['key', 'value']);
  const rows = sh.getDataRange().getValues();
  const i = rows.findIndex(r => r[0] === k);
  if (i >= 0) sh.getRange(i + 1, 2).setValue(val); else sh.appendRow([k, val]);
}
