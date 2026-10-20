import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLinkHover, LINK_PREVIEW_DELAY_MS, windowTimer } from './link-hover.ts';

function hover() {
  const onShow = vi.fn<(target: string) => void>();
  const onHide = vi.fn<() => void>();
  const start = vi.spyOn(windowTimer, 'start');
  const links = createLinkHover<string>({ timer: windowTimer, onShow, onHide });
  return { links, onShow, onHide, start };
}

describe('createLinkHover: the 400 ms rule', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('waits 400 ms', () => {
    expect(LINK_PREVIEW_DELAY_MS).toBe(400);
  });

  it('shows the card after 400 ms on a link, and not after 399', () => {
    const { links, onShow } = hover();
    links.enter('P16-04');
    vi.advanceTimersByTime(399);
    expect(onShow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onShow).toHaveBeenCalledExactlyOnceWith('P16-04');
  });

  it('shows nothing when the pointer leaves first', () => {
    const { links, onShow, onHide } = hover();
    links.enter('P16-04');
    vi.advanceTimersByTime(300);
    links.dismiss();
    vi.advanceTimersByTime(1000);
    expect(onShow).not.toHaveBeenCalled();
    // Nothing was showing, so there is nothing to hide.
    expect(onHide).not.toHaveBeenCalled();
  });

  it('hides the card on leaving the link', () => {
    const { links, onHide } = hover();
    links.enter('P16-04');
    vi.advanceTimersByTime(400);
    links.dismiss();
    expect(onHide).toHaveBeenCalledOnce();
  });

  it('hides the card on a key, and does not bring it back', () => {
    const { links, onShow, onHide } = hover();
    links.enter('P16-04');
    vi.advanceTimersByTime(400);
    links.dismiss();
    vi.advanceTimersByTime(1000);
    expect(onHide).toHaveBeenCalledOnce();
    expect(onShow).toHaveBeenCalledOnce();
  });

  it('cancels a wait on a key', () => {
    const { links, onShow } = hover();
    links.enter('P16-04');
    links.dismiss();
    vi.advanceTimersByTime(1000);
    expect(onShow).not.toHaveBeenCalled();
  });

  it('schedules once per link, however often the pointer crosses its children', () => {
    const { links, start, onShow } = hover();
    links.enter('P16-04');
    vi.advanceTimersByTime(200);
    links.enter('P16-04');
    vi.advanceTimersByTime(200);
    expect(start).toHaveBeenCalledOnce();
    expect(onShow).toHaveBeenCalledOnce();
  });

  it('starts over for another link, hiding the first card', () => {
    const { links, onShow, onHide } = hover();
    links.enter('P16-04');
    vi.advanceTimersByTime(400);
    links.enter('A15-02');
    expect(onHide).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(399);
    expect(onShow).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onShow).toHaveBeenLastCalledWith('A15-02');
  });

  it('schedules nothing while nothing is hovered', () => {
    const { links, start } = hover();
    links.dismiss();
    links.dismiss();
    expect(start).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
