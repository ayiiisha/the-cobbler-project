/* =========================================================
   zip.js — makes .zip files in the browser
   ---------------------------------------------------------
   A small ZIP writer. Files are stored as they are (no
   compression), which every unzip tool, Word and Finder open.
   Used for Word documents (.docx files are ZIPs inside) and
   for downloading the whole app from Settings.

     const blob = Zip.create([
       { name: "folder/file.txt", data: "text or Uint8Array" },
     ]);
   ========================================================= */
(() => {

  /* CRC-32: the checksum ZIP files use to check each file arrived intact */
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /* The date and time in the old MS-DOS format ZIP uses */
  function dosDateTime(date = new Date()) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
  }

  const encoder = new TextEncoder();
  const toBytes = (data) => typeof data === "string" ? encoder.encode(data) : new Uint8Array(data);

  /* Builds the ZIP: a header and the bytes for each file, then a directory at the end */
  function create(files) {
    const { time, day } = dosDateTime();
    const parts = [];
    const directory = [];
    let offset = 0;

    files.forEach(file => {
      const name = encoder.encode(file.name);
      const data = toBytes(file.data);
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034B50, true);   // local file header
      local.setUint16(4, 20, true);           // version needed
      local.setUint16(6, 0x0800, true);       // names are UTF-8
      local.setUint16(8, 0, true);            // stored (no compression)
      local.setUint16(10, time, true);
      local.setUint16(12, day, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      parts.push(local.buffer, name, data);

      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014B50, true); // central directory entry
      central.setUint16(4, 20, true);
      central.setUint16(6, 20, true);
      central.setUint16(8, 0x0800, true);
      central.setUint16(10, 0, true);
      central.setUint16(12, time, true);
      central.setUint16(14, day, true);
      central.setUint32(16, crc, true);
      central.setUint32(20, data.length, true);
      central.setUint32(24, data.length, true);
      central.setUint16(28, name.length, true);
      central.setUint32(42, offset, true);    // where the file starts
      directory.push(central.buffer, name);

      offset += 30 + name.length + data.length;
    });

    const directorySize = directory.reduce((n, part) => n + (part.byteLength ?? part.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054B50, true);       // end of central directory
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, directorySize, true);
    end.setUint32(16, offset, true);

    return new Blob([...parts, ...directory, end.buffer], { type: "application/zip" });
  }

  window.Zip = { create, crc32 };
})();
