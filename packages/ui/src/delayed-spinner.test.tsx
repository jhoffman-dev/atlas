// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { delayedSpinner, SPINNER_DELAY_MS } from './delayed-spinner.tsx';

/**
 * #320: loading shows a spinner only once it has taken a while. The wait is
 * the stylesheet's (styles.toasts.test.ts holds its 150 ms to this number,
 * and e2e/delayed-spinner.spec.ts steps its clock to 149 and 150 ms).
 */
describe('delayedSpinner', () => {
  it('waits about 150 ms', () => {
    expect(SPINNER_DELAY_MS).toBe(150);
  });

  it('is named for what it waits on, with a ring and no words to see', () => {
    render(<div>{delayedSpinner('Reading the day…')}</div>);
    const spinner = screen.getByRole('status', { name: 'Reading the day…' });
    expect(spinner.querySelector('.spinner__ring')).not.toBeNull();
    expect(spinner.textContent).toBe('');
  });
});
