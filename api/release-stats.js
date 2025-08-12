// /api/release-stats.js
// Returns aggregates for the ENTIRE filtered dataset (ignores pagination/sort)
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
  const rows = json.map(r => ({
    artist:  s(r[COL.artist]),
    release: s(r[COL.release]),
    country: s(r[COL.country]),
    date:    toDate(r[COL.date])
  })).filter(r => r.artist && r.release && r.date);

  CACHE = rows; MTIME = st.mtimeMs;
  return rows;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const all = loadRows();

    // filters (same as /api/releases)
    const q = String(req.query.q || '').toLowerCase();
    const countries = [].concat(req.query.country || []).map(v => String(v).toLowerCase());
    const start = req.query.start ? new Date(String(req.query.start)) : null;
    const end   = req.query.end   ? new Date(String(req.query.end))   : null;

    const filtered = all.filter(r => {
      if (q && !r.artist.toLowerCase().includes(q)) return false;
      if (countries.length && !countries.includes((r.country||'').toLowerCase())) return false;
      if (start && r.date < start) return false;
      if (end   && r.date > end)   return false;
      return true;
    });

    // aggregates over the WHOLE filtered set
    const byArtist = {};
    const byCountry = {};
    for (const r of filtered){
      byArtist[r.artist] = (byArtist[r.artist]||0) + 1;
      const c = r.country || 'Unknown';
      byCountry[c] = (byCountry[c]||0) + 1;
    }

    const toTop = (obj, n=5) =>
      Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,n)
        .map(([label, count]) => ({ label, count }));

    res.json({
      total: filtered.length,
      topArtists:  toTop(byArtist, 5),
      topCountries: toTop(byCountry, 5)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e && e.message || e) });
  }
};
