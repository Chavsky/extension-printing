const LOG_PREFIX = '%c[Content Script]';
const LOG_STYLE = 'color: #27ae60; font-weight: bold;';

let isContentProcessing = false;

console.log(LOG_PREFIX, LOG_STYLE, 'Content Script terpasang pada halaman SmartGov.');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "PROCESS_NOP") {
    if (isContentProcessing) {
      console.warn(LOG_PREFIX, LOG_STYLE, `Abaikan duplikat perintah untuk NOP ${request.nop}.`);
      sendResponse({ status: "BUSY" });
      return false;
    }

    console.log(LOG_PREFIX, LOG_STYLE, `Menerima perintah pengisian NOP: ${request.nop} [Mode: ${request.mode}]`);

    if (!request.nop || String(request.nop).trim() === "") {
      sendResponse({ status: "ERROR", message: "NOP Kosong" });
      return false;
    }

    isContentProcessing = true;

    eksekusiProses(request.nop, request.tahun, request.mode || "SPPT")
      .then(() => {
        console.log(LOG_PREFIX, LOG_STYLE, `Pengisian NOP ${request.nop} SELESAI.`);
        sendResponse({ status: "OK" });
      })
      .catch((err) => {
        console.warn(LOG_PREFIX, LOG_STYLE, `Pemberitahuan NOP ${request.nop}:`, err.message);
        sendResponse({ status: "ERROR", message: err.message });
      })
      .finally(() => {
        isContentProcessing = false;
      });

    return true;
  }
});

async function eksekusiProses(nopRaw, tahunCustom, mode) {
  bersihkanLayar();
  await sleep(400);

  const inputs = await tungguKolomNop();
  if (inputs.length < 7) {
    throw new Error("Kolom NOP tidak siap atau tertutup modal.");
  }

  const cleanNop = String(nopRaw).replace(/\D/g, '');
  if (cleanNop.length !== 18) {
    throw new Error(`NOP harus 18 digit! Diterima: ${cleanNop.length} digit`);
  }

  const parts = [
    cleanNop.substring(0, 2),
    cleanNop.substring(2, 4),
    cleanNop.substring(4, 7),
    cleanNop.substring(7, 10),
    cleanNop.substring(10, 13),
    cleanNop.substring(13, 17),
    cleanNop.substring(17, 18)
  ];

  for (let i = 0; i < 7; i++) isiInput(inputs[i], "");
  await sleep(100);

  for (let i = 0; i < 7; i++) {
    isiInput(inputs[i], parts[i]);
    await sleep(60);
  }

  // ALUR BERDASARKAN MODE HALAMAN
  if (mode === "CATATAN_PEMBAYARAN") {
    // 1. Klik tombol CARI
    console.log(LOG_PREFIX, LOG_STYLE, '[Mode: Catatan Pembayaran] Mengeklik tombol CARI...');
    const btnCari = cariTombol('CARI');
    if (!btnCari) throw new Error("Tombol CARI tidak ditemukan!");
    btnCari.click();

    console.log(LOG_PREFIX, LOG_STYLE, '[Mode: Catatan Pembayaran] Menunggu hasil pencarian (1.2 detik)...');
    await sleep(1200);

    // 2. Klik tombol CETAK di halaman utama
    console.log(LOG_PREFIX, LOG_STYLE, '[Mode: Catatan Pembayaran] Mengeklik tombol CETAK utama...');
    const btnCetak = cariTombol('CETAK');
    if (!btnCetak) throw new Error("Tombol CETAK tidak ditemukan!");
    btnCetak.click();

    // 3. Tangani Modal "Tahun SPPT" (Centang Semua Tahun -> Klik CETAK Modal)
    console.log(LOG_PREFIX, LOG_STYLE, '[Mode: Catatan Pembayaran] Menunggu modal Tahun SPPT...');
    await sleep(500);
    await menanganiModalTahunSppt();

  } else {
    // Flow SPPT / STTS Terseleksi: NOP -> TAHUN -> CETAK -> Konfirmasi Modal
    const inputTahun = cariKolomTahun();
    if (inputTahun) {
      const valTahun = (tahunCustom && String(tahunCustom).trim() !== "") ? String(tahunCustom).trim() : "2026";
      isiInput(inputTahun, valTahun);
    }

    await sleep(600);

    console.log(LOG_PREFIX, LOG_STYLE, '[Mode: SPPT/STTS] Mengeklik tombol CETAK...');
    const btnCetak = cariTombol('CETAK');
    if (!btnCetak) throw new Error("Tombol CETAK tidak ditemukan!");
    btnCetak.click();

    await sleep(600);
    await tekanKonfirmasiModal();
  }

  await sleep(400);
  bersihkanLayar();
  return true;
}

