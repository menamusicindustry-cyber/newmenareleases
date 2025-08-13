// /api/release-stats.js
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const COL = {
  artist:  'Artist Name',
  release: 'Release Name',
  country: 'Artist Country',
  date:    'Release Date',
  label:   'Label Name',
  gender:  'Gender'
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
    date:    toDate(r[COL.date]) || null,
    label:   s(r[COL.label]),
    gender:  s(r[COL.gender])
  })).filter(r => r.artist && r.release);

  CACHE = rows; MTIME = st.mtimeMs;
  return rows;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const all = loadRows();

    const toList = (key) => {
      let vals = [].concat(req.query[key] || []);
      if (vals.length === 1 && String(vals[0]).includes(',')) vals = String(vals[0]).split(',');
      return vals.map(v => String(v).trim()).filter(Boolean);
    };

    const q        = String(req.query.q || '').toLowerCase();
    const countries= toList('country').map(v => v.toLowerCase());
    const labels   = toList('label').map(v => v.toLowerCase());
    const genders  = toList('gender').map(v => v.toLowerCase());
    const start    = req.query.start ? new Date(String(req.query.start)) : null;
    const end      = req.query.end   ? new Date(String(req.query.end))   : null;
    const includeUndated = String(req.query.includeUndated ?? 'true') === 'true';

    const filtered = all.filter(r => {
      if (q && !r.artist.toLowerCase().includes(q)) return false;
      if (countries.length && !countries.includes((r.country||'').toLowerCase())) return false;
      if (labels.length    && !labels.includes((r.label  ||'').toLowerCase()))   return false;
      if (genders.length   && !genders.includes((r.gender||'').toLowerCase()))   return false;

      if (!r.date) return includeUndated;
      if (start && r.date < start) return false;
      if (end   && r.date > end)   return false;
      return true;
    });

    // Aggregates
    const byArtist = {};
    const byCountry= {};
    let male=0, female=0, other=0;

    for (const r of filtered){
      byArtist[r.artist]  = (byArtist[r.artist]  || 0) + 1;
      byCountry[r.country || 'Unknown'] = (byCountry[r.country || 'Unknown'] || 0) + 1;

      const g = (r.gender || '').toLowerCase();
      if (g === 'male' || g === 'm') male++;
      else if (g === 'female' || g === 'f') female++;
      else other++;
    }

    const top = (obj, n=5) =>
      Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,n)
        .map(([label,count])=>({label,count}));

    res.json({
      total: filtered.length,
      topArtists:  top(byArtist),
      topCountries:top(byCountry),
      genderCounts: { male, female, other }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message || e) });
  }
};
