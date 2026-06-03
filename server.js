const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const archiver = require('archiver');
const { exiftool } = require('exiftool-vendored');
const ffmpegPath = require('ffmpeg-static');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

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

const imageUpload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024, files: 100 },
  fileFilter: (_, file, cb) => {
    const ok = /image\/(jpeg|jpg)/i.test(file.mimetype) || /\.jpe?g$/i.test(file.originalname);
    cb(ok ? null : new Error('Only JPG/JPEG files are supported for full image metadata writing.'), ok);
  }
});

const videoUpload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024, files: 20 },
  fileFilter: (_, file, cb) => {
    const ok = /video\/(quicktime|mp4|x-m4v)/i.test(file.mimetype) || /\.(mov|mp4|m4v)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only MOV/MP4/M4V video files are supported.'), ok);
  }
});

function slugifyFileName(input, fallback) {
  const base = (input || fallback || 'nail-salon-media')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'nail-salon-media';
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

function removeUndefined(tagData) {
  return Object.fromEntries(Object.entries(tagData).filter(([, v]) => v !== undefined && v !== ''));
}

function buildImageTagData(template, keywords) {
  const keywordList = splitKeywords(keywords);
  const tagData = {
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

    ObjectName: template.caption,
    Title: template.caption,
    Headline: template.caption,
    Description: template.caption,
    CaptionAbstract: template.caption,
    Instructions: template.caption,
    SpecialInstructions: template.caption,
    Comment: template.caption,
    UserComment: template.caption,

    Category: template.category,
    Subject: keywordList,
    Keywords: keywordList,
    HierarchicalSubject: keywordList,

    CountryCode: template.countryCode,
    Country: template.country,
    Country_PrimaryLocationName: template.country,
    Province_State: template.state,
    State: template.state,
    City: template.city,
    Sublocation: template.sublocation,
    Location: template.locationText,

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
  return removeUndefined(tagData);
}

function buildVideoTagData(template, keywords) {
  const keywordList = splitKeywords(keywords);
  const keywordText = keywordList.join('; ');
  const gpsText = (typeof template.lat === 'number' && typeof template.lon === 'number')
    ? `${template.lat} ${template.lon} 0`
    : undefined;
  const gpsIso6709 = (typeof template.lat === 'number' && typeof template.lon === 'number')
    ? `${template.lat >= 0 ? '+' : '-'}${Math.abs(template.lat).toFixed(6)}${template.lon >= 0 ? '+' : '-'}${Math.abs(template.lon).toFixed(6)}+000.000/`
    : undefined;

  // Video metadata cần ghi nhiều namespace cùng lúc vì Windows, macOS, GeoSetter,
  // ExifTool đọc các trường khác nhau. MP4/QuickTime ưu tiên ItemList/Keys/UserData.
  return removeUndefined({
    Title: template.caption,
    Subtitle: template.caption,
    Description: template.caption,
    Comment: template.caption,
    Artist: template.brand,
    Author: template.brand,
    Creator: template.brand,
    Producer: template.brand,
    Publisher: template.brand,
    Genre: template.category,
    Copyright: template.brand,
    Keywords: keywordList,
    Subject: keywordList,
    Rating: 5,
    RatingPercent: 99,

    'XMP-dc:Title': template.caption,
    'XMP-dc:Description': template.caption,
    'XMP-dc:Creator': template.brand,
    'XMP-dc:Rights': template.brand,
    'XMP-dc:Subject': keywordList,
    'XMP-xmp:Rating': 5,
    'XMP-photoshop:Headline': template.caption,
    'XMP-photoshop:City': template.city,
    'XMP-photoshop:State': template.state,
    'XMP-photoshop:Country': template.country,
    'XMP-iptcCore:Location': template.locationText,
    'XMP-iptcCore:CreatorWorkURL': template.url,
    'XMP-iptcCore:CreatorWorkTelephone': template.phone,
    'XMP-iptcCore:CreatorWorkEmail': template.email || undefined,

    'QuickTime:Artist': template.brand,
    'QuickTime:Author': template.brand,
    'QuickTime:Title': template.caption,
    'QuickTime:Description': template.caption,
    'QuickTime:Comment': template.caption,
    'QuickTime:Copyright': template.brand,
    'QuickTime:Keywords': keywordText || undefined,
    'QuickTime:GPSCoordinates': gpsText,
    'QuickTime:LocationInformation': template.locationText,

    'Keys:Artist': template.brand,
    'Keys:Author': template.brand,
    'Keys:Title': template.caption,
    'Keys:Subtitle': template.caption,
    'Keys:Description': template.caption,
    'Keys:Comment': template.caption,
    'Keys:Copyright': template.brand,
    'Keys:Keywords': keywordText || undefined,
    'Keys:Genre': template.category,
    'Keys:Publisher': template.brand,
    'Keys:EncodedBy': template.brand,
    'Keys:GPSCoordinates': gpsText,
    'Keys:LocationName': template.locationText,
    'Keys:LocationISO6709': gpsIso6709,

    'ItemList:Artist': template.brand,
    'ItemList:Title': template.caption,
    'ItemList:Subtitle': template.caption,
    'ItemList:Description': template.caption,
    'ItemList:Comment': template.caption,
    'ItemList:Copyright': template.brand,
    'ItemList:Genre': template.category,
    'ItemList:Keyword': keywordText || undefined,
    'ItemList:Publisher': template.brand,
    'ItemList:Encoder': template.brand,

    'UserData:Title': template.caption,
    'UserData:Description': template.caption,
    'UserData:Author': template.brand,
    'UserData:Copyright': template.brand,
    'UserData:Comment': template.caption,
    'UserData:Keywords': keywordText || undefined,
    'UserData:GPSCoordinates': gpsText,
    'UserData:LocationInformation': template.locationText
  });
}
async function writeImageMetadata(inputPath, outputPath, keywords, template) {
  await fsp.copyFile(inputPath, outputPath);
  await exiftool.write(outputPath, buildImageTagData(template, keywords), ['-overwrite_original']);
}

function buildFfmpegMetadataArgs(template, keywords) {
  const keywordText = splitKeywords(keywords).join('; ');
  const args = [
    '-map', '0',
    '-c', 'copy',
    '-movflags', 'use_metadata_tags',
    '-metadata', `title=${template.caption}`,
    '-metadata', `subtitle=${template.caption}`,
    '-metadata', `description=${template.caption}`,
    '-metadata', `comment=${template.caption}`,
    '-metadata', `artist=${template.brand}`,
    '-metadata', `author=${template.brand}`,
    '-metadata', `album_artist=${template.brand}`,
    '-metadata', `genre=${template.category}`,
    '-metadata', `copyright=${template.brand}`,
    '-metadata', `publisher=${template.brand}`,
    '-metadata', `encoded_by=${template.brand}`,
    '-metadata', `url=${template.url}`,
    '-metadata', `synopsis=${template.caption}`
  ];
  if (keywordText) args.push('-metadata', `keywords=${keywordText}`);
  if (typeof template.lat === 'number' && typeof template.lon === 'number') {
    const iso = `${template.lat >= 0 ? '+' : '-'}${Math.abs(template.lat).toFixed(6)}${template.lon >= 0 ? '+' : '-'}${Math.abs(template.lon).toFixed(6)}+000.000/`;
    args.push('-metadata', `location=${iso}`);
    args.push('-metadata', `location-eng=${template.locationText}`);
  }
  return args;
}

async function remuxVideoToMp4(inputPath, outputPath, keywords, template) {
  const tmpPath = outputPath.replace(/\.mp4$/i, '.tmp.mp4');
  const args = ['-y', '-i', inputPath, ...buildFfmpegMetadataArgs(template, keywords), tmpPath];
  await execFileAsync(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 20 });
  await fsp.rename(tmpPath, outputPath);
}

async function writeVideoMetadata(inputPath, outputPath, keywords, template) {
  // Bản v8 xuất video thành MP4 để Windows Properties đọc metadata tốt hơn MOV.
  // Không re-encode video, chỉ copy stream sang container MP4 rồi ghi thêm ExifTool tags.
  await remuxVideoToMp4(inputPath, outputPath, keywords, template);
  await exiftool.write(outputPath, buildVideoTagData(template, keywords), [
    '-overwrite_original',
    '-api', 'QuickTimeUTC=1',
    '-P'
  ]);
}

async function createZipFromDir(batchDir, zipPath) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(batchDir, false);
    archive.finalize();
  });
}