/**
 * Menangani Modal "Tahun SPPT" pada Catatan Pembayaran
 */
async function menanganiModalTahunSppt() {
  for (let i = 0; i < 10; i++) {
    const modals = Array.from(document.querySelectorAll('.modal, .sweet-alert, .swal2-container, div[role="dialog"]'))
      .filter(isVisible);

    for (let modal of modals) {
      if (modal.textContent.includes('Tahun SPPT') || modal.textContent.includes('Semua tahun')) {
        // A. Centang Checkbox "Semua tahun"
        const checkbox = modal.querySelector('input[type="checkbox"]');
        if (checkbox) {
          if (!checkbox.checked) {
            checkbox.click();
            await sleep(150);
            if (!checkbox.checked) {
              checkbox.checked = true;
              checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }

        await sleep(300);

        // B. Klik Tombol CETAK di dalam Modal
        const btns = Array.from(modal.querySelectorAll('button, input[type="button"], a.btn, a'))
          .filter(isVisible);

        const btnCetakModal = btns.find(b => {
          const txt = (b.textContent || b.value || '').trim().toUpperCase();
          return txt === 'CETAK';
        });

        if (btnCetakModal) {
          btnCetakModal.click();
          console.log(LOG_PREFIX, LOG_STYLE, '[Mode: Catatan Pembayaran] Berhasil mencentang "Semua tahun" & mengeklik CETAK pada modal.');
          return true;
        }
      }
    }
    await sleep(300);
  }
  throw new Error("Modal 'Tahun SPPT' atau tombol CETAK pada modal tidak ditemukan!");
}

async function tungguKolomNop() {
  for (let i = 0; i < 8; i++) {
    bersihkanLayar();
    const inputs = cariKolomNop();
    if (inputs.length >= 7) return inputs;
    await sleep(300);
  }
  return [];
}

function cariKolomNop() {
  const nopWrapper = document.querySelector('.input-inline-7') || 
                     Array.from(document.querySelectorAll('.form-group, .row')).find(el => el.textContent.includes('NOP'));

  if (nopWrapper) {
    const inputs = Array.from(nopWrapper.querySelectorAll('input'))
      .filter(i => isVisible(i) && !isInputTahun(i));
    if (inputs.length >= 7) return inputs.slice(0, 7);
  }

  const allInputs = Array.from(document.querySelectorAll('input'))
    .filter(i => isVisible(i) && !isInputTahun(i));
  if (allInputs.length >= 7) return allInputs.slice(0, 7);

  return [];
}

function cariKolomTahun() {
  return document.querySelector('input[name*="tahun" i], input[id*="tahun" i], input[name*="thn" i], input[id*="thn" i]') ||
         Array.from(document.querySelectorAll('input')).find(i => {
           const label = i.closest('.form-group, .row')?.querySelector('label')?.textContent || '';
           return label.toLowerCase().includes('tahun') && isVisible(i);
         });
}

function isInputTahun(el) {
  const nameId = (el.name + ' ' + el.id).toLowerCase();
  return nameId.includes('tahun') || nameId.includes('thn');
}

function isiInput(el, val) {
  if (!el) return;
  el.focus();
  el.click();
  
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (nativeSetter) {
    nativeSetter.call(el, val);
  } else {
    el.value = val;
  }

  el.dispatchEvent(new Event('keydown', { bubbles: true }));
  el.dispatchEvent(new Event('keypress', { bubbles: true }));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('keyup', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function cariTombol(teksDiberikan) {
  return Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn, a'))
    .filter(isVisible)
    .find(el => {
      const txt = (el.textContent || el.value || '').trim().toUpperCase();
      return txt === teksDiberikan.toUpperCase();
    });
}

async function tekanKonfirmasiModal() {
  for (let i = 0; i < 6; i++) {
    const btns = Array.from(document.querySelectorAll('.modal button, .sweet-alert button, .swal2-container button, div[role="dialog"] button'))
      .filter(isVisible);

    for (let b of btns) {
      const txt = (b.textContent || b.value || '').toUpperCase();
      if (txt === 'YA' || txt === 'YES' || txt === 'OK' || txt.includes('DOWNLOAD') || txt.includes('PROSES')) {
        b.click();
        return true;
      }
    }
    await sleep(300);
  }
  return false;
}

function bersihkanLayar() {
  document.querySelectorAll('.modal-backdrop, .sweet-overlay, .swal2-backdrop').forEach(el => el.remove());
  document.querySelectorAll('.modal.in, .modal.show, .sweet-alert.show-sweet-alert').forEach(el => {
    el.style.display = 'none';
  });
  document.body.classList.remove('modal-open');
}

function isVisible(el) {
  if (!el || el.type === 'hidden') return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetWidth > 0 && el.offsetHeight > 0;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}