const LOG_PREFIX = '%c[Popup]';
const LOG_STYLE = 'color: #8e44ad; font-weight: bold;';

document.addEventListener('DOMContentLoaded', () => {
  console.log(LOG_PREFIX, LOG_STYLE, 'Popup dibuka.');

  const modeSelect = document.getElementById('modeSelect');
  const jsonInput = document.getElementById('jsonInput');
  const btnStart = document.getElementById('btnStart');
  const statusEl = document.getElementById('status');

  if (jsonInput) {
    jsonInput.placeholder = "Tempel daftar NOP di sini...\n\nContoh:\n14.71.030.004.005-0047.0\n14.71.030.004.005-0046.0";
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
    let clean = str.replace(/["']/g, '').trim();
    
    if (clean.includes('\t')) {
      clean = clean.split('\t')[0].trim();
    }

    if (clean.length >= 10 && !setNop.has(clean)) {
      const lower = clean.toLowerCase();
      if (lower !== 'nop' && lower !== 'tahun' && lower !== 'no') {
        setNop.add(clean);
        listHasil.push({ nop: clean });
      }
    }
  };

  try {
    const parsed = JSON.parse(inputText);
    if (Array.isArray(parsed)) {
      parsed.forEach((item, index) => {
        if (typeof item === 'string') {
          tambahJikaValid(item);
        } else if (typeof item === 'object' && item !== null) {
          const keys = Object.keys(item);
          const values = Object.values(item);

          if (index === 0 && keys.length > 0) tambahJikaValid(keys[0]);
          if (values.length > 0 && typeof values[0] === 'string') tambahJikaValid(values[0]);
        }
      });
      if (listHasil.length > 0) return listHasil;
    }
  } catch (e) {}

  const baris = inputText.split(/[\r\n]+/);
  baris.forEach(line => tambahJikaValid(line));

  return listHasil;
}