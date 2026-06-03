const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const archiver = require('archiver');
const { exiftool } = require('exiftool-vendored');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE = __dirname;
const UPLOAD_DIR = path.join(BASE, 'uploads');
const OUTPUT_DIR = path.join(BASE, 'outputs');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(BASE, 'public')));
app.use('/downloads', express.static(OUTPUT_DIR));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]+/g, '-');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safe}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024, files: 100 },
  fileFilter: (_, file, cb) => {
    const ok = /image\/(jpeg|jpg)/i.test(file.mimetype) || /\.jpe?g$/i.test(file.originalname);
    cb(ok ? null : new Error('Only JPG/JPEG files are supported for full metadata writing.'), ok);
  }
});

function slugifyFileName(input, fallback) {
  const base = (input || fallback || 'ohana-nails-photo')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'ohana-nails-photo';
}

function splitKeywords(raw) {
  return (raw || '')
    .split(/[\n,;]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

const PRESET = {
  lat: 33.79568800,
  lon: -118.10855270,
  latRef: 'N',
  lonRef: 'W',
  locationText: 'Long Beach, California 90815',
  countryCode: 'USA',
  country: 'United States',
  state: 'California',
  city: 'Long Beach',
  sublocation: '90815',
  postalCode: '90815',
  address: '2221 Palo Verde Ave # 1AA',
  phone: '(562) 493-4606',
  url: 'https://ohananailslongbeach.com/',
  brand: 'Ohana Nails',
  category: 'nailsalon',
  caption: 'Nail salon 90815 | Ohana Nails | Long Beach, California 90815'
};

async function writeMetadata(inputPath, outputPath, keywords) {
  await fsp.copyFile(inputPath, outputPath);
  const keywordList = splitKeywords(keywords);
  const tagData = {
    // GPS / EXIF
    GPSLatitude: Math.abs(PRESET.lat),
    GPSLatitudeRef: PRESET.latRef,
    GPSLongitude: Math.abs(PRESET.lon),
    GPSLongitudeRef: PRESET.lonRef,
    GPSImgDirection: 0,
    GPSImgDirectionRef: 'T',

    // Common EXIF/XMP/IPTC identity fields
    Artist: PRESET.brand,
    Creator: PRESET.brand,
    Byline: PRESET.brand,
    Credit: PRESET.brand,
    Source: PRESET.brand,
    CaptionWriter: PRESET.brand,
    Copyright: PRESET.brand,
    CopyrightNotice: PRESET.brand,
    WebStatement: PRESET.url,
    URL: PRESET.url,

    // Description fields
    ObjectName: PRESET.caption,
    Title: PRESET.caption,
    Headline: PRESET.caption,
    Description: PRESET.caption,
    CaptionAbstract: PRESET.caption,
    Instructions: PRESET.caption,
    SpecialInstructions: PRESET.caption,

    // Category / keywords
    Category: PRESET.category,
    Subject: keywordList,
    Keywords: keywordList,
    HierarchicalSubject: keywordList,

    // Location fields
    CountryCode: PRESET.countryCode,
    Country: PRESET.country,
    Country_PrimaryLocationName: PRESET.country,
    Province_State: PRESET.state,
    State: PRESET.state,
    City: PRESET.city,
    Sublocation: PRESET.sublocation,
    Location: PRESET.locationText,

    // IPTC Contact / Creator contact fields
    CreatorAddress: PRESET.address,
    CreatorCity: PRESET.city,
    CreatorRegion: PRESET.state,
    CreatorPostalCode: PRESET.postalCode,
    CreatorCountry: PRESET.country,
    CreatorWorkTelephone: PRESET.phone,
    CreatorWorkURL: PRESET.url,
    Contact: PRESET.address,
    ContactCity: PRESET.city,
    ContactState: PRESET.state,
    ContactCountry: PRESET.country,
    ContactPostalCode: PRESET.postalCode,
    ContactPhone: PRESET.phone,
    ContactURL: PRESET.url
  };
  await exiftool.write(outputPath, tagData, ['-overwrite_original']);
}

app.get('/api/health', (_, res) => res.json({ ok: true, app: 'Ohana Nails Metadata App', version: '2.0.0' }));

app.post('/api/process', upload.array('images', 100), async (req, res) => {
  const batchId = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const batchDir = path.join(OUTPUT_DIR, batchId);
  await fsp.mkdir(batchDir, { recursive: true });
  const keywordsMap = JSON.parse(req.body.keywordsMap || '{}');
  const nameMap = JSON.parse(req.body.nameMap || '{}');
  const results = [];

  try {
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const rawKeywords = keywordsMap[file.originalname] || keywordsMap[String(i)] || '';
      const firstKw = splitKeywords(rawKeywords)[0] || 'nail-salon-90815-ohana-nails';
      const outName = `${slugifyFileName(nameMap[file.originalname] || firstKw, path.parse(file.originalname).name)}.jpg`;
      const outputPath = path.join(batchDir, outName);
      await writeMetadata(file.path, outputPath, rawKeywords);
      results.push({ original: file.originalname, output: outName, url: `/downloads/${batchId}/${encodeURIComponent(outName)}` });
      await fsp.unlink(file.path).catch(() => {});
    }

    const zipName = `ohana-nails-seo-images-${batchId}.zip`;
    const zipPath = path.join(OUTPUT_DIR, zipName);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(output);
    archive.directory(batchDir, false);
    await archive.finalize();
    output.on('close', () => {
      res.json({ ok: true, results, zipUrl: `/downloads/${zipName}` });
    });
  } catch (err) {
    for (const file of req.files || []) await fsp.unlink(file.path).catch(() => {});
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

process.on('SIGINT', async () => { await exiftool.end(); process.exit(0); });
process.on('SIGTERM', async () => { await exiftool.end(); process.exit(0); });

app.listen(PORT, () => console.log(`Ohana Nails Metadata App running on port ${PORT}`));
