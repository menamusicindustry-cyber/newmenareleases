// /api/summary.js
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const FILES = {
  'top-artists'  : 'SummaryTopArtists.xlsx',
  'country-year' : 'SummaryCountryYear.xlsx',
  'top-countries': 'SummaryTopCountries.xlsx'
};

// Column headers expected in those files:
const COLS = {
  'top-artists'  : { artist:'Artist', releases:'Releases' },
  'country-year' : { year:'Year', country:'Country', releases:'Releases' },
  'top-countries': { country:'Country', releases:'Releases' }
};

function readSummary(kind){
  const file = FILES[kind];
  if (!file) throw new Error('Unknown summary kind');
  const fp = path.join(process.cwd(), 'data', file);
  if (!fs.existsSync(fp)) {
    const err = new Error(`Summary file not found: ${file}`);
    err.code = 'ENOENT';
    throw err;
  }
  const wb = XLSX.read(fs.readFileSync(fp));
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const kind = String(req.query.kind || '');
  try {
    const rows = readSummary(kind);
    const c = COLS[kind];

    if (kind === 'top-artists') {
      const out = rows.map(r => ({
        artist: String(r[c.artist] ?? '').trim(),
        releases: Number(r[c.releases] ?? 0) || 0
      })).filter(r => r.artist);
      return res.json({ results: out });
    }

    if (kind === 'country-year') {
      const out = rows.map(r => ({
        year: Number(r[c.year] ?? 0) || 0,
        country: String(r[c.country] ?? '').trim(),
        releases: Number(r[c.releases] ?? 0) || 0
      })).filter(r => r.year && r.country);
      return res.json({ results: out });
    }

    if (kind === 'top-countries') {
      const out = rows.map(r => ({
        country: String(r[c.country] ?? '').trim(),
        releases: Number(r[c.releases] ?? 0) || 0
      })).filter(r => r.country);
      return res.json({ results: out });
    }

    res.status(400).json({ error: 'Unknown kind' });
  } catch (e) {
    if (e.code === 'ENOENT') {
      // Helpful message for when the summary file hasn't been uploaded yet
      return res.status(404).json({ error: String(e.message || e) });
    }
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
};
