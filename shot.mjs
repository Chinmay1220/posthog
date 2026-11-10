// Screenshots of each PostHog AI answer footer, plus a clipboard read-back of every copy button.
// Runs against a static Storybook build served on :6006.
// Usage: SHOT_SET=<sandbox|legacy> [PW_CHANNEL=chrome] node shot.mjs
import { appendFileSync, writeFileSync } from 'fs'
import { chromium } from 'playwright'

const OUT = '/tmp/out'
const ORIGIN = 'http://localhost:6006'

const t0 = Date.now()
const log = (...args) => console.log(`[${Math.round((Date.now() - t0) / 1000)}s]`, ...args)
// A page that never settles must not eat the job's time budget.
setTimeout(() => {
    log('WATCHDOG: giving up')
    process.exit(3)
}, 25 * 60 * 1000).unref()
const within = (promise, ms, what) =>
    Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out: ${what}`)), ms))])

function column(page, title) {
    return page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) })
}

// Each footer: its two copy buttons, an optional box that sets the crop's width, and whether its turn
// has to be hovered before the footer shows.
const SETS = {
    // PostHog AI 2.0 (TurnFeedbackActions): quill in the comparison story, lemon in ThreadView.
    sandbox: [
        {
            id: 'scenes-app-posthog-ai-quill-comparison--side-by-side',
            ready: ['[data-attr="posthog-ai-turn-copy-markdown"]', 1],
            footers: (page) => {
                const box = column(page, 'PostHog AI 2.0 quill')
                return [
                    {
                        name: 'sandbox-quill',
                        box,
                        plain: box.locator('[data-attr="posthog-ai-turn-copy"]').last(),
                        markdown: box.locator('[data-attr="posthog-ai-turn-copy-markdown"]').last(),
                        hoverToReveal: true,
                    },
                ]
            },
        },
        {
            id: 'products-posthog-ai-threadview--message-footers',
            ready: ['[data-attr="posthog-ai-turn-copy-markdown"]', 1],
            footers: (page) => [
                {
                    name: 'sandbox-lemon',
                    box: page.locator('#storybook-root div.w-180').or(page.locator('#storybook-root > *')).first(),
                    plain: page.locator('[data-attr="posthog-ai-turn-copy"]').first(),
                    markdown: page.locator('[data-attr="posthog-ai-turn-copy-markdown"]').first(),
                },
            ],
        },
    ],
    // The LangGraph chat (SuccessActions), on a finished answer with a SQL code block, in each skin.
    legacy: [
        { id: 'scenes-app-posthog-ai-tools--thread-with-sql-query-overflow', name: 'legacy-lemon' },
        { id: 'demo-copy-markdown--quill', name: 'legacy-quill' },
    ].map(({ id, name }) => ({
        id,
        ready: ['[aria-label="Copy answer as Markdown"]', 1],
        footers: (page) => [
            {
                name,
                plain: page.locator('[aria-label="Copy answer"]').last(),
                markdown: page.locator('[aria-label="Copy answer as Markdown"]').last(),
            },
        ],
    })),
}
const STORIES = SETS[process.env.SHOT_SET ?? 'sandbox']

// PW_CHANNEL=chrome uses the runner's preinstalled Google Chrome instead of a downloaded browser.
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {})
log('browser', browser.version())

async function open(story, theme) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1200 }, deviceScaleFactor: 2 })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN })
    const page = await context.newPage()
    const tag = `[${story.id} ${theme}]`
    page.on('console', (m) => appendFileSync(`${OUT}/browser.log`, `${tag} ${m.type()}: ${m.text()}\n`))
    page.on('pageerror', (e) => appendFileSync(`${OUT}/browser.log`, `${tag} pageerror: ${e.message}\n`))
    log('open', story.id, theme)
    await page.goto(`${ORIGIN}/iframe.html?viewMode=story&id=${story.id}&globals=theme:${theme}`, {
        waitUntil: 'load',
        timeout: 120000,
    })
    try {
        await page.waitForFunction(
            ([selector, count]) => document.querySelectorAll(selector).length >= count,
            story.ready,
            { timeout: 180000 }
        )
    } catch (e) {
        log('not ready:', e.message.split('\n')[0])
    }
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => log('network never went idle'))
    await within(
        page.evaluate(() => document.fonts.ready.then(() => true)),
        30000,
        'fonts'
    ).catch((e) => log(e.message))
    await page.waitForTimeout(3000)
    const names = await within(
        page
            .locator('[aria-label]')
            .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).filter((n) => /copy/i.test(n))),
        30000,
        'list copy controls'
    ).catch((e) => [e.message])
    log(tag, 'copy controls:', JSON.stringify(names))
    return { context, page }
}

async function bringIntoView(page, footer) {
    await within(
        footer.markdown.evaluate((el) => el.scrollIntoView({ block: 'center' })),
        15000,
        'scroll'
    )
    if (footer.hoverToReveal) {
        // The quill sandbox footer has no height until its turn is hovered: point just above it, at the answer.
        const b = await within(
            footer.markdown.evaluate((el) => {
                const r = (el.closest('.QuillFooterReveal') ?? el).getBoundingClientRect()
                return { x: r.x, y: r.y }
            }),
            15000,
            'footer position'
        )
        await page.mouse.move(b.x + 60, b.y - 12)
        await page.waitForTimeout(600)
    }
}

async function crop(page, footer, file) {
    const btn = await footer.markdown.boundingBox()
    if (!btn) {
        throw new Error('no bounding box')
    }
    const y = Math.max(0, btn.y - 220)
    const height = btn.y - y + 70
    if (footer.box) {
        const box = await footer.box.boundingBox()
        await page.screenshot({ path: file, clip: { x: Math.max(0, box.x - 8), y, width: box.width + 16, height } })
    } else {
        // No container to measure: a window from just left of the footer across the answer.
        const x = Math.max(0, btn.x - 90)
        await page.screenshot({ path: file, clip: { x, y, width: Math.min(860, 1920 - x), height } })
    }
}

async function shoot(theme) {
    for (const story of STORIES) {
        const { context, page } = await open(story, theme)
        await page.screenshot({ path: `${OUT}/${story.id}-${theme}.png`, fullPage: true }).catch((e) => log(e.message))
        for (const footer of story.footers(page)) {
            try {
                await bringIntoView(page, footer)
                await footer.markdown.hover({ timeout: 15000 })
                await page.waitForTimeout(1500)
                await crop(page, footer, `${OUT}/footer-${footer.name}-${theme}.png`)
                log('cropped', footer.name, theme)
            } catch (e) {
                log('crop FAILED', footer.name, theme, e.message.split('\n')[0])
            }
        }
        await context.close()
    }
}

async function clipboardCheck() {
    const results = []
    for (const story of STORIES) {
        const { context, page } = await open(story, 'light')
        for (const footer of story.footers(page)) {
            for (const kind of ['plain', 'markdown']) {
                const name = `${footer.name} ${kind}`
                try {
                    await bringIntoView(page, footer)
                    await within(
                        page.evaluate(() => navigator.clipboard.writeText('<empty>')),
                        10000,
                        'clear clipboard'
                    )
                    await footer[kind].click({ timeout: 15000 })
                    await page.waitForTimeout(800)
                    const text = await within(
                        page.evaluate(() => navigator.clipboard.readText()),
                        10000,
                        'read clipboard'
                    )
                    results.push(`=== ${name} (${text.length} chars)\n${text}`)
                    log('copied', name, text.length, 'chars')
                } catch (e) {
                    results.push(`=== ${name} FAILED: ${e.message.split('\n')[0]}`)
                    log('copy FAILED', name, e.message.split('\n')[0])
                }
            }
        }
        await context.close()
    }
    writeFileSync(`${OUT}/clipboard.txt`, results.join('\n\n') + '\n')
}

await shoot('light')
await shoot('dark')
await clipboardCheck()
await browser.close()
log('done')
