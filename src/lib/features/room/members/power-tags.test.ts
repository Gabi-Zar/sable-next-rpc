import { describe, expect, it } from 'vitest';

import {
  contrastRatio,
  roleColorOnDark,
  roleColorOnLight,
} from '#lib/ui/primitives/readable-color.js';

import { FOUNDER_POWER_LEVEL, powerTag } from './power-tags';

const t = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key}(${JSON.stringify(options)})` : key;

describe('powerTag', () => {
  it('names an exact power level', () => {
    expect(powerTag(100, t).name).toBe('timeline.powerLevelAdmin');
    expect(powerTag(50, t).name).toBe('timeline.powerLevelModerator');
    expect(powerTag(0, t).name).toBe('timeline.powerLevelMember');
    expect(powerTag(-1, t).name).toBe('timeline.powerLevelMuted');
  });

  it('colours the default staff roles but leaves members uncoloured', () => {
    expect(powerTag(FOUNDER_POWER_LEVEL, t).color).toBe('#0000ff');
    expect(powerTag(100, t).color).toBe('#0088ff');
    expect(powerTag(50, t).color).toBe('#1fd81f');
    expect(powerTag(75, t).color).toBe('#1fd81f');
    expect(powerTag(0, t).color).toBeNull();
    expect(powerTag(10, t).color).toBeNull();
  });

  it('keeps every role colour legible on light and dark grounds', () => {
    const colors = [FOUNDER_POWER_LEVEL, 150, 101, 100, 50, -1]
      .map((level) => powerTag(level, t).color)
      .concat(['#0000ff', '#ff0000', '#f1c7ef', '#1fd81f', '#888888', '#ffff00']);
    for (const color of colors) {
      expect(contrastRatio(roleColorOnLight(color) ?? '', '#e4e4e7')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(roleColorOnDark(color) ?? '', '#2d2c36')).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps a room tag without a colour uncoloured', () => {
    expect(powerTag(100, t, { 100: { name: 'Admin', color: null, icon: null } }).color).toBeNull();
  });

  it('names a room-version-12 creator, whose power level is infinite', () => {
    expect(powerTag(Number.MAX_SAFE_INTEGER + 1, t).name).toBe('timeline.powerTagFounder');
  });

  it('applies saved founder flair', () => {
    const flair = { name: 'Founder', color: '#ff0000', icon: '👑' };

    expect(powerTag(FOUNDER_POWER_LEVEL, t, { [FOUNDER_POWER_LEVEL]: flair })).toEqual(flair);
  });

  it('does not name the highest 32-bit power level as founder', () => {
    expect(powerTag(2_147_483_647, t).name).not.toBe('timeline.powerTagFounder');
  });

  it('prefers the room tag and carries its colour', () => {
    expect(powerTag(100, t, { 100: { name: 'Overlord', color: '#ff0000', icon: '⚡' } })).toEqual({
      name: 'Overlord',
      color: '#ff0000',
      icon: '⚡',
    });
  });

  it('derives an unnamed level from the highest tag below it', () => {
    expect(powerTag(75, t).name).toBe(
      'timeline.powerTagDerived({"tag":"timeline.powerLevelModerator","level":75})'
    );
    expect(powerTag(75, t, { 60: { name: 'Helper', color: null, icon: null } }).name).toBe(
      'timeline.powerTagDerived({"tag":"Helper","level":75})'
    );
  });

  it('falls back to a team label below every tag', () => {
    expect(powerTag(-5, t).name).toBe('timeline.powerTagTeam({"level":-5})');
  });
});
