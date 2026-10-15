import { expect, test } from 'vitest';

import CalendarDotsIcon from 'phosphor-svelte/lib/CalendarDotsIcon';
import ChatsCircleIcon from 'phosphor-svelte/lib/ChatsCircleIcon';
import HashStraightIcon from 'phosphor-svelte/lib/HashStraightIcon';
import QuestionIcon from 'phosphor-svelte/lib/QuestionIcon';
import SpeakerHighIcon from 'phosphor-svelte/lib/SpeakerHighIcon';
import SquaresFourIcon from 'phosphor-svelte/lib/SquaresFourIcon';

import {
  roomIconComponent,
  roomIconOverlay,
  roomIconWeight,
  type RoomIconShape,
} from './room-icon.js';

function shape(overrides: Partial<RoomIconShape>): RoomIconShape {
  return { roomKind: 'text', hasParent: false, joinRule: null, ...overrides };
}

test('each room kind has its own glyph', () => {
  expect(roomIconComponent(shape({ roomKind: 'text' }))).toBe(HashStraightIcon);
  expect(roomIconComponent(shape({ roomKind: 'space' }))).toBe(SquaresFourIcon);
  expect(roomIconComponent(shape({ roomKind: 'voice' }))).toBe(SpeakerHighIcon);
  expect(roomIconComponent(shape({ roomKind: 'forum' }))).toBe(ChatsCircleIcon);
  expect(roomIconComponent(shape({ roomKind: 'calendar' }))).toBe(CalendarDotsIcon);
});

test('a room whose kind is unknown gets a question mark and no badge', () => {
  expect(roomIconComponent(shape({ roomKind: null }))).toBe(QuestionIcon);
  expect(roomIconOverlay(shape({ roomKind: null, joinRule: 'public' }))).toBeNull();
});

test('a public room is marked public, a public space is not', () => {
  expect(roomIconOverlay(shape({ joinRule: 'public' }))).toBe('globe');
  expect(roomIconOverlay(shape({ roomKind: 'space', joinRule: 'public' }))).toBeNull();
});

test('a room in a space is only badged when it says something unusual', () => {
  expect(roomIconOverlay(shape({ hasParent: true, joinRule: 'restricted' }))).toBeNull();
  expect(roomIconOverlay(shape({ hasParent: true, joinRule: 'public' }))).toBe('globe');
  expect(roomIconOverlay(shape({ hasParent: true, joinRule: 'invite' }))).toBe('lock');
});

test('a room outside a space is locked unless it is public', () => {
  expect(roomIconOverlay(shape({ joinRule: 'restricted' }))).toBe('lock');
  expect(roomIconOverlay(shape({ joinRule: 'invite' }))).toBe('lock');
});

test('a private space is locked, an unmarked space is not', () => {
  expect(roomIconOverlay(shape({ roomKind: 'space', joinRule: 'invite' }))).toBe('lock');
  expect(roomIconOverlay(shape({ roomKind: 'space', joinRule: 'restricted' }))).toBeNull();
});

test('a current room keeps an outline hash, since the filled one is a solid square', () => {
  expect(roomIconWeight(shape({ roomKind: 'text' }), 'fill')).toBe('bold');
  expect(roomIconWeight(shape({ roomKind: 'text' }), 'regular')).toBe('regular');
  expect(roomIconWeight(shape({ roomKind: 'space' }), 'fill')).toBe('fill');
  expect(roomIconWeight(shape({ roomKind: 'voice' }), 'fill')).toBe('fill');
});
