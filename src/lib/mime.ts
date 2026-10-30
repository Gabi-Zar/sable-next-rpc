import { Mime } from 'mime';
import otherTypes from 'mime/types/other.js';
import standardTypes from 'mime/types/standard.js';

export const appMime = new Mime(standardTypes, otherTypes).define(
  {
    'application/typescript': ['ts', 'mts'],
    'audio/aac': ['aac'],
    'audio/mpeg': ['mp3'],
    'audio/opus': ['opus'],
    'video/quicktime': ['mov'],
  },
  true
);
