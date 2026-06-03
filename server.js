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
  const base = (input || fallback || 'nail-salon-photo')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'nail-salon-photo';
}

function splitKeywords(raw) {
  return (raw || '')
    .split(/[\n,;]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

const TEMPLATES = {
  ohana: {
    key: 'ohana',
    label: 'Ohana Nails',
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
    email: '',
    url: 'https://ohananailslongbeach.com/',
    brand: 'Ohana Nails',
    category: 'nailsalon',
    caption: 'Nail salon 90815 | Ohana Nails | Long Beach, California 90815',
    defaultFilePrefix: 'nail-salon-90815-ohana-nails'
  },
  rainbow: {
    key: 'rainbow',
    label: 'Rainbow Nails',
    lat: 33.84709830,
    lon: -117.98671080,
    latRef: 'N',
    lonRef: 'W',
    locationText: 'Buena Park, California 90620',
    countryCode: 'USA',
    country: 'United States',
    state: 'California',
    city: 'Buena Park',
    sublocation: '90620',
    postalCode: '90620',
    address: '8417 La Palma Ave',
    phone: '714-736-9278',
    email: 'rainbownails8417@gmail.com',
    url: 'https://rainbownailspa.com/',
    brand: 'Rainbow Nails',
    category: 'nailsalon',
    caption: 'Nail salon 90620 | Rainbow Nails | Buena Park, California 90620',
    defaultFilePrefix: 'nail-salon-90620-rainbow-nails'
  }
};

function getTemplate(key) {
  return TEMPLATES[key] || TEMPLATES.ohana;
}

function buildTagData(template, keywords) {
  const keywordList = splitKeywords(keywords);
  const tagData = {
    // Common EXIF/XMP/IPTC identity fields
    Artist: template.brand,
    Creator: template.brand,
    Byline: template.brand,
    Credit: template.brand,
    Source: template.brand,
    CaptionWriter: template.brand,
    Copyright: template.brand,
    CopyrightNotice: template.brand,
    WebStatement: template.url,
    URL: template.url,

    // Description fields
    ObjectName: template.caption,
    Title: template.caption,
    Headline: template.caption,
    Description: template.caption,
    CaptionAbstract: template.caption,
    Instructions: template.caption,
    SpecialInstructions: template.caption,
    Comment: template.caption,
    UserComment: template.caption,

    // Category / keywords
    Category: template.category,
    Subject: keywordList,
    Keywords: keywordList,
    HierarchicalSubject: keywordList,

    // Location fields
    CountryCode: template.countryCode,
    Country: template.country,
    Country_PrimaryLocationName: template.country,
    Province_State: template.state,
    State: template.state,
    City: template.city,
    Sublocation: template.sublocation,
    Location: template.locationText,

    // IPTC Contact / Creator contact fields
    CreatorAddress: template.address,
    CreatorCity: template.city,
    CreatorRegion: template.state,
    CreatorPostalCode: template.postalCode,
    CreatorCountry: template.country,
    CreatorWorkTelephone: template.phone,
    CreatorWorkEmail: template.email || undefined,
    CreatorWorkURL: template.url,
    Contact: template.address,
    ContactCity: template.city,
    ContactState: template.state,
    ContactCountry: template.country,
    ContactPostalCode: template.postalCode,
    ContactPhone: template.phone,
    ContactEmail: template.email || undefined,
    ContactURL: template.url,

    // Windows / XMP rating - hiển thị 5 sao trong Windows Properties / GeoSetter
    Rating: 5,
    RatingPercent: 99
  };

  if (typeof template.lat === 'number' && typeof template.lon === 'number') {
    Object.assign(tagData, {
      GPSLatitude: Math.abs(template.lat),
      GPSLatitudeRef: template.lat >= 0 ? 'N' : 'S',
      GPSLongitude: Math.abs(template.lon),
      GPSLongitudeRef: template.lon >= 0 ? 'E' : 'W',
      GPSImgDirection: 0,
      GPSImgDirectionRef: 'T'
    });
  }

  // Remove undefined values so ExifTool does not write empty tags unexpectedly.
  return Object.fromEntries(Object.entries(tagData).filter(([, v]) => v !== undefined));
}

async function writeMetadata(inputPath, outputPath, keywords, template) {
  await fsp.copyFile(inputPath, outputPath);
  const tagData = buildTagData(template, keywords);
  await exiftool.write(outputPath, tagData, ['-overwrite_original']);
}

app.get('/api/health', (_, res) => res.json({ ok: true, app: 'Nail SEO Metadata App', version: '5.0.0', templates: Object.keys(TEMPLATES) }));
app.get('/api/templates', (_, res) => res.json({ ok: true, templates: TEMPLATES }));

app.post('/api/process', upload.array('images', 100), async (req, res) => {
  const batchId = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const batchDir = path.join(OUTPUT_DIR, batchId);
  await fsp.mkdir(batchDir, { recursive: true });
  const keywordsMap = JSON.parse(req.body.keywordsMap || '{}');
  const nameMap = JSON.parse(req.body.nameMap || '{}');
  const template = getTemplate(req.body.templateKey || 'ohana');
  const results = [];

  try {
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const rawKeywords = keywordsMap[file.originalname] || keywordsMap[String(i)] || '';
      const firstKw = splitKeywords(rawKeywords)[0] || template.defaultFilePrefix;
      const outName = `${slugifyFileName(nameMap[file.originalname] || firstKw, path.parse(file.originalname).name)}.jpg`;
      const outputPath = path.join(batchDir, outName);
      await writeMetadata(file.path, outputPath, rawKeywords, template);
      results.push({ original: file.originalname, output: outName, template: template.label, url: `/downloads/${batchId}/${encodeURIComponent(outName)}` });
      await fsp.unlink(file.path).catch(() => {});
    }

    const zipName = `${template.key}-seo-images-${batchId}.zip`;
    const zipPath = path.join(OUTPUT_DIR, zipName);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(output);
    archive.directory(batchDir, false);
    await archive.finalize();
    output.on('close', () => {
      res.json({ ok: true, template: template.label, results, zipUrl: `/downloads/${zipName}` });
    });
  } catch (err) {
    for (const file of req.files || []) await fsp.unlink(file.path).catch(() => {});
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

process.on('SIGINT', async () => { await exiftool.end(); process.exit(0); });
process.on('SIGTERM', async () => { await exiftool.end(); process.exit(0); });

app.listen(PORT, () => console.log(`Nail SEO Metadata App running on port ${PORT}`));
