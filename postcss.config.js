import globalData from '@csstools/postcss-global-data';
import customMedia from 'postcss-custom-media';
import { fileURLToPath } from 'node:url';

export default {
  plugins: [
    globalData({ files: [fileURLToPath(new URL('./src/lib/ui/media.css', import.meta.url))] }),
    customMedia(),
  ],
};
