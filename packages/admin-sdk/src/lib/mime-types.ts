/** The file types a space can accept: families first, then exact types. */
export interface MimeTypeOption {
  value: string;
  label: string;
  /** Typical extensions, for search and display. */
  ext?: string;
  family: 'image' | 'video' | 'audio' | 'document' | 'archive' | 'data' | 'font' | 'code';
  /** A family entry (`image/`) takes every type in it. */
  isFamily?: boolean;
}

const MIME_FAMILIES: MimeTypeOption[] = [
  { value: 'image/', label: 'All images', family: 'image', isFamily: true },
  { value: 'video/', label: 'All video', family: 'video', isFamily: true },
  { value: 'audio/', label: 'All audio', family: 'audio', isFamily: true },
  { value: 'font/', label: 'All fonts', family: 'font', isFamily: true },
  { value: 'text/', label: 'All plain-text types', family: 'code', isFamily: true },
];

const MIME_TYPES: MimeTypeOption[] = [
  // Images
  { value: 'image/jpeg', label: 'JPEG image', ext: 'jpg, jpeg', family: 'image' },
  { value: 'image/png', label: 'PNG image', ext: 'png', family: 'image' },
  { value: 'image/gif', label: 'GIF image', ext: 'gif', family: 'image' },
  { value: 'image/webp', label: 'WebP image', ext: 'webp', family: 'image' },
  { value: 'image/avif', label: 'AVIF image', ext: 'avif', family: 'image' },
  { value: 'image/heic', label: 'HEIC image (iPhone)', ext: 'heic', family: 'image' },
  { value: 'image/heif', label: 'HEIF image', ext: 'heif', family: 'image' },
  { value: 'image/svg+xml', label: 'SVG vector image', ext: 'svg', family: 'image' },
  { value: 'image/bmp', label: 'Bitmap image', ext: 'bmp', family: 'image' },
  { value: 'image/tiff', label: 'TIFF image', ext: 'tif, tiff', family: 'image' },
  { value: 'image/x-icon', label: 'Icon', ext: 'ico', family: 'image' },
  { value: 'image/vnd.microsoft.icon', label: 'Icon (Microsoft)', ext: 'ico', family: 'image' },
  { value: 'image/apng', label: 'Animated PNG', ext: 'apng', family: 'image' },
  { value: 'image/jxl', label: 'JPEG XL image', ext: 'jxl', family: 'image' },
  { value: 'image/vnd.adobe.photoshop', label: 'Photoshop document', ext: 'psd', family: 'image' },
  { value: 'image/x-raw', label: 'Camera raw image', ext: 'raw', family: 'image' },
  // Video
  { value: 'video/mp4', label: 'MP4 video', ext: 'mp4, m4v', family: 'video' },
  { value: 'video/webm', label: 'WebM video', ext: 'webm', family: 'video' },
  { value: 'video/quicktime', label: 'QuickTime video', ext: 'mov', family: 'video' },
  { value: 'video/x-msvideo', label: 'AVI video', ext: 'avi', family: 'video' },
  { value: 'video/x-matroska', label: 'Matroska video', ext: 'mkv', family: 'video' },
  { value: 'video/mpeg', label: 'MPEG video', ext: 'mpeg, mpg', family: 'video' },
  { value: 'video/ogg', label: 'Ogg video', ext: 'ogv', family: 'video' },
  { value: 'video/3gpp', label: '3GPP video', ext: '3gp', family: 'video' },
  { value: 'video/x-ms-wmv', label: 'Windows Media video', ext: 'wmv', family: 'video' },
  { value: 'video/x-flv', label: 'Flash video', ext: 'flv', family: 'video' },
  // Audio
  { value: 'audio/mpeg', label: 'MP3 audio', ext: 'mp3', family: 'audio' },
  { value: 'audio/wav', label: 'WAV audio', ext: 'wav', family: 'audio' },
  { value: 'audio/x-wav', label: 'WAV audio (x-wav)', ext: 'wav', family: 'audio' },
  { value: 'audio/ogg', label: 'Ogg audio', ext: 'ogg, oga', family: 'audio' },
  { value: 'audio/aac', label: 'AAC audio', ext: 'aac', family: 'audio' },
  { value: 'audio/mp4', label: 'MP4 audio', ext: 'm4a', family: 'audio' },
  { value: 'audio/flac', label: 'FLAC audio', ext: 'flac', family: 'audio' },
  { value: 'audio/webm', label: 'WebM audio', ext: 'weba', family: 'audio' },
  { value: 'audio/aiff', label: 'AIFF audio', ext: 'aif, aiff', family: 'audio' },
  { value: 'audio/midi', label: 'MIDI', ext: 'mid, midi', family: 'audio' },
  { value: 'audio/opus', label: 'Opus audio', ext: 'opus', family: 'audio' },
  // Documents
  { value: 'application/pdf', label: 'PDF document', ext: 'pdf', family: 'document' },
  { value: 'application/msword', label: 'Word document (.doc)', ext: 'doc', family: 'document' },
  {
    value: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'Word document',
    ext: 'docx',
    family: 'document',
  },
  {
    value: 'application/vnd.ms-excel',
    label: 'Excel workbook (.xls)',
    ext: 'xls',
    family: 'document',
  },
  {
    value: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    label: 'Excel workbook',
    ext: 'xlsx',
    family: 'document',
  },
  {
    value: 'application/vnd.ms-powerpoint',
    label: 'PowerPoint (.ppt)',
    ext: 'ppt',
    family: 'document',
  },
  {
    value: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    label: 'PowerPoint presentation',
    ext: 'pptx',
    family: 'document',
  },
  {
    value: 'application/vnd.oasis.opendocument.text',
    label: 'OpenDocument text',
    ext: 'odt',
    family: 'document',
  },
  {
    value: 'application/vnd.oasis.opendocument.spreadsheet',
    label: 'OpenDocument spreadsheet',
    ext: 'ods',
    family: 'document',
  },
  {
    value: 'application/vnd.oasis.opendocument.presentation',
    label: 'OpenDocument presentation',
    ext: 'odp',
    family: 'document',
  },
  {
    value: 'application/vnd.apple.pages',
    label: 'Pages document',
    ext: 'pages',
    family: 'document',
  },
  {
    value: 'application/vnd.apple.numbers',
    label: 'Numbers spreadsheet',
    ext: 'numbers',
    family: 'document',
  },
  {
    value: 'application/vnd.apple.keynote',
    label: 'Keynote presentation',
    ext: 'key',
    family: 'document',
  },
  { value: 'application/rtf', label: 'Rich text', ext: 'rtf', family: 'document' },
  { value: 'text/plain', label: 'Plain text', ext: 'txt', family: 'document' },
  { value: 'text/markdown', label: 'Markdown', ext: 'md', family: 'document' },
  { value: 'text/csv', label: 'CSV', ext: 'csv', family: 'data' },
  { value: 'text/tab-separated-values', label: 'Tab-separated values', ext: 'tsv', family: 'data' },
  { value: 'text/calendar', label: 'Calendar', ext: 'ics', family: 'data' },
  { value: 'text/vcard', label: 'vCard', ext: 'vcf', family: 'data' },
  { value: 'application/epub+zip', label: 'EPUB e-book', ext: 'epub', family: 'document' },
  {
    value: 'application/x-mobipocket-ebook',
    label: 'Mobipocket e-book',
    ext: 'mobi',
    family: 'document',
  },
  { value: 'application/vnd.visio', label: 'Visio drawing', ext: 'vsd', family: 'document' },
  {
    value: 'application/postscript',
    label: 'PostScript / Illustrator',
    ext: 'ps, ai, eps',
    family: 'document',
  },
  { value: 'application/x-indesign', label: 'InDesign document', ext: 'indd', family: 'document' },
  { value: 'application/vnd.ms-outlook', label: 'Outlook message', ext: 'msg', family: 'document' },
  { value: 'message/rfc822', label: 'Email message', ext: 'eml', family: 'document' },
  // Archives
  { value: 'application/zip', label: 'ZIP archive', ext: 'zip', family: 'archive' },
  {
    value: 'application/x-zip-compressed',
    label: 'ZIP archive (Windows)',
    ext: 'zip',
    family: 'archive',
  },
  { value: 'application/gzip', label: 'Gzip archive', ext: 'gz', family: 'archive' },
  { value: 'application/x-tar', label: 'Tar archive', ext: 'tar', family: 'archive' },
  { value: 'application/x-7z-compressed', label: '7-Zip archive', ext: '7z', family: 'archive' },
  { value: 'application/vnd.rar', label: 'RAR archive', ext: 'rar', family: 'archive' },
  { value: 'application/x-bzip2', label: 'Bzip2 archive', ext: 'bz2', family: 'archive' },
  { value: 'application/x-xz', label: 'XZ archive', ext: 'xz', family: 'archive' },
  // Data
  { value: 'application/json', label: 'JSON', ext: 'json', family: 'data' },
  { value: 'application/ld+json', label: 'JSON-LD', ext: 'jsonld', family: 'data' },
  { value: 'application/xml', label: 'XML', ext: 'xml', family: 'data' },
  { value: 'text/xml', label: 'XML (text)', ext: 'xml', family: 'data' },
  { value: 'application/yaml', label: 'YAML', ext: 'yaml, yml', family: 'data' },
  { value: 'application/toml', label: 'TOML', ext: 'toml', family: 'data' },
  { value: 'application/rss+xml', label: 'RSS feed', ext: 'rss', family: 'data' },
  { value: 'application/atom+xml', label: 'Atom feed', ext: 'atom', family: 'data' },
  { value: 'application/geo+json', label: 'GeoJSON', ext: 'geojson', family: 'data' },
  { value: 'application/gpx+xml', label: 'GPX track', ext: 'gpx', family: 'data' },
  { value: 'application/vnd.google-earth.kml+xml', label: 'KML', ext: 'kml', family: 'data' },
  { value: 'application/sql', label: 'SQL', ext: 'sql', family: 'data' },
  { value: 'application/x-sqlite3', label: 'SQLite database', ext: 'sqlite, db', family: 'data' },
  { value: 'application/octet-stream', label: 'Binary (unknown type)', ext: 'bin', family: 'data' },
  // Fonts
  { value: 'font/woff', label: 'WOFF font', ext: 'woff', family: 'font' },
  { value: 'font/woff2', label: 'WOFF2 font', ext: 'woff2', family: 'font' },
  { value: 'font/ttf', label: 'TrueType font', ext: 'ttf', family: 'font' },
  { value: 'font/otf', label: 'OpenType font', ext: 'otf', family: 'font' },
  {
    value: 'application/vnd.ms-fontobject',
    label: 'Embedded OpenType font',
    ext: 'eot',
    family: 'font',
  },
  // Code and web
  { value: 'text/html', label: 'HTML', ext: 'html, htm', family: 'code' },
  { value: 'text/css', label: 'CSS', ext: 'css', family: 'code' },
  { value: 'text/javascript', label: 'JavaScript', ext: 'js, mjs', family: 'code' },
  { value: 'application/javascript', label: 'JavaScript (application)', ext: 'js', family: 'code' },
  { value: 'application/wasm', label: 'WebAssembly', ext: 'wasm', family: 'code' },
  { value: 'application/x-sh', label: 'Shell script', ext: 'sh', family: 'code' },
  { value: 'application/x-httpd-php', label: 'PHP', ext: 'php', family: 'code' },
  { value: 'text/x-python', label: 'Python', ext: 'py', family: 'code' },
  { value: 'application/x-yaml', label: 'YAML (x-yaml)', ext: 'yaml', family: 'data' },
  // 3D and design
  { value: 'model/gltf+json', label: 'glTF 3D model', ext: 'gltf', family: 'image' },
  { value: 'model/gltf-binary', label: 'glTF binary 3D model', ext: 'glb', family: 'image' },
  { value: 'model/obj', label: 'OBJ 3D model', ext: 'obj', family: 'image' },
  { value: 'model/stl', label: 'STL 3D model', ext: 'stl', family: 'image' },
  { value: 'application/x-figma', label: 'Figma file', ext: 'fig', family: 'image' },
  { value: 'application/x-sketch', label: 'Sketch file', ext: 'sketch', family: 'image' },
  // Subtitles and misc media
  { value: 'text/vtt', label: 'WebVTT subtitles', ext: 'vtt', family: 'video' },
  { value: 'application/x-subrip', label: 'SubRip subtitles', ext: 'srt', family: 'video' },
  { value: 'application/vnd.apple.mpegurl', label: 'HLS playlist', ext: 'm3u8', family: 'video' },
  { value: 'application/dash+xml', label: 'MPEG-DASH manifest', ext: 'mpd', family: 'video' },
];

const ALL = [...MIME_FAMILIES, ...MIME_TYPES];
const byValue = new Map(ALL.map((option) => [option.value, option]));

/** The label for a type, or the type itself when it is not in the list. */
export function mimeTypeLabel(value: string): string {
  return byValue.get(value)?.label ?? (value.endsWith('/') ? `All ${value.slice(0, -1)}` : value);
}

/** Options matching name, type or extension; selected entries always match. */
export function mimeTypeOptions(query: string, selected: readonly string[]): MimeTypeOption[] {
  const term = query.trim().toLowerCase();
  const chosen = new Set(selected);
  const matches = (option: MimeTypeOption) =>
    !term ||
    chosen.has(option.value) ||
    option.label.toLowerCase().includes(term) ||
    option.value.includes(term) ||
    (option.ext?.split(', ').some((ext) => ext === term || ext.startsWith(term)) ?? false);
  return ALL.filter(matches);
}

/** A well-formed type not in the list, offered as a custom entry. */
export function customMimeType(query: string): string | null {
  const value = query.trim().toLowerCase();
  if (!/^[a-z0-9-]+\/[a-z0-9.+-]+$/.test(value) || byValue.has(value)) return null;
  return value;
}
