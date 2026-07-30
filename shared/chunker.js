/**
 * Text chunker — splits large documents into overlapping chunks with sentence-boundary snapping.
 *
 * Ported from AitherOS lib/memory/DocumentIngester._chunk_text:
 * - Char-per-token estimate: 4 chars = 1 token
 * - Overlapping windows with sentence-boundary snap-down (up to 20% lookback)
 * - Never emit empty/whitespace-only chunks; always advance by at least 1 char
 */

(function() {
  'use strict';

  /**
   * Snap a position backwards to the nearest sentence-ending boundary.
   * Looks for '.', '!', '?' followed by whitespace within the last 20% of max_chars.
   *
   * @param {string} text - Document text
   * @param {number} pos - Current end position
   * @param {number} maxChars - Max chunk size in chars (determines lookback window)
   * @returns {number} Snapped position (or original pos if no boundary found)
   */
  function snapToSentenceBoundary(text, pos, maxChars) {
    const searchStart = Math.max(pos - Math.floor(maxChars * 0.2), 0);
    for (let i = pos - 1; i > searchStart; i--) {
      if ('.!?'.includes(text[i])) {
        // Check that next char is whitespace (or end of string)
        if (i + 1 >= text.length || ' \n\r\t'.includes(text[i + 1])) {
          return i + 1;
        }
      }
    }
    return pos;  // No boundary found; use original
  }

  /**
   * Split text into overlapping chunks.
   *
   * @param {string} text - Input text to chunk
   * @param {Object} options - Chunking parameters
   * @param {number} [options.maxTokens=512] - Max estimated tokens per chunk
   * @param {number} [options.overlapTokens=64] - Overlap tokens between chunks
   * @returns {Array<Object>} Array of {text, chunkIndex, start, end}
   */
  function chunkText(text, options = {}) {
    const maxTokens = options.maxTokens || 512;
    const overlapTokens = options.overlapTokens || 64;

    const maxChars = maxTokens * 4;         // 1 token ≈ 4 chars
    const overlapChars = overlapTokens * 4;
    const chunks = [];
    let chunkIndex = 0;
    let start = 0;

    while (start < text.length) {
      let end = start + maxChars;

      // Snap end to sentence boundary if not at end of text
      if (end < text.length) {
        end = snapToSentenceBoundary(text, end, maxChars);
      }

      // Extract and trim fragment
      const fragment = text.slice(start, end).trim();

      // Only emit non-empty chunks
      if (fragment.length > 0) {
        chunks.push({
          text: fragment,
          chunkIndex: chunkIndex,
          start: start,
          end: end,
        });
        chunkIndex++;
      }

      // Advance by (end - start - overlap), ensuring we always move forward
      const advance = Math.max(end - start - overlapChars, 1);
      start += advance;
    }

    return chunks;
  }

  // Export to self for use in service worker and normal pages
  self.AitherChunker = {
    chunkText: chunkText,
  };
})();
