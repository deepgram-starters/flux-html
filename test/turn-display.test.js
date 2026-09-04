import { expect, test } from 'bun:test';
import { createTurnContainer } from '../turn-display.js';

class Element {
  constructor(document) {
    this.document = document;
    this.children = [];
    this.classList = {
      values: new Set(),
      add: (value) => this.classList.values.add(value),
      contains: (value) => this.classList.values.has(value),
    };
  }

  set id(value) {
    this._id = value;
    this.document.elements.set(value, this);
  }

  get id() {
    return this._id;
  }

  appendChild(child) {
    this.children.push(child);
  }
}

test('reuses the turn container for repeated StartOfTurn events', () => {
  const document = {
    elements: new Map(),
    createElement: () => new Element(document),
    getElementById: (id) => document.elements.get(id) || null,
  };
  globalThis.document = document;
  const elements = {
    emptyState: new Element(document),
    transcriptContainer: new Element(document),
  };

  const first = createTurnContainer(elements, 4);
  const repeated = createTurnContainer(elements, 4);

  expect(repeated).toBe(first);
  expect(elements.transcriptContainer.children).toHaveLength(1);
  expect(document.getElementById('turn-text-4')).not.toBeNull();
});
