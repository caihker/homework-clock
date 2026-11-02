import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecordingMime, readEmbeddedAudio } from '../dist/audio-format.mjs';

test('MP4 codec spacing and quotes normalize without changing the recording bytes', () => {
  for (const mime of ['audio/mp4; codecs=mp4a.40.2', 'audio/mp4;codecs="mp4a.40.2"', 'Audio/MP4 ; CODECS = "mp4a.40.2"', 'audio/mp4; codecs="mp4a.40.2"']) {
    assert.equal(normalizeRecordingMime(mime), 'audio/mp4;codecs=mp4a.40.2');
    assert.deepEqual(readEmbeddedAudio(`data:${mime};base64,dm9pY2U=`), { source: 'data:audio/mp4;codecs=mp4a.40.2;base64,dm9pY2U=', bytes: 5 });
  }
});

test('percent-escaped MIME metadata and codec lists use the same parser', () => {
  assert.deepEqual(readEmbeddedAudio('data:audio/mp4;%20codecs=%22mp4a.40.2%22;base64,YQ=='), { source: 'data:audio/mp4;codecs=mp4a.40.2;base64,YQ==', bytes: 1 });
  assert.equal(normalizeRecordingMime('audio/webm; codecs="opus, pcm"'), 'audio/webm;codecs=opus,pcm');
  assert.equal(readEmbeddedAudio('data:audio/webm;codecs="opus, pcm";base64,YWI=')?.bytes, 2);
});

test('legacy plain formats and canonical data URLs stay unchanged', () => {
  for (const mime of ['webm;codecs=opus', 'mp4', 'mp4;codecs=mp4a.40.2', 'mpeg', 'ogg', 'wav', 'x-wav', 'aac', 'x-m4a', 'x-matroska']) {
    const source = `data:audio/${mime};base64,YXVkaW8=`;
    assert.equal(readEmbeddedAudio(source)?.source, source);
  }
});

test('unsupported metadata, malformed payloads and external URLs remain rejected', () => {
  for (const mime of ['video/mp4', 'text/html', 'audio/mp4;codecs="mp4a.40.2', 'audio/mp4;codecs=', 'audio/mp4;codecs=""', 'audio/mp4;codecs=opus,,pcm', 'audio/mp4;other=x', 'audio/mp4;codecs=opus;codecs=pcm', 'audio/mp4;codecs="opus;evil=x"']) {
    assert.equal(normalizeRecordingMime(mime), null, mime);
    assert.equal(readEmbeddedAudio(`data:${mime};base64,YQ==`), null, mime);
  }
  for (const source of ['https://example.test/audio.mp4', 'blob:audio', 'data:text/html;base64,YQ==', 'data:audio/mp4;base64,', 'data:audio/mp4;base64,AA=A', 'data:audio/mp4;base64,AAAA=', 'data:audio/mp4;base64,YQ==\n', 'data:audio/mp4;%ZZ;base64,YQ==', 'data:audio/mp4;%0Acodecs=opus;base64,YQ==', null]) {
    assert.equal(readEmbeddedAudio(source), null, source);
  }
});
