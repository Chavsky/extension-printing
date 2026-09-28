importScripts('pdf-lib.min.js');

const LOG_PREFIX = '%c[Background]';
const LOG_STYLE = 'color: #2980b9; font-weight: bold;';

let isProcessing = false;
let pdfBuffers = [];

console.log(LOG_PREFIX, LOG_STYLE, 'Service Worker Background Aktif.');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_BATCH") {
    if (isProcessing) {
      sendResponse({ status: "BUSY", message: "Proses cetak sedang berjalan di latar belakang!" });
      return true;
    }

    isProcessing = true;
    pdfBuffers = [];
    sendResponse({ status: "STARTED" });

    jalankanBatch(request.items, request.tabId, request.mode || "SPPT");
    return true;
  }
});

async function jalankanBatch(itemsRaw, tabId, mode) {
  const items = ekstrakSemuaNop(itemsRaw);
  console.log(LOG_PREFIX, LOG_STYLE, `Batch Dimulai [Mode: ${mode}]. Total NOP: ${items.length}`);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    console.group(`[Background] Progres (${i + 1}/${items.length}): NOP ${item.nop}`);

    try {
      await chrome.tabs.update(tabId, { active: true });
    } catch (e) {
      console.error(LOG_PREFIX, LOG_STYLE, 'Error: Tab SmartGov ditutup!');
      console.groupEnd();
      break;
    }

    const penungguDownload = tungguPdfSelesaiTerunduh(30000);

    console.log(LOG_PREFIX, LOG_STYLE, `Mengirim instruksi ke Content Script (${mode})...`);
    const resContent = await kirimKeContent(tabId, {
      action: "PROCESS_NOP",
      nop: item.nop,
      tahun: item.tahun,
      mode: mode
    });

    if (resContent && (resContent.status === "OK" || resContent.status === "BUSY")) {
      console.log(LOG_PREFIX, LOG_STYLE, 'Aksi dipicu. Menunggu file PDF selesai diunduh...');
      
      const hasilDownload = await penungguDownload;

      if (hasilDownload.success) {
        console.log(LOG_PREFIX, LOG_STYLE, `%c[SUKSES] PDF NOP ${item.nop} terunduh (${hasilDownload.size} bytes).`, 'color: green; font-weight: bold;');
      } else {
        console.error(LOG_PREFIX, LOG_STYLE, `%c[GAGAL/TIMEOUT] NOP ${item.nop}: ${hasilDownload.reason}`, 'color: red; font-weight: bold;');
      }
    } else {
      penungguDownload.batal();
      console.error(LOG_PREFIX, LOG_STYLE, `[ERROR FORM] Gagal memicu NOP ${item.nop}: ${resContent?.message || 'Timeout'}`);
    }

    console.groupEnd();
    await sleep(1000);
  }

  console.log(LOG_PREFIX, LOG_STYLE, `Batch Selesai. Total PDF Berhasil Ditangkap: ${pdfBuffers.length}/${items.length}`);

  if (pdfBuffers.length > 0) {
    await gabungkanDanUnduhPdf(mode);
  } else {
    console.warn(LOG_PREFIX, LOG_STYLE, 'Batal Gabung: Tidak ada PDF yang berhasil ditangkap.');
  }

  isProcessing = false;
}

function tungguPdfSelesaiTerunduh(timeoutMs = 30000) {
  let listener = null;
  let timer = null;

  const promise = new Promise((resolve) => {
    listener = async (downloadDelta) => {
      if (downloadDelta.state && downloadDelta.state.current === 'complete') {
        try {
          const [item] = await chrome.downloads.search({ id: downloadDelta.id });
          if (item && (item.mime === 'application/pdf' || item.filename.toLowerCase().endsWith('.pdf'))) {
            
            const res = await fetch(item.url);
            const buffer = await res.arrayBuffer();
            
            if (buffer && buffer.byteLength > 0) {
              pdfBuffers.push(buffer);
              cleanup();
              resolve({ success: true, size: buffer.byteLength });
            }
          }
        } catch (err) {
          cleanup();
          resolve({ success: false, reason: 'Gagal membaca buffer PDF: ' + err.message });
        }
      }
    };

    chrome.downloads.onChanged.addListener(listener);

    timer = setTimeout(() => {
      cleanup();
      resolve({ success: false, reason: `Timeout (${timeoutMs / 1000}s): Download tidak kunjung selesai.` });
    }, timeoutMs);
  });

  const cleanup = () => {
    if (listener) chrome.downloads.onChanged.removeListener(listener);
    if (timer) clearTimeout(timer);
  };

  promise.batal = cleanup;
  return promise;
}

function ekstrakSemuaNop(items) {
  const daftarNop = [];
  const setNop = new Set();

  const tambahJikaValid = (str) => {
    if (!str || typeof str !== 'string') return;
    const clean = str.trim();
    if (clean.length >= 10 && !setNop.has(clean)) {
      if (clean.toLowerCase() !== 'nop' && clean.toLowerCase() !== 'tahun') {
        setNop.add(clean);
        daftarNop.push({ nop: clean });
      }
    }
  };

  if (!Array.isArray(items)) return [];

  items.forEach(item => {
    if (typeof item === 'string') {
      tambahJikaValid(item);
    } else if (typeof item === 'object' && item !== null) {
      if (item.nop) {
        tambahJikaValid(item.nop);
      } else {
        Object.keys(item).forEach(key => tambahJikaValid(key));
        Object.values(item).forEach(val => tambahJikaValid(val));
      }
    }
  });

  return daftarNop;
}

async function gabungkanDanUnduhPdf(mode) {
  try {
    console.log(LOG_PREFIX, LOG_STYLE, `Memulai proses penggabungan ${pdfBuffers.length} file PDF...`);
    const mergedPdf = await PDFLib.PDFDocument.create();

    for (let index = 0; index < pdfBuffers.length; index++) {
      try {
        const pdf = await PDFLib.PDFDocument.load(pdfBuffers[index]);
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      } catch (e) {
        console.error(LOG_PREFIX, LOG_STYLE, `Gagal membaca PDF ke-${index + 1}:`, e);
      }
    }

    const mergedPdfBase64 = await mergedPdf.saveAsBase64({ dataUri: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const prefixName = mode === "CATATAN_PEMBAYARAN" ? "CATATAN_PEMBAYARAN_GABUNGAN" : "PBB_SPPT_GABUNGAN";
    const fileName = `${prefixName}_${timestamp}.pdf`;

    await chrome.downloads.download({
      url: mergedPdfBase64,
      filename: fileName,
      saveAs: false
    });

    console.log(LOG_PREFIX, LOG_STYLE, `%c[SUKSES] Master PDF Gabungan (${fileName}) Berhasil Diunduh!`, 'color: green; font-weight: bold;');
  } catch (err) {
    console.error(LOG_PREFIX, LOG_STYLE, 'Error fatal saat menggabungkan PDF:', err);
  }
}

function kirimKeContent(tabId, message) {
  return new Promise((resolve) => {
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        resolve({ status: "TIMEOUT" });
      }
    }, 15000);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve(response || { status: "OK" });
      }
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}