// /api/releases.js
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const COL = {
  artist:  'Artist Name',
  release: 'Release Name',
  country: 'Artist Country',
  date:    'Release Date',
  label:   'Label Name',   // NEW
  gender:  'Gender'        // NEW
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

  // Keep rows even if date is missing (date may be null)
  const rows = json.map(r => ({
    artist:  s(r[COL.artist]),
    release: s(r[COL.release]),
    country: s(r[COL.country]),
    date:    toDate(r[COL.date]) || null,
    label:   s(r[COL.label]),
    gender:  s(r[COL.gender])
  }))
  .filter(r => r.artist && r.release); // only require artist + release

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

    // helper to read repeatable params: ?country=A&country=B or comma-separated
    const toList = (key) => {
      let vals = [].concat(req.query[key] || []);
      if (vals.length === 1 && String(vals[0]).includes(',')) {
        vals = String(vals[0]).split(','); // allow comma list
      }
      return vals.map(v => String(v).trim()).filter(Boolean);
    };

    const countries = toList('country').map(v => v.toLowerCase());
    const labels    = toList('label').map(v => v.toLowerCase());
    const genders   = toList('gender').map(v => v.toLowerCase());

    const start = req.query.start ? new Date(String(req.query.start)) : null;
    const end   = req.query.end   ? new Date(String(req.query.end))   : null;

    // includeUndated (default true)
    const includeUndated = String(req.query.includeUndated ?? 'true') === 'true';

    let filtered = all.filter(r => {
      if (q && !r.artist.toLowerCase().includes(q)) return false;

      if (countries.length && !countries.includes((r.country || '').toLowerCase())) return false;
      if (labels.length    && !labels.includes((r.label   || '').toLowerCase()))   return false;
      if (genders.length   && !genders.includes((r.gender || '').toLowerCase()))   return false;

      // Date filter: apply only to rows that HAVE a date
      if (!r.date) return includeUndated;

      if (start && r.date < start) return false;
      if (end   && r.date > end)   return false;

      return true;
    });

    // ---- sorting ----
    const allowedSort = new Set(['artist','release','country','date','label','gender']);
    const sortBy  = allowedSort.has(String(req.query.sortBy)) ? String(req.query.sortBy) : 'date';
    const sortDir = (req.query.sortDir === 'asc' ? 'asc' : 'desc');

    const cmp = (a, b) => {
      let va = a[sortBy], vb = b[sortBy];

      if (sortBy === 'date') {
        // Put undated LAST regardless of direction
        const aNull = (a.date == null);
        const bNull = (b.date == null);
        if (aNull && bNull) return 0;
        if (aNull) return 1;
        if (bNull) return -1;
        va = a.date.getTime();
        vb = b.date.getTime();
      } else {
        // case-insensitive string compare
        va = (va || '').toString().toLowerCase();
        vb = (vb || '').toString().toLowerCase();
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
        date:    r.date ? r.date.toISOString() : null,
        label:   r.label || null,   // NEW
        gender:  r.gender || null   // NEW
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e && e.message || e) });
  }
};
