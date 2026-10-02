/**
 * Robust reader for delimited text uploads.
 *
 * Real corpora are rarely clean. The SMS Spam Collection, a standard
 * benchmark, is tab separated, carries a .csv extension, has no header row,
 * and contains unescaped double quotes inside its messages. Parsing it the
 * obvious way loses 737 of its 5,574 messages without saying anything and
 * turns the first message into a set of column names.
 *
 * This reader makes three decisions the obvious way does not:
 *
 *   - the delimiter is detected from the file rather than assumed from the
 *     extension;
 *   - a quoting failure falls back to reading the field literally, because a
 *     stray quote in a sentence is far more common than a genuinely quoted
 *     field, and dropping the line loses the user's data;
 *   - a header row is only taken as one when it looks like column names
 *     rather than like the first record.
 *
 * It reports what it decided so a caller can tell the user.
 */
(function () {
  'use strict';

  const CANDIDATES = ['\t', ',', ';', '|'];
  const MAX_HEADER_CELL = 45;

  function detectDelimiter(text) {
    const lines = text.split('\n').filter(l => l.trim()).slice(0, 25);
    if (!lines.length) return ',';
    let best = ',', bestScore = -1;
    CANDIDATES.forEach(d => {
      const counts = lines.map(l => l.split(d).length - 1);
      const min = Math.min(...counts);
      if (min < 1) return;                       // must appear on every line
      const spread = Math.max(...counts) - min;  // consistent column count wins
      const score = min * 10 - spread;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }

  function quoteTrouble(errors) {
    return (errors || []).some(e =>
      /quote/i.test(e.message || '') || e.code === 'MissingQuotes'
      || e.code === 'InvalidQuotes');
  }

  function parseRows(text, delimiter, literalQuotes) {
    const config = {
      header: false,
      skipEmptyLines: true,
      delimiter: delimiter,
      // "\u0000" cannot appear in the text, so nothing is treated as a quote.
      quoteChar: literalQuotes ? '\u0000' : '"'
    };
    const out = Papa.parse(text, config);
    return { rows: out.data || [], errors: out.errors || [] };
  }

  /** True when the first row reads like column names rather than a record. */
  function looksLikeHeader(rows) {
    if (rows.length < 2) return false;
    const head = rows[0].map(c => String(c == null ? '' : c).trim());
    if (!head.length || head.some(c => !c)) return false;
    if (new Set(head).size !== head.length) return false;       // names are unique
    if (head.some(c => c.length > MAX_HEADER_CELL)) return false; // a sentence, not a name
    if (head.every(c => /^-?\d+(\.\d+)?$/.test(c))) return false; // all numbers
    return true;
  }

  function parseDelimitedText(text) {
    const delimiter = detectDelimiter(text);

    let { rows, errors } = parseRows(text, delimiter, false);
    let recovered = false;
    if (quoteTrouble(errors)) {
      const literal = parseRows(text, delimiter, true);
      // Keep the literal reading only if it actually rescues records.
      if (literal.rows.length >= rows.length) {
        rows = literal.rows;
        recovered = true;
      }
    }

    const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const hadHeader = looksLikeHeader(rows);
    const fields = hadHeader
      ? rows[0].map((c, i) => String(c).trim() || `column_${i + 1}`)
      : Array.from({ length: width }, (_, i) => `column_${i + 1}`);

    const body = hadHeader ? rows.slice(1) : rows;
    const data = body
      .filter(r => r.some(c => String(c == null ? '' : c).trim()))
      .map(r => {
        const obj = {};
        fields.forEach((f, i) => { obj[f] = r[i] == null ? '' : String(r[i]); });
        return obj;
      });

    return {
      data: data,
      fields: fields,
      delimiter: delimiter,
      hadHeader: hadHeader,
      recoveredFromQuotes: recovered,
      // Reported so a caller can explain what it did with the file.
      describe: function () {
        const names = { '\t': 'tab', ',': 'comma', ';': 'semicolon', '|': 'pipe' };
        const bits = [`${data.length.toLocaleString()} rows`,
                      `${names[delimiter] || delimiter} separated`];
        if (!hadHeader) bits.push('no header row, columns named automatically');
        if (recovered) bits.push('quotes inside fields read literally');
        return bits.join(', ');
      }
    };
  }

  window.parseDelimitedText = parseDelimitedText;
})();

/**
 * Re-serialise a parsed table as a strictly quoted CSV.
 *
 * Storing the normalised form means the Preprocessing and Predictive tabs,
 * which re-read the upload from the session, get a file that parses cleanly
 * rather than the original with whatever was wrong with it.
 */
(function () {
  'use strict';

  function cell(v) {
    const s = v == null ? '' : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  }

  window.toCleanCSV = function (parsed) {
    const head = parsed.fields.map(cell).join(',');
    const body = parsed.data.map(
      row => parsed.fields.map(f => cell(row[f])).join(','));
    return [head].concat(body).join('\n');
  };
})();
