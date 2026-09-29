import { describe, expect, it } from 'vitest';
import type { AnyColumnDefinition } from '../src/definitions/define.js';
import * as definitions from '../src/definitions/index.js';
import { redactUrl } from '../src/migrate-db.js';
import { copyOrder } from '../src/sqlite/to-postgres.js';

describe('migrate-db', () => {
  it('copies every table after the tables its foreign keys point at', () => {
    const order = copyOrder();
    const position = new Map(order.map((table, index) => [table, index]));
    expect(order.length).toBe(new Set(order).size);
    for (const table of order) {
      for (const column of Object.values(table.columns)) {
        const target = (column as AnyColumnDefinition).spec.reference?.table();
        if (target && target !== table) {
          expect(position.get(target)).toBeLessThan(position.get(table) as number);
        }
      }
    }
    expect(position.get(definitions.spaces)).toBeLessThan(
      position.get(definitions.contents) as number,
    );
  });

  it('hides the password of a connection URL', () => {
    expect(redactUrl('postgres://user:p%40ss@db:5432/cms')).toBe('postgres://user:***@db:5432/cms');
    expect(redactUrl('postgres://db/cms')).toBe('postgres://db/cms');
  });
});
