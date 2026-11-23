export interface FolioLine {
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
  isTitle: boolean;
  blankLinesBefore: number;
  text: string;
}

export interface FolioDocument {
  lines: FolioLine[];
  totalLines: number;
}

export const FOLIO_GUIDE_ID = [
  'Panduan Format Kertas Folio (.folio):',
  '- {judul} Teks : Membuat judul utama rata tengah dan tebal',
  '- {tengah} Teks : Rata tengah',
  '- {kiri} Teks : Rata kiri (default paragraf)',
  '- {kanan} Teks : Rata kanan (tanggal, hormat saya, tanda tangan)',
  '- {tebal} Teks : Teks tebal',
  '- {miring} Teks : Teks miring',
  '- {baris1} / {baris2} / {baris3} : Menyisipkan 1, 2, atau 3 baris kosong',
  '',
  'Contoh:',
  '.folio {tengah}JUDUL SKRIPSI',
  '{baris2}',
  'Isi paragraf pertama.',
  '{kanan}Jakarta, 13 Juni 2029',
  '{baris1}',
  '{kanan}Hormat saya,',
  '{baris3}',
  '{kanan}Nama User',
].join('\n');

export function parseFolioText(input: string): FolioDocument {
  const rawLines = input.replace(/\r\n/g, '\n').split('\n');
  const lines: FolioLine[] = [];
  let pendingBlank = 0;

  for (const raw of rawLines) {
    let working = raw.trimEnd();
    if (working.trim() === '') {
      pendingBlank += 1;
      continue;
    }

    if (/^\{baris1\}$/i.test(working.trim())) {
      pendingBlank += 1;
      continue;
    }
    if (/^\{baris2\}$/i.test(working.trim())) {
      pendingBlank += 2;
      continue;
    }
    if (/^\{baris3\}$/i.test(working.trim())) {
      pendingBlank += 3;
      continue;
    }

    // Also strip inline {baris1/2/3} if present at start
    working = working.replace(/\{baris1\}/gi, () => {
      pendingBlank += 1;
      return '';
    });
    working = working.replace(/\{baris2\}/gi, () => {
      pendingBlank += 2;
      return '';
    });
    working = working.replace(/\{baris3\}/gi, () => {
      pendingBlank += 3;
      return '';
    });

    let align: 'left' | 'center' | 'right' = 'left';
    let bold = false;
    let italic = false;
    let isTitle = false;

    if (/\{tengah\}/i.test(working)) {
      align = 'center';
      working = working.replace(/\{tengah\}/gi, '');
    }
    if (/\{kiri\}/i.test(working)) {
      align = 'left';
      working = working.replace(/\{kiri\}/gi, '');
    }
    if (/\{kanan\}/i.test(working)) {
      align = 'right';
      working = working.replace(/\{kanan\}/gi, '');
    }
    if (/\{judul\}/i.test(working)) {
      isTitle = true;
      align = 'center';
      bold = true;
      working = working.replace(/\{judul\}/gi, '');
    }
    if (/\{tebal\}/i.test(working)) {
      bold = true;
      working = working.replace(/\{tebal\}/gi, '');
    }
    if (/\{miring\}/i.test(working)) {
      italic = true;
      working = working.replace(/\{miring\}/gi, '');
    }

    const cleaned = working.trim();
    if (cleaned.length > 0) {
      lines.push({
        align,
        bold,
        italic,
        isTitle,
        blankLinesBefore: pendingBlank,
        text: cleaned,
      });
      pendingBlank = 0;
    }
  }

  return {
    lines,
    totalLines: lines.length,
  };
}
