import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'three/addons/libs/fflate.module.js'
import { STORAGE_KEY, validateDesign, type Design } from '../../src/lib/design'
import { inspectBinaryStl } from './stl'

test('opens the shared overlapping-stripe design from a fresh geometry build and exports four closed material regions', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const fixture = JSON.parse(
    await readFile(
      new URL(
        '../fixtures/multicolor-overlapping-stripes.json',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  const design = validateDesign(fixture)
  expect(design.multicolor.elements).toHaveLength(12)
  const expectedIds = [
    'base',
    ...design.multicolor.materials.slice(-3).map(({ id }) => id),
  ]
  const expectedColors = [design.panelColor, '#f45427', '#eeeae1', '#303538']
    .map((color) => `${color.toUpperCase()}FF`)
    .sort()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  // The fragment is present before the app initializes: no previously rendered
  // panel or material cache can conceal the user's original startup failure.
  await page.goto(
    `/#${new URLSearchParams({ design: JSON.stringify(fixture) })}`,
  )
  await expect(page.locator('[data-materials-ready]')).toHaveAttribute(
    'data-materials-ready',
    'true',
  )
  await expect(page.locator('[data-material-count]')).toHaveAttribute(
    'data-material-count',
    '4',
  )
  await expect(
    page.getByRole('button', { name: 'Export design', exact: true }),
  ).toBeEnabled()
  await expect(page.locator('.multicolor-layers > li')).toHaveCount(12)
  const saved: Design = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    STORAGE_KEY,
  )
  expect(saved).toEqual(design)
  await page.getByRole('button', { name: 'Front', exact: true }).click()
  await expect(page.locator('.preview-stage canvas')).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('overlapping-stripes-front.png'),
    fullPage: true,
  })

  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  const dialog = page.getByRole('dialog', {
    name: 'Export design',
    exact: true,
  })
  await expect(
    dialog.getByRole('button', { name: '3MF', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: 'Panel only', exact: true }).click()
  const threeMfEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download 3MF/ }).click()
  const threeMfDownload = await threeMfEvent
  const threeMfPath = testInfo.outputPath('overlapping-stripes-panel.3mf')
  await threeMfDownload.saveAs(threeMfPath)
  expect(threeMfDownload.suggestedFilename()).toMatch(/\.3mf$/)
  const archive = unzipSync(new Uint8Array(await readFile(threeMfPath)))
  const modelXml = strFromU8(archive['3D/3dmodel.model'])

  // Inspect the actual downloaded index topology independently of the app's
  // geometry code. In particular, every oriented edge must close exactly once.
  const parsed = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, 'application/xml')
    const objects = [...document.querySelectorAll('resources > object')]
    const meshes = objects
      .filter((object) => object.querySelector('mesh'))
      .map((object) => {
        const points = [...object.querySelectorAll('vertex')].map((vertex) =>
          ['x', 'y', 'z'].map((axis) => Number(vertex.getAttribute(axis))),
        )
        const minimum = [Infinity, Infinity, Infinity]
        const maximum = [-Infinity, -Infinity, -Infinity]
        for (const point of points)
          point.forEach((coordinate, axis) => {
            minimum[axis] = Math.min(minimum[axis], coordinate)
            maximum[axis] = Math.max(maximum[axis], coordinate)
          })
        const edges = new Map<string, number>()
        let signedVolume = 0
        let invalidTriangles = 0
        const triangles = [...object.querySelectorAll('triangle')]
        for (const triangle of triangles) {
          const indices = ['v1', 'v2', 'v3'].map((key) =>
            Number(triangle.getAttribute(key)),
          )
          if (
            indices.some(
              (index) =>
                !Number.isInteger(index) || index < 0 || index >= points.length,
            ) ||
            new Set(indices).size !== 3
          ) {
            invalidTriangles += 1
            continue
          }
          for (let corner = 0; corner < 3; corner += 1) {
            const a = indices[corner],
              b = indices[(corner + 1) % 3]
            const key = `${Math.min(a, b)}:${Math.max(a, b)}`
            edges.set(key, (edges.get(key) ?? 0) + (a < b ? 11 : 9))
          }
          const [a, b, c] = indices.map((index) => points[index])
          signedVolume +=
            (a[0] * (b[1] * c[2] - b[2] * c[1]) -
              a[1] * (b[0] * c[2] - b[2] * c[0]) +
              a[2] * (b[0] * c[1] - b[1] * c[0])) /
            6
        }
        return {
          id: Number(object.getAttribute('id')),
          materialIndex: Number(object.getAttribute('pindex')),
          finiteCoordinates: points.every((point) =>
            point.every(Number.isFinite),
          ),
          triangleCount: triangles.length,
          invalidTriangles,
          invalidEdges: [...edges.values()].filter((count) => count !== 20)
            .length,
          minimum,
          maximum,
          signedVolume,
        }
      })
    return {
      xmlErrors: document.querySelectorAll('parsererror').length,
      units: document.documentElement.getAttribute('unit'),
      buildItems: [...document.querySelectorAll('build > item')].map((item) =>
        Number(item.getAttribute('objectid')),
      ),
      assemblies: objects
        .filter((object) => object.querySelector('components'))
        .map((object) => ({
          id: Number(object.getAttribute('id')),
          components: [...object.querySelectorAll('component')].map(
            (component) => Number(component.getAttribute('objectid')),
          ),
        })),
      transforms: document.querySelectorAll('[transform]').length,
      colors: [...document.querySelectorAll('basematerials > base')]
        .map((material) => material.getAttribute('displaycolor'))
        .sort(),
      meshes,
    }
  }, modelXml)
  expect(parsed.xmlErrors).toBe(0)
  expect(parsed.units).toBe('millimeter')
  expect(parsed.meshes).toHaveLength(4)
  expect(parsed.colors).toEqual(expectedColors)
  expect(parsed.assemblies).toHaveLength(1)
  expect(parsed.buildItems).toEqual([parsed.assemblies[0].id])
  expect(parsed.assemblies[0].components.sort()).toEqual(
    parsed.meshes.map(({ id }) => id).sort(),
  )
  expect(parsed.transforms).toBe(0)
  for (const mesh of parsed.meshes) {
    expect(mesh.finiteCoordinates).toBe(true)
    expect(mesh.invalidTriangles).toBe(0)
    expect(mesh.invalidEdges).toBe(0)
    expect(mesh.triangleCount).toBeGreaterThan(0)
    expect(mesh.signedVolume).toBeGreaterThan(0)
  }
  const threeMfManifest: {
    objects: { materialId: string; objectId: number }[]
  } = JSON.parse(strFromU8(archive['Metadata/materials.json']))
  expect(
    threeMfManifest.objects.map(({ materialId }) => materialId).sort(),
  ).toEqual([...expectedIds].sort())
  expect(
    JSON.parse(strFromU8(archive['Metadata/design.json'])).multicolor,
  ).toEqual(design.multicolor)

  await page.getByRole('button', { name: 'Export design', exact: true }).click()
  await dialog.getByRole('button', { name: 'STL parts', exact: true }).click()
  await dialog.getByRole('button', { name: 'Panel only', exact: true }).click()
  const stlEvent = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /^Download ZIP/ }).click()
  const stlDownload = await stlEvent
  const stlPath = testInfo.outputPath('overlapping-stripes-materials.zip')
  await stlDownload.saveAs(stlPath)
  const files = unzipSync(new Uint8Array(await readFile(stlPath)))
  const manifest: {
    units: string
    parts: { materialId: string; file: string }[]
  } = JSON.parse(strFromU8(files['materials.json']))
  expect(manifest.units).toBe('mm')
  expect(manifest.parts.map(({ materialId }) => materialId).sort()).toEqual(
    [...expectedIds].sort(),
  )
  expect(
    Object.keys(files).filter((name) => name.endsWith('.stl')),
  ).toHaveLength(4)
  for (const part of manifest.parts) {
    const mesh = inspectBinaryStl(Buffer.from(files[part.file]))
    expect(mesh.invalidEdges).toBe(0)
    expect(mesh.degenerateEdges).toBe(0)
    expect(mesh.signedVolume).toBeGreaterThan(0)
    const objectId = threeMfManifest.objects.find(
      ({ materialId }) => materialId === part.materialId,
    )?.objectId
    const reference = parsed.meshes.find(({ id }) => id === objectId)
    expect(reference).toBeDefined()
    expect(mesh.triangleCount).toBe(reference!.triangleCount)
    for (const axis of [0, 1, 2]) {
      expect(mesh.minimum[axis]).toBeCloseTo(reference!.minimum[axis], 5)
      expect(mesh.maximum[axis]).toBeCloseTo(reference!.maximum[axis], 5)
    }
    expect(mesh.signedVolume).toBeCloseTo(reference!.signedVolume, 3)
  }
  expect(
    Math.min(...parsed.meshes.map(({ minimum }) => minimum[2])),
  ).toBeCloseTo(0, 5)
  expect(JSON.parse(strFromU8(files['design.json'])).multicolor).toEqual(
    design.multicolor,
  )
  expect(errors).toEqual([])
})
