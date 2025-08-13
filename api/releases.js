// /api/releases.js
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const COL = {
  artist:  'Artist Name',
  release: 'Release Name',
  country: 'Artist Country',
  date:    'Release Date'
};

let CACHE = null, MTIME = 0;

function excelSerialToDate(n){
  const ms = Math.round((n - 25569) * 86400 * 1000);
  return new Date(ms);
}
function toDate(val){
  if (val instanceof Date && !isNaN(val)) return val;
  if (typeof val === 'number') return excelSerialToDate(val);
  const t = Date.parse(val);
  return isNaN(t) ? null : new Date(t);
}

function loadRows(){
  const filePath = path.join(process.cwd(), 'data', 'NewReleases.xlsx');
  const st = fs.statSync(filePath);
  if (CACHE && st.mtimeMs === MTIME) return CACHE;

  const wb = XLSX.read(fs.readFileSync(filePath), { cellDates:true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws, { defval:'' });

  const s = v => (v==null ? '' : String(v)).trim();

  // ✅ Do NOT drop undated rows (date can be null)
  const rows = json.map(r => ({
    artist:  s(r[COL.artist]),
    release: s(r[COL.release]),
    country: s(r[COL.country]),
    date:    toDate(r[COL.date]) || null
  }))
  // Keep if artist & release exist (date may be null)
  .filter(r => r.artist && r.release);

  CACHE = rows; MTIME = st.mtimeMs;
  return rows;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const all = loadRows();

    // ---- filters ----
    const q = String(req.query.q || '').toLowerCase();
    const countries = [].concat(req.query.country || []).map(v => String(v).toLowerCase());
    const start = req.query.start ? new Date(String(req.query.start)) : null;
    const end   = req.query.end   ? new Date(String(req.query.end))   : null;

    // ✅ includeUndated flag (default: true)
    const includeUndated = String(req.query.includeUndated ?? 'true') === 'true';

    let filtered = all.filter(r => {
      if (q && !r.artist.toLowerCase().includes(q)) return false;
      if (countries.length && !countries.includes((r.country||'').toLowerCase())) return false;

      // ✅ Date logic: allow undated unless explicitly excluded
      if (!r.date) return includeUndated;

      if (start && r.date < start) return false;
      if (end   && r.date > end)   return false;
      return true;
    });

    // ---- sorting ----
    const sortBy  = (req.query.sortBy || 'date');   // 'artist'|'release'|'country'|'date'
    const sortDir = (req.query.sortDir || 'desc');  // 'asc'|'desc'

    const cmp = (a, b) => {
      let va = a[sortBy], vb = b[sortBy];

      if (sortBy === 'date') {
        // ✅ Put undated LAST regardless of direction
        const aNull = (a.date == null);
        const bNull = (b.date == null);
        if (aNull && bNull) return 0;
        if (aNull) return 1;
        if (bNull) return -1;
        va = a.date.getTime();
        vb = b.date.getTime();
      }

      const base = (va > vb ? 1 : va < vb ? -1 : 0);
      return sortDir === 'asc' ? base : -base;
    };
    filtered.sort(cmp);

    // ---- pagination ----
    const total  = filtered.length;
    const limit  = Math.min(parseInt(req.query.limit || '100', 10) || 100, 1000);
    const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
    const page   = filtered.slice(offset, offset + limit);

    res.json({
      total,
      count: page.length,
      offset,
      limit,
      sortBy,
      sortDir,
      results: page.map(r => ({
        artist:  r.artist,
        release: r.release,
        country: r.country,
        date:    r.date ? r.date.toISOString() : null  // ✅ return null if missing
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e && e.message || e) });
  }
};