async function handleMediaProcess(req, res, type) {
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
      const originalExt = path.extname(file.originalname).toLowerCase();
      const ext = type === 'video' ? '.mp4' : '.jpg';
      const outName = `${slugifyFileName(nameMap[file.originalname] || firstKw, path.parse(file.originalname).name)}${ext}`;
      const outputPath = path.join(batchDir, outName);

      if (type === 'video') {
        await writeVideoMetadata(file.path, outputPath, rawKeywords, template);
      } else {
        await writeImageMetadata(file.path, outputPath, rawKeywords, template);
      }

      results.push({ original: file.originalname, output: outName, template: template.label, type, url: `/downloads/${batchId}/${encodeURIComponent(outName)}` });
      await fsp.unlink(file.path).catch(() => {});
    }

    const zipName = `${template.key}-seo-${type}s-${batchId}.zip`;
    const zipPath = path.join(OUTPUT_DIR, zipName);
    await createZipFromDir(batchDir, zipPath);
    res.json({ ok: true, template: template.label, type, results, zipUrl: `/downloads/${zipName}` });
  } catch (err) {
    for (const file of req.files || []) await fsp.unlink(file.path).catch(() => {});
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
}

app.get('/api/health', (_, res) => res.json({ ok: true, app: 'Nail SEO Metadata App', version: '8.0.0', templates: Object.keys(TEMPLATES), features: ['image-seo', 'video-seo', 'windows-video-properties-mp4'] }));
app.get('/api/templates', (_, res) => res.json({ ok: true, templates: TEMPLATES }));
app.post('/api/process', imageUpload.array('images', 100), (req, res) => handleMediaProcess(req, res, 'image'));
app.post('/api/process-video', videoUpload.array('videos', 20), (req, res) => handleMediaProcess(req, res, 'video'));

process.on('SIGINT', async () => { await exiftool.end(); process.exit(0); });
process.on('SIGTERM', async () => { await exiftool.end(); process.exit(0); });

app.listen(PORT, () => console.log(`Nail SEO Metadata App v8 running on port ${PORT}`));
