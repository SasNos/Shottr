import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { FakeDocument, settle } from './helpers/fakes.js';

const saved = {};
let listener;
let behavior = {};

before(async () => {
  for (const name of ['chrome', 'document', 'navigator', 'devicePixelRatio', 'setTimeout'])
    saved[name] = globalThis[name];
  const doc = new FakeDocument();
  const realCreate = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const element = realCreate(tag);
    element.play = async () => {};
    element.videoWidth = 10;
    element.videoHeight = 5;
    element.toDataURL = () => 'data:image/png;base64,F';
    return element;
  };
  globalThis.document = doc;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => {
          if (behavior.fail) throw new Error('denied');
          return { getTracks: () => [] };
        },
      },
    },
  });
  globalThis.devicePixelRatio = 1.5;
  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };
  globalThis.chrome = { runtime: { id: 'self', onMessage: { addListener: (fn) => (listener = fn) } } };
  await import('../src/offscreen-main.js');
});

after(() => {
  for (const [name, value] of Object.entries(saved)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
});

const message = { target: 'offscreen', type: 'grab-window', streamId: 's' };

test('the offscreen document answers a grab request with the frame', async () => {
  const answers = [];
  assert.equal(
    listener(message, { id: 'self' }, (answer) => answers.push(answer)),
    true,
  );
  await settle();
  assert.deepEqual(answers, [{ dataUrl: 'data:image/png;base64,F', width: 10, height: 5, ratio: 1.5 }]);
});

test('a failing grab is answered with the error message', async () => {
  behavior = { fail: true };
  const answers = [];
  listener(message, { id: 'self' }, (answer) => answers.push(answer));
  await settle();
  assert.deepEqual(answers, [{ error: 'denied' }]);
  behavior = {};
});

test('other messages and senders are ignored', () => {
  const answer = () => assert.fail('must not answer');
  assert.equal(listener(message, { id: 'other' }, answer), false);
  assert.equal(listener(null, { id: 'self' }, answer), false);
  assert.equal(listener({ type: 'capture' }, { id: 'self' }, answer), false);
  assert.equal(listener({ target: 'offscreen', type: 'other' }, { id: 'self' }, answer), false);
});
