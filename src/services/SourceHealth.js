/**
 * SourceHealth.js — rolling reliability score per source.
 *
 * Two signals feed the score:
 *   verify  - did the pre-flight (playlist + segment probe) pass when minting
 *   play    - did the HLS gateway manage to serve playlists while a viewer
 *             was actually watching (self-heal needed = failure)
 *
 * Score is an exponential moving average in [0,1]; new sources start at 0.7
 * so they get a fair chance. streams.js sorts and filters by this score, so
 * flaky sources sink to the bottom and eventually disappear from the picker
 * while at least two healthier direct streams exist.
 */

const ALPHA_VERIFY = 0.12;
const ALPHA_PLAY = 0.25;
const START = 0.7;

class SourceHealth {
  constructor() {
    this.stats = new Map(); // source -> { score, verifyOk, verifyFail, playOk, playFail, samples, updatedAt }
  }

  _get(source) {
    let s = this.stats.get(source);
    if (!s) {
      s = { score: START, verifyOk: 0, verifyFail: 0, playOk: 0, playFail: 0, samples: 0, updatedAt: 0 };
      this.stats.set(source, s);
    }
    return s;
  }

  noteVerify(source, ok) {
    if (!source) return;
    const s = this._get(source);
    s.score = s.score * (1 - ALPHA_VERIFY) + (ok ? 1 : 0) * ALPHA_VERIFY;
    if (ok) s.verifyOk++; else s.verifyFail++;
    s.samples++;
    s.updatedAt = Date.now();
  }

  notePlay(source, ok) {
    if (!source) return;
    const s = this._get(source);
    s.score = s.score * (1 - ALPHA_PLAY) + (ok ? 1 : 0) * ALPHA_PLAY;
    if (ok) s.playOk++; else s.playFail++;
    s.samples++;
    s.updatedAt = Date.now();
  }

  score(source) {
    const s = this.stats.get(source);
    return s ? s.score : START;
  }

  samples(source) {
    const s = this.stats.get(source);
    return s ? s.samples : 0;
  }

  /** Human label for the stream picker. */
  label(source) {
    const s = this.stats.get(source);
    if (!s || s.samples < 4) return '';
    if (s.score >= 0.85) return 'stable';
    if (s.score < 0.5) return 'unstable';
    return '';
  }

  snapshot() {
    const out = {};
    for (const [k, v] of this.stats) out[k] = { ...v, score: Math.round(v.score * 100) / 100 };
    return out;
  }
}

module.exports = SourceHealth;
