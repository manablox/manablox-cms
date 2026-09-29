import { chosen, confirm, confirmChoice, pending, settle } from '@manablox/admin-sdk/lib/confirm';
import { describe, expect, it } from 'vitest';

const CHOICES = [
  { value: 'reparent', label: 'Keep them' },
  { value: 'cascade', label: 'Delete them too' },
];

describe('the confirm dialog', () => {
  it('resolves a plain confirm with the button that was pressed', async () => {
    const asked = confirm({ title: 'Delete?', message: 'Gone for good.' });
    expect(pending.value?.title).toBe('Delete?');
    settle(true);
    expect(await asked).toBe(true);
    expect(pending.value).toBeNull();
  });

  it('opens a choice on its first option and resolves with the selected one', async () => {
    const asked = confirmChoice({
      title: 'Delete?',
      message: 'It has children.',
      choices: CHOICES,
    });
    expect(chosen.value).toBe('reparent');

    chosen.value = 'cascade';
    settle(true);
    expect(await asked).toBe('cascade');
  });

  it('resolves a choice with nothing when it is dismissed', async () => {
    const asked = confirmChoice({
      title: 'Delete?',
      message: 'It has children.',
      choices: CHOICES,
    });
    settle(false);
    expect(await asked).toBeNull();
  });

  it('cancels the open dialog when a second one takes its place', async () => {
    const first = confirmChoice({ title: 'First', message: '.', choices: CHOICES });
    const second = confirm({ title: 'Second', message: '.' });
    expect(pending.value?.title).toBe('Second');
    expect(await first).toBeNull();

    settle(true);
    expect(await second).toBe(true);
  });
});
