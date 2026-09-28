const encoder = new TextEncoder();

/** Serialized UTF-8 size of one row inside a JSON array payload,
 *  including its share of delimiters. */
export function rowPayloadBytes(row) {
  return encoder.encode(JSON.stringify(row)).length + 1;
}

/**
 * Split rows into chunks bounded by BOTH a row count and the serialized
 * UTF-8 payload budget (JSON-encoded rows, delimiters included). Rows
 * carry whole rule YAML; composition rules run to tens of KB, so a
 * row-count bound alone let single requests reach several MB and the
 * REST gateway answered with Cloudflare error pages, connection resets,
 * and statement timeouts. A single row over the budget still ships
 * alone rather than being dropped.
 */
export function budgetedChunks(rows, maxRows, budgetBytes) {
  const chunks = [];
  let chunk = [];
  let spent = 2; // enclosing [] of the JSON array
  for (const row of rows) {
    const cost = rowPayloadBytes(row);
    if (
      chunk.length > 0 &&
      (chunk.length >= maxRows || spent + cost > budgetBytes)
    ) {
      chunks.push(chunk);
      chunk = [];
      spent = 2;
    }
    chunk.push(row);
    spent += cost;
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}
