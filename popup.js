const LOG_PREFIX = '%c[Popup]';
const LOG_STYLE = 'color: #8e44ad; font-weight: bold;';

document.addEventListener('DOMContentLoaded', () => {
  console.log(LOG_PREFIX, LOG_STYLE, 'Popup dibuka.');

  const modeSelect = document.getElementById('modeSelect');
  const jsonInput = document.getElementById('jsonInput');
  const btnStart = document.getElementById('btnStart');
  const statusEl = document.getElementById('status');
  const nopCountEl = document.getElementById('nopCount');

  if (jsonInput) {
    jsonInput.placeholder = "Tempel daftar NOP di sini...\n\nContoh:\n14.71.030.004.005-0047.0\n14.71.030.004.005-0046.0";
    const updateNopCount = () => {
      const count = konversiInputKeNopArray(jsonInput.value).length;
      if (nopCountEl) nopCountEl.textContent = `NOP valid terbaca: ${count}${count > 500 ? ' (melebihi batas 500)' : ''}`;
    };
    jsonInput.addEventListener('input', updateNopCount);
    updateNopCount();
  }

  btnStart.addEventListener('click', async () => {
    const rawText = jsonInput.value.trim();
    const selectedMode = modeSelect ? modeSelect.value : "SPPT";

    if (!rawText) {
      tampilkanStatus("Tempel daftar NOP terlebih dahulu!", "red");
      return;
    }

    const items = konversiInputKeNopArray(rawText);

    if (items.length === 0) {
      tampilkanStatus("Tidak ada NOP valid yang ditemukan!", "red");
      return;
    }
    if (items.length > 500) {
      tampilkanStatus(`Maksimal 500 NOP. Data ini berisi ${items.length} NOP valid.`, "red");
      return;
    }

    tampilkanStatus(`Membaca ${items.length} NOP. Memproses...`, "blue");

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      tampilkanStatus("Tab SmartGov tidak ditemukan!", "red");
      return;
    }

    chrome.runtime.sendMessage({
      action: "START_BATCH",
      items: items,
      tabId: tab.id,
      mode: selectedMode
    }, (response) => {
      if (chrome.runtime.lastError) {
        tampilkanStatus("Error: " + chrome.runtime.lastError.message, "red");
      } else if (response && response.status === "STARTED") {
        tampilkanStatus(`Batch berjalan [${selectedMode}] untuk ${items.length} NOP!`, "green");
      } else if (response && response.status === "BUSY") {
        tampilkanStatus(response.message, "orange");
      } else if (response && response.status === "TOO_MANY") {
        tampilkanStatus(response.message, "red");
      }
    });
  });

  function tampilkanStatus(msg, color) {
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.style.color = color;
    }
  }
});

function konversiInputKeNopArray(inputText) {
  const listHasil = [];
  const setNop = new Set();

  const tambahJikaValid = (str) => {
    if (!str || typeof str !== 'string') return;
    const fields = str.split(/[\t,;]+/);
    for (const field of fields) {
      const clean = field.replace(/["']/g, '').trim();
      const lower = clean.toLowerCase();
      if (!clean || lower === 'nop' || lower === 'tahun' || lower === 'no') continue;

      const digitCount = clean.replace(/\D/g, '').length;
      if (digitCount === 18 && !setNop.has(clean)) {
        const normalizedNop = clean.replace(/\D/g, '');
        if (!setNop.has(normalizedNop)) {
          setNop.add(normalizedNop);
          listHasil.push({ nop: normalizedNop });
        }
      }
    }
  };

  // Ambil NOP berpemisah titik/tanda hubung di mana pun letaknya pada baris Excel/CSV.
  const formattedNopPattern = /\b\d{2}\.\d{2}\.\d{3}\.\d{3}\.\d{3}-\d{4}\.\d\b/g;
  const formattedMatches = inputText.match(formattedNopPattern) || [];
  formattedMatches.forEach(tambahJikaValid);

  try {
    const parsed = JSON.parse(inputText);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    rows.forEach((item) => {
      if (typeof item === 'string' || typeof item === 'number') tambahJikaValid(String(item));
      else if (item && typeof item === 'object') {
        const nopValue = item.nop ?? item.NOP ?? item.Nop;
        if (nopValue != null) tambahJikaValid(String(nopValue));
        else Object.values(item).forEach(value => {
          if (typeof value === 'string' || typeof value === 'number') tambahJikaValid(String(value));
        });
      }
    });
    if (listHasil.length > 0) return listHasil;
  } catch (e) {}

  const baris = inputText.split(/[\r\n]+/);
  baris.forEach(line => tambahJikaValid(line));

  return listHasil;
}
