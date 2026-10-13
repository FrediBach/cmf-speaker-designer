const origin = 'https://www.cmfspeakerdesigner.com'
let failures = 0

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function check(label, run) {
  try {
    await run()
    console.log(`PASS ${label}`)
  } catch (error) {
    failures++
    console.error(`FAIL ${label}: ${error.message}`)
  }
}

async function request(input, sameOrigin = false) {
  let url = new URL(input)
  const chain = []
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      chain.push(url.href)
      assert(!sameOrigin || url.origin === origin, 'Unexpected origin')
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      })
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return { response, url, chain }
      }
      await response.body?.cancel()
      const location = response.headers.get('location')
      assert(location, `HTTP ${response.status} without Location`)
      url = new URL(location, url)
      assert(!chain.includes(url.href), `Redirect loop back to ${url.href}`)
    }
    throw new Error('More than five redirects')
  } catch (error) {
    const cause = error.cause?.code ? ` (${error.cause.code})` : ''
    throw new Error(`${error.message}${cause}; chain: ${chain.join(' -> ')}`)
  }
}

function expectStatus(result, status) {
  assert(
    result.response.status === status,
    `HTTP ${result.response.status}, expected ${status}; chain: ${result.chain.join(' -> ')}`,
  )
}

const shared = new URL('https://cmfspeakerdesigner.com/')
shared.searchParams.set('design', JSON.stringify({ model: 'm' }))
await check(`Canonical redirect ${shared}`, async () => {
  const result = await request(shared)
  await result.response.body?.cancel()
  expectStatus(result, 200)
  const expected = new URL(shared)
  expected.hostname = new URL(origin).hostname
  assert(
    result.url.href === expected.href,
    `Expected ${expected}; chain: ${result.chain.join(' -> ')}`,
  )
})

let html = ''
await check(`Document ${origin}/`, async () => {
  const result = await request(`${origin}/`, true)
  html = await result.response.text()
  expectStatus(result, 200)
  assert(
    result.chain.length === 1,
    `Unexpected redirect: ${result.chain.join(' -> ')}`,
  )
  assert(
    result.response.headers.get('content-security-policy'),
    'Missing Content-Security-Policy',
  )
  assert(
    !/noindex/i.test(result.response.headers.get('x-robots-tag') ?? ''),
    'Production has X-Robots-Tag: noindex',
  )
})

function attributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(
      (match) => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]],
    ),
  )
}

const assets = new Set([
  '/favicon.svg',
  '/robots.txt',
  '/sitemap.xml',
  '/site.webmanifest',
  '/og-image.png',
])
let scripts = 0
for (const [tag] of html.matchAll(/<(?:script|link|meta)\b[^>]*>/gi)) {
  const attrs = attributes(tag)
  if (/^<script\b/i.test(tag) && attrs.src) {
    scripts++
    assets.add(attrs.src)
  }
  if (
    /^(?:modulepreload|stylesheet|icon|apple-touch-icon|manifest)$/.test(
      attrs.rel,
    )
  )
    assets.add(attrs.href)
  if (attrs.property === 'og:image') assets.add(attrs.content)
  if (attrs.name === 'robots')
    await check('Indexable robots metadata', async () => {
      assert(
        !/noindex/i.test(attrs.content ?? ''),
        'Production has robots noindex metadata',
      )
    })
}
await check('Application entry script', async () =>
  assert(scripts > 0, 'No script src found in document'),
)

const mimeTypes = {
  js: /^(?:text|application)\/(?:javascript|ecmascript)$/,
  css: /^text\/css$/,
  svg: /^image\/svg\+xml$/,
  png: /^image\/png$/,
  ico: /^image\/(?:x-icon|vnd\.microsoft\.icon)$/,
  webmanifest: /^application\/(?:manifest\+json|json)$/,
  txt: /^text\/plain$/,
  xml: /^(?:text|application)\/xml$/,
}
const assetUrls = [
  ...new Set([...assets].map((asset) => new URL(asset, origin).href)),
]
await Promise.all(
  assetUrls.map((asset) =>
    check(`Asset ${asset}`, async () => {
      const result = await request(asset, true)
      await result.response.body?.cancel()
      expectStatus(result, 200)
      const type = (result.response.headers.get('content-type') ?? '')
        .split(';')[0]
        .trim()
      const extension = new URL(asset).pathname.split('.').at(-1)
      assert(
        type && !/html/i.test(type),
        `Invalid asset Content-Type: ${type || '(missing)'}`,
      )
      assert(
        !mimeTypes[extension] || mimeTypes[extension].test(type),
        `Unexpected Content-Type: ${type}`,
      )
    }),
  ),
)

await check('Missing page returns 404', async () => {
  const result = await request(
    `${origin}/__deployment-check-missing-page__`,
    true,
  )
  await result.response.body?.cancel()
  expectStatus(result, 404)
})

console.log(
  failures
    ? `Deployment check failed (${failures} failures).`
    : 'Deployment check passed.',
)
process.exitCode = failures ? 1 : 0
