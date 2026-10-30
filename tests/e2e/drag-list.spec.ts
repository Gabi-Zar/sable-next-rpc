import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    dragListResult: { source: string; target: string; instruction: string }[];
    dragListActive: string | null;
    dragListEnded: number;
  }
}

test.beforeEach(async ({ page }) => {
  await page.route('**/drag-list-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Drag list fixture</title>',
    })
  );
  await page.goto('/drag-list-fixture');
  await page.evaluate(async () => {
    const path = '/src/lib/ui/drag-list.ts';
    const { createDragList } = (await import(
      /* @vite-ignore */ path
    )) as typeof import('../../src/lib/ui/drag-list.js');
    document.body.innerHTML = `
      <style>
        .row { width: 180px; min-height: 40px; padding: 10px; box-sizing: border-box; background: #ddd; margin: 10px; }
        #scroll { overflow: auto; height: 120px; width: 240px; margin: 10px; }
        #scroll-content { height: 800px; }
      </style>
      <div id="source" class="row">Source</div>
      <div id="target" class="row">Target</div>
      <div id="parent" class="row">Parent<div id="child" class="row">Child</div></div>
      <div id="other" class="row">Other list</div>
      <div id="scroll"><div id="scroll-content"></div></div>
    `;
    window.dragListResult = [];
    window.dragListActive = null;
    window.dragListEnded = 0;
    const list = createDragList<string>((a, b) => a === b);
    const element = (id: string): HTMLElement => {
      const node = document.getElementById(id);
      if (!node) throw new Error(`Missing drag fixture ${id}`);
      return node;
    };
    list.draggable('source', (item) => {
      window.dragListActive = item;
      if (item === null) window.dragListEnded += 1;
    })(element('source'));
    for (const id of ['target', 'parent', 'child']) {
      list.dropTarget(id, {
        allowInto: true,
        onState: () => undefined,
        onDrop: (source, target, instruction) => {
          window.dragListResult.push({ source, target, instruction });
        },
      })(element(id));
    }
    const other = createDragList<string>((a, b) => a === b);
    other.dropTarget('other', {
      onState: () => undefined,
      onDrop: (source, target, instruction) => {
        window.dragListResult.push({ source, target, instruction });
      },
    })(element('other'));
    list.autoScroll()(element('scroll'));
  });
});

test('native drag delivers one drop to the nearest row', async ({ page }) => {
  await page.locator('#source').dragTo(page.locator('#child'));
  await expect
    .poll(() => page.evaluate(() => window.dragListResult))
    .toEqual([{ source: 'source', target: 'child', instruction: 'into' }]);
  await expect.poll(() => page.evaluate(() => window.dragListActive)).toBeNull();
});

test('native drag remains isolated from another list', async ({ page }) => {
  await page.locator('#source').dragTo(page.locator('#other'));
  await expect.poll(() => page.evaluate(() => window.dragListEnded)).toBe(1);
  expect(await page.evaluate(() => window.dragListResult)).toEqual([]);
});

test('native drag scrolls an overflowing list at its edge', async ({ page }) => {
  const source = await page.locator('#source').boundingBox();
  const scroll = await page.locator('#scroll').boundingBox();
  if (!source || !scroll) throw new Error('Drag fixture has no bounds');
  await page.mouse.move(source.x + 30, source.y + 20);
  await page.mouse.down();
  await page.mouse.move(source.x + 45, source.y + 20, { steps: 5 });
  await page.mouse.move(scroll.x + 40, scroll.y + scroll.height - 5, { steps: 10 });
  await expect
    .poll(() => page.locator('#scroll').evaluate((node) => node.scrollTop))
    .toBeGreaterThan(0);
  await page.mouse.up();
});
