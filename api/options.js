// /api/options.js
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

// Optional: normalize country name variants here
const CANON = new Map([
  ['uae', 'United Arab Emirates'],
  ['u.a.e.', 'United Arab Emirates'],
  ['u a e', 'United Arab Emirates'],
  ['palestine', 'State of Palestine'],
  ['kurdistan', 'Iraq'], // example mapping if present in your data
  // add any other aliases you want to collapse
]);
function canonicalCountry(name){
  if (!name) return '';
  const key = name.toLowerCase().replace(/\./g,'').replace(/\s+/g,' ').trim();
  return CANON.get(key) || name.trim();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const rows = loadRows();

    let min = null, max = null;
    const countriesSet = new Set();
    for (const r of rows){
      const c = canonicalCountry(r.country || '');
      if (c) countriesSet.add(c);
      const t = r.date.getTime();
      if (min === null || t < min) min = t;
      if (max === null || t > max) max = t;
    }

    const countries = Array.from(countriesSet).sort((a,b)=>a.localeCompare(b));
    res.json({
      countries,
      minDate: min ? new Date(min).toISOString() : null,
      maxDate: max ? new Date(max).toISOString() : null
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e && e.message || e) });
  }
};
